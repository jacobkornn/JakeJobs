import { IpcMain } from "electron";
import { ConfidentialClientApplication } from "@azure/msal-node";

const getOrgUrl = () => process.env.DYNAMICS_ORG_URL || "";
const getApiBase = () => `${getOrgUrl()}/api/data/v9.2`;
const BATCH_SIZE = 100;

let msalClient: ConfidentialClientApplication | null = null;
let cachedToken: string | null = null;
let tokenExpiry = 0;

// ─── Caches (loaded from Dynamics once, updated on creates) ───

interface CachedAccount {
  id: string;
  name: string;
  domain?: string;
  website?: string;
}

const accountsByName = new Map<string, CachedAccount>();
const existingJobLinks = new Set<string>();
let cachesLoaded = false;

// ─── Current batch tracking (reset each pull) ───

let batchNewAccounts: CachedAccount[] = [];
let batchNewJobs: Array<Record<string, unknown>> = [];

// ─── Auth ───

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
    scopes: [`${getOrgUrl()}/.default`],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire Dynamics token");
  cachedToken = result.accessToken;
  tokenExpiry = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3600_000;
  return cachedToken;
}

// ─── HTTP helpers ───

async function dynamicsFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${getApiBase()}${path}`;

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
    if (!res.ok) throw new Error(`Dynamics fetch failed: ${res.status}`);
    const data = await res.json();
    results.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }

  return results;
}

// ─── Cache loading (one-time from Dynamics) ───

async function ensureCaches(): Promise<void> {
  if (cachesLoaded) return;

  // Load all accounts
  const accounts = await fetchAllPaginated<Record<string, string>>(
    "/accounts?$select=accountid,name,websiteurl,cr21a_domain"
  );
  accountsByName.clear();
  for (const acc of accounts) {
    const key = normalizeName(acc.name || "");
    if (key) {
      accountsByName.set(key, {
        id: acc.accountid,
        name: acc.name,
        domain: acc.cr21a_domain,
        website: acc.websiteurl,
      });
    }
  }

  // Load all existing job links
  const jobs = await fetchAllPaginated<Record<string, string>>(
    "/cr21a_jobpostings?$select=cr21a_joblink"
  );
  existingJobLinks.clear();
  for (const j of jobs) {
    const link = j.cr21a_joblink?.trim();
    if (link) existingJobLinks.add(link);
  }

  cachesLoaded = true;
}

// ─── Name normalization for deduplication ───

function normalizeName(name: string): string {
  let s = name.trim().toLowerCase().replace(/\u00a0/g, " ");
  s = s.replace(/&/g, " and ").replace(/[.,'']/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*[-–—]\s*(us|usa|u\.s\.a\.|north america|na)$/, "").trim();
  const suffixes = [" inc", " incorporated", " llc", " ltd", " limited", " co", " company", " corp", " corporation", " plc", " gmbh", " sa"];
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const suf of suffixes) {
      if (s.endsWith(suf)) { s = s.slice(0, -suf.length).trim(); changed = true; }
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

// ─── Account upsert (cache-first, API create if new) ───

async function upsertAccount(name: string, website?: string): Promise<CachedAccount> {
  const key = normalizeName(name);
  const existing = accountsByName.get(key);
  if (existing) return existing;

  // Create in Dynamics
  const payload: Record<string, string> = { name };
  if (website) payload.websiteurl = website;

  const res = await dynamicsFetch("/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Account creation failed for "${name}": ${res.status} ${await res.text()}`);
  }

  // Extract ID from OData-EntityId header
  const entityId = res.headers.get("OData-EntityId") || "";
  const match = entityId.match(/\(([^)]+)\)/);
  const accountId = match ? match[1] : "";

  if (!accountId) {
    throw new Error(`Failed to extract account ID for "${name}"`);
  }

  const account: CachedAccount = { id: accountId, name, website };
  accountsByName.set(key, account);
  batchNewAccounts.push(account);

  return account;
}

// ─── Job creation (linked to account, deduplicated by job link) ───

async function createJob(
  jobData: Record<string, string>,
  accountId: string
): Promise<boolean> {
  const jobLink = jobData.jobLink?.trim();

  // Skip duplicates
  if (jobLink && existingJobLinks.has(jobLink)) {
    return false;
  }

  const payload: Record<string, unknown> = {
    cr21a_jobtitle: jobData.jobTitle || undefined,
    cr21a_companyname: jobData.companyName || undefined,
    cr21a_location: jobData.location || undefined,
    cr21a_joblink: jobLink || undefined,
    cr21a_source: jobData.source || undefined,
    cr21a_tags: jobData.tags || undefined,
    // Bind to account
    "cr21a_jobposting@odata.bind": `/accounts(${accountId})`,
  };

  // Date fields
  if (jobData.dateAdded) {
    try {
      payload.cr21a_dateadded = new Date(jobData.dateAdded).toISOString();
    } catch { /* skip invalid dates */ }
  }

  // Remove undefined values
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  const res = await dynamicsFetch("/cr21a_jobpostings", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Job creation failed: ${res.status} ${errText}`);
  }

  if (jobLink) existingJobLinks.add(jobLink);
  return true;
}

// ─── IPC Handlers ───

export function registerDynamicsHandlers(ipcMain: IpcMain) {
  ipcMain.handle("dynamics:getAccounts", async () => {
    await ensureCaches();
    return Array.from(accountsByName.values());
  });

  ipcMain.handle("dynamics:getContacts", async () => {
    await ensureCaches();

    const contacts = await fetchAllPaginated<Record<string, string>>(
      "/contacts?$select=contactid,firstname,lastname,fullname,emailaddress1,jobtitle,cr21a_leadtype,_parentcustomerid_value,createdon"
    );

    // Resolve account names from cache
    const accountById = new Map<string, CachedAccount>();
    for (const a of accountsByName.values()) {
      accountById.set(a.id, a);
    }

    return contacts.map((c) => {
      const account = c._parentcustomerid_value ? accountById.get(c._parentcustomerid_value) : undefined;
      return {
        contactid: c.contactid,
        firstname: c.firstname || "",
        lastname: c.lastname || "",
        fullname: c.fullname || "",
        emailaddress1: c.emailaddress1 || "",
        jobtitle: c.jobtitle || "",
        cr21a_leadtype: c.cr21a_leadtype || "",
        _parentcustomerid_value: c._parentcustomerid_value || "",
        accountName: account?.name || "",
        createdon: c.createdon || "",
      };
    });
  });

  ipcMain.handle("dynamics:getJobs", async () => {
    await ensureCaches();

    const jobs = await fetchAllPaginated<Record<string, string>>(
      "/cr21a_jobpostings?$select=cr21a_jobpostingid,cr21a_jobtitle,cr21a_companyname,cr21a_location,cr21a_joblink,cr21a_dateadded,_cr21a_jobposting_value&$orderby=cr21a_dateadded desc"
    );

    // Resolve account names
    const accountById = new Map<string, CachedAccount>();
    for (const a of accountsByName.values()) {
      accountById.set(a.id, a);
    }

    return jobs.map((j) => {
      const account = j._cr21a_jobposting_value ? accountById.get(j._cr21a_jobposting_value) : undefined;
      return {
        ...j,
        accountName: account?.name || j.cr21a_companyname || "",
      };
    });
  });

  /**
   * Process a batch of jobs from the pull stage:
   * - Upsert accounts (create if new, get ID if existing)
   * - Create jobs linked to accounts (skip duplicates by job link)
   * - Returns what's new vs what was skipped
   */
  ipcMain.handle(
    "dynamics:processJobBatch",
    async (_event, jobs: Array<Record<string, string>>) => {
      await ensureCaches();

      // Reset batch tracking
      batchNewAccounts = [];
      batchNewJobs = [];

      const results = {
        newAccounts: 0,
        existingAccounts: 0,
        newJobs: 0,
        skippedJobs: 0,
        errors: [] as string[],
      };

      for (const job of jobs) {
        const companyName = job.companyName?.trim();
        if (!companyName) {
          results.errors.push(`Skipped job "${job.jobTitle}": no company name`);
          continue;
        }

        try {
          // Upsert account
          const wasNew = !accountsByName.has(companyName.toLowerCase().trim());
          const account = await upsertAccount(companyName, job.website);

          if (wasNew) results.newAccounts++;
          else results.existingAccounts++;

          // Create job linked to account
          const created = await createJob(job, account.id);
          if (created) {
            results.newJobs++;
            batchNewJobs.push({ ...job, accountId: account.id });
          } else {
            results.skippedJobs++;
          }
        } catch (err) {
          results.errors.push(`${job.jobTitle} at ${companyName}: ${String(err)}`);
        }
      }

      return results;
    }
  );

  /**
   * Get new accounts from the current batch (for export to Sales Navigator)
   */
  ipcMain.handle("dynamics:getBatchNewAccounts", async () => {
    return batchNewAccounts;
  });

  /**
   * Get new jobs from the current batch
   */
  ipcMain.handle("dynamics:getBatchNewJobs", async () => {
    return batchNewJobs;
  });

  /**
   * Force reload caches from Dynamics
   */
  ipcMain.handle("dynamics:refreshCaches", async () => {
    cachesLoaded = false;
    await ensureCaches();
    return {
      accounts: accountsByName.size,
      jobLinks: existingJobLinks.size,
    };
  });
}

export { dynamicsFetch, fetchAllPaginated, accountsByName, existingJobLinks, ensureCaches };
