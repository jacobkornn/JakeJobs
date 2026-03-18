import { IpcMain } from "electron";
import { dynamicsFetch, accountsByName } from "./dynamics";

const getApiKey = () => (process.env.WIZA_API_KEY || "").trim();
const WIZA_BASE = "https://wiza.co";

// ─── Wiza HTTP helper ───

async function wizaFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("WIZA_API_KEY not configured in .env");

  const url = `${WIZA_BASE}${path}`;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "10", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    return res;
  }

  throw new Error(`Wiza API failed after ${maxRetries} retries`);
}

// ─── Get a single list by ID ───

interface WizaList {
  id: number;
  name: string;
  status: string;
  created_at: string;
  finished_at?: string;
  stats?: { people?: number; credits?: number };
  enrichment_level?: string;
}

async function getList(listId: number): Promise<WizaList> {
  const res = await wizaFetch(`/api/lists/${listId}`);
  if (!res.ok) throw new Error(`Get list failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data;
}

// ─── Get contacts from a list ───

async function getListContacts(listId: number): Promise<Array<Record<string, unknown>>> {
  const res = await wizaFetch(`/api/lists/${listId}/contacts?segment=people`);
  if (!res.ok) throw new Error(`Get contacts failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

// ─── Name normalization for account matching ───

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

function findAccountId(companyName: string): string | undefined {
  const key = normalizeName(companyName);
  return accountsByName.get(key)?.id;
}

// ─── Dynamics contact upsert ───

async function upsertContact(contact: {
  firstname?: string;
  lastname?: string;
  email?: string;
  jobtitle?: string;
  accountId?: string;
  phone?: string;
  linkedinUrl?: string;
  location?: string;
}): Promise<{ id: string; created: boolean }> {
  const email = contact.email?.toLowerCase().trim();
  if (!email) throw new Error("Contact has no email");

  // Check if exists
  const checkRes = await dynamicsFetch(
    `/contacts?$filter=emailaddress1 eq '${email}'&$select=contactid&$top=1`
  );
  if (checkRes.ok) {
    const data = await checkRes.json();
    if (data.value?.length > 0) {
      return { id: data.value[0].contactid, created: false };
    }
  }

  // Create
  const payload: Record<string, unknown> = {
    firstname: contact.firstname || undefined,
    lastname: contact.lastname || undefined,
    emailaddress1: email,
    jobtitle: contact.jobtitle || undefined,
    telephone1: contact.phone || undefined,
    cr21a_linkedinprofile: contact.linkedinUrl || undefined,
    address1_city: contact.location || undefined,
  };

  if (contact.accountId) {
    payload["parentcustomerid_account@odata.bind"] = `/accounts(${contact.accountId})`;
  }

  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  const res = await dynamicsFetch("/contacts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Contact create failed: ${res.status} ${await res.text()}`);

  const entityId = res.headers.get("OData-EntityId") || "";
  const match = entityId.match(/\(([^)]+)\)/);
  return { id: match ? match[1] : "", created: true };
}

// ─── IPC Handlers ───

export function registerWizaHandlers(ipcMain: IpcMain) {
  // Check Wiza API credits
  ipcMain.handle("wiza:getCredits", async () => {
    const res = await wizaFetch("/api/meta/credits");
    if (!res.ok) throw new Error(`Credits check failed: ${res.status}`);
    return await res.json();
  });

  // Get a single list by ID
  ipcMain.handle("wiza:getList", async (_event, listId: number) => {
    return await getList(listId);
  });

  // Get contacts from a list
  ipcMain.handle("wiza:getListContacts", async (_event, listId: number) => {
    const contacts = await getListContacts(listId);
    return { contacts, count: contacts.length };
  });

  // Process Wiza contacts: create in Dynamics linked to accounts
  ipcMain.handle(
    "wiza:processContacts",
    async (_event, contacts: Array<Record<string, string>>) => {
      const results = {
        created: 0,
        existing: 0,
        noEmail: 0,
        matched: 0,
        unmatched: 0,
        errors: [] as string[],
      };

      for (const c of contacts) {
        const fullname = c.full_name || c.name || `${c.first_name || ""} ${c.last_name || ""}`.trim();
        const parts = fullname.split(" ");
        const company = c.company || c.company_name || "";
        const accountId = company ? findAccountId(company) : undefined;

        if (accountId) results.matched++;
        else if (company) results.unmatched++;

        const email = c.email || c.work_email || c.personal_email || "";
        if (!email) {
          results.noEmail++;
          continue;
        }

        try {
          const result = await upsertContact({
            firstname: c.first_name || parts[0] || "",
            lastname: c.last_name || parts.slice(1).join(" ") || "",
            email,
            jobtitle: c.title || c.job_title || "",
            accountId,
            phone: c.mobile_phone || c.phone || "",
            linkedinUrl: c.linkedin_url || c.profile_url || "",
            location: c.location || "",
          });

          if (result.created) results.created++;
          else results.existing++;
        } catch (err) {
          results.errors.push(`${fullname}: ${String(err)}`);
        }
      }

      return results;
    }
  );
}
