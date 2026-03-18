import { IpcMain } from "electron";
import { ConfidentialClientApplication } from "@azure/msal-node";

const DYNAMICS_ORG_URL = process.env.DYNAMICS_ORG_URL || "";
const API_BASE = `${DYNAMICS_ORG_URL}/api/data/v9.2`;
const BATCH_SIZE = 100;

let msalClient: ConfidentialClientApplication | null = null;
let cachedToken: string | null = null;
let tokenExpiry = 0;

// In-memory caches
const accountsCache = new Map<string, { id: string; name: string; domain?: string; website?: string; linkedinUrl?: string }>();
const contactsCache = new Map<string, { id: string; name: string; email?: string; accountId?: string }>();

// Pending changes (accumulate until user syncs)
const pendingAccounts: Array<Record<string, unknown>> = [];
const pendingContacts: Array<Record<string, unknown>> = [];
const pendingJobs: Array<Record<string, unknown>> = [];

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.DYNAMICS_CLIENT_ID || "",
        clientSecret: process.env.DYNAMICS_CLIENT_SECRET || "",
        authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
      },
    });
  }
  return msalClient;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }
  const result = await getMsalClient().acquireTokenByClientCredential({
    scopes: [`${DYNAMICS_ORG_URL}/.default`],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire Dynamics token");
  cachedToken = result.accessToken;
  tokenExpiry = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3600_000;
  return cachedToken;
}

async function dynamicsFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        Prefer: 'odata.include-annotations="*"',
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (res.status >= 500 && attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      continue;
    }

    return res;
  }

  throw new Error(`Dynamics API failed after ${maxRetries} retries`);
}

async function fetchAllPaginated<T>(path: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = path;

  while (url) {
    const res = await dynamicsFetch(url);
    const data = await res.json();
    results.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }

  return results;
}

async function executeBatch(operations: Array<{ method: string; url: string; body?: unknown }>): Promise<unknown[]> {
  const token = await getToken();
  const batchId = `batch_${Date.now()}`;
  const changesetId = `changeset_${Date.now()}`;

  const parts: string[] = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    let part = `--${changesetId}\r\n`;
    part += "Content-Type: application/http\r\n";
    part += "Content-Transfer-Encoding: binary\r\n";
    part += `Content-ID: ${i + 1}\r\n\r\n`;
    part += `${op.method} ${API_BASE}${op.url} HTTP/1.1\r\n`;
    part += "Content-Type: application/json\r\n";
    part += "Accept: application/json\r\n\r\n";
    if (op.body) {
      part += JSON.stringify(op.body);
    }
    parts.push(part);
  }

  const body =
    `--${batchId}\r\n` +
    `Content-Type: multipart/mixed; boundary=${changesetId}\r\n\r\n` +
    parts.join("\r\n") +
    `\r\n--${changesetId}--\r\n` +
    `--${batchId}--`;

  const res = await fetch(`${API_BASE}/$batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/mixed; boundary=${batchId}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Batch request failed: ${res.status}`);
  }

  return [await res.text()];
}

async function loadAccountsCache(): Promise<void> {
  const accounts = await fetchAllPaginated<Record<string, string>>(
    "/accounts?$select=accountid,name,websiteurl,cr21a_domain"
  );
  accountsCache.clear();
  for (const acc of accounts) {
    const key = acc.name?.toLowerCase().trim();
    if (key) {
      accountsCache.set(key, {
        id: acc.accountid,
        name: acc.name,
        domain: acc.cr21a_domain,
        website: acc.websiteurl,
      });
    }
  }
}

async function loadContactsCache(): Promise<void> {
  const contacts = await fetchAllPaginated<Record<string, string>>(
    "/contacts?$select=contactid,fullname,emailaddress1,_parentcustomerid_value"
  );
  contactsCache.clear();
  for (const c of contacts) {
    const email = c.emailaddress1?.toLowerCase().trim();
    if (email) {
      contactsCache.set(email, {
        id: c.contactid,
        name: c.fullname,
        email: c.emailaddress1,
        accountId: c._parentcustomerid_value,
      });
    }
  }
}

export function registerDynamicsHandlers(ipcMain: IpcMain) {
  ipcMain.handle("dynamics:getAccounts", async () => {
    if (accountsCache.size === 0) await loadAccountsCache();
    return Array.from(accountsCache.values());
  });

  ipcMain.handle("dynamics:getContacts", async () => {
    if (contactsCache.size === 0) await loadContactsCache();
    return Array.from(contactsCache.values());
  });

  ipcMain.handle("dynamics:getJobs", async () => {
    return fetchAllPaginated(
      "/cr21a_jobpostings?$select=cr21a_jobpostingid,cr21a_jobtitle,cr21a_companyname,cr21a_location,cr21a_joblink,cr21a_dateadded&$orderby=cr21a_dateadded desc"
    );
  });

  ipcMain.handle("dynamics:getPendingCount", () => {
    return {
      accounts: pendingAccounts.length,
      contacts: pendingContacts.length,
      jobs: pendingJobs.length,
    };
  });

  ipcMain.handle("dynamics:syncPending", async () => {
    const results = { accounts: 0, contacts: 0, jobs: 0, errors: [] as string[] };

    // Batch create accounts
    for (let i = 0; i < pendingAccounts.length; i += BATCH_SIZE) {
      const batch = pendingAccounts.slice(i, i + BATCH_SIZE);
      const ops = batch.map((acc) => ({
        method: "POST",
        url: "/accounts",
        body: acc,
      }));
      try {
        await executeBatch(ops);
        results.accounts += batch.length;
      } catch (e) {
        // Fallback: create individually
        for (const acc of batch) {
          try {
            const res = await dynamicsFetch("/accounts", {
              method: "POST",
              body: JSON.stringify(acc),
            });
            if (res.ok) results.accounts++;
            else results.errors.push(`Account ${acc.name}: ${res.status}`);
          } catch (err) {
            results.errors.push(`Account ${acc.name}: ${String(err)}`);
          }
        }
      }
    }

    // Batch create contacts (with account binding)
    for (let i = 0; i < pendingContacts.length; i += BATCH_SIZE) {
      const batch = pendingContacts.slice(i, i + BATCH_SIZE);
      const ops = batch.map((c) => ({
        method: "POST",
        url: "/contacts",
        body: c,
      }));
      try {
        await executeBatch(ops);
        results.contacts += batch.length;
      } catch (e) {
        for (const c of batch) {
          try {
            const res = await dynamicsFetch("/contacts", {
              method: "POST",
              body: JSON.stringify(c),
            });
            if (res.ok) results.contacts++;
            else results.errors.push(`Contact ${c.fullname}: ${res.status}`);
          } catch (err) {
            results.errors.push(`Contact ${c.fullname}: ${String(err)}`);
          }
        }
      }
    }

    // Batch create jobs
    for (let i = 0; i < pendingJobs.length; i += BATCH_SIZE) {
      const batch = pendingJobs.slice(i, i + BATCH_SIZE);
      const ops = batch.map((j) => ({
        method: "POST",
        url: "/cr21a_jobpostings",
        body: j,
      }));
      try {
        await executeBatch(ops);
        results.jobs += batch.length;
      } catch (e) {
        for (const j of batch) {
          try {
            const res = await dynamicsFetch("/cr21a_jobpostings", {
              method: "POST",
              body: JSON.stringify(j),
            });
            if (res.ok) results.jobs++;
            else results.errors.push(`Job ${j.cr21a_jobtitle}: ${res.status}`);
          } catch (err) {
            results.errors.push(`Job ${j.cr21a_jobtitle}: ${String(err)}`);
          }
        }
      }
    }

    // Clear pending after sync
    pendingAccounts.length = 0;
    pendingContacts.length = 0;
    pendingJobs.length = 0;

    // Refresh caches
    await loadAccountsCache();
    await loadContactsCache();

    return results;
  });
}

// Exported for other IPC handlers to queue pending items
export function queueAccount(account: Record<string, unknown>) {
  pendingAccounts.push(account);
}

export function queueContact(contact: Record<string, unknown>) {
  pendingContacts.push(contact);
}

export function queueJob(job: Record<string, unknown>) {
  pendingJobs.push(job);
}

export function getAccountByName(name: string) {
  return accountsCache.get(name.toLowerCase().trim());
}

export function getContactByEmail(email: string) {
  return contactsCache.get(email.toLowerCase().trim());
}

export { dynamicsFetch, fetchAllPaginated, loadAccountsCache, loadContactsCache, accountsCache };
