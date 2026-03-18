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

// ─── Poll for completion ───

async function pollUntilComplete(
  checkFn: () => Promise<{ complete: boolean; data: unknown }>,
  intervalMs = 5000,
  maxWaitMs = 300000
): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await checkFn();
    if (result.complete) return result.data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for Wiza to complete");
}

// ─── Company enrichment ───

interface CompanyEnrichResult {
  company_name?: string;
  company_domain?: string;
  company_description?: string;
  company_industry?: string;
  company_size?: number;
  company_size_range?: string;
  company_founded?: string;
  company_revenue_range?: string;
  company_funding?: string;
  company_type?: string;
  company_ticker?: string;
  company_last_funding_round?: string;
  company_last_funding_amount?: string;
  company_last_funding_at?: string;
  company_location?: string;
  company_street?: string;
  company_locality?: string;
  company_region?: string;
  company_postal_code?: string;
  company_country?: string;
  company_twitter?: string;
  company_facebook?: string;
  company_linkedin?: string;
  company_linkedin_id?: string;
  domain?: string;
}

async function enrichCompany(
  params: { company_name?: string; company_domain?: string; company_linkedin_slug?: string }
): Promise<CompanyEnrichResult | null> {
  const body: Record<string, string> = {};
  if (params.company_name) body.company_name = params.company_name;
  if (params.company_domain) body.company_domain = params.company_domain;
  if (params.company_linkedin_slug) body.company_linkedin_slug = params.company_linkedin_slug;

  if (Object.keys(body).length === 0) return null;

  const res = await wizaFetch("/api/company_enrichments", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 404) return null; // company not found
    throw new Error(`Company enrichment failed: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

// ─── Contact list creation + retrieval ───

interface WizaListItem {
  full_name?: string;
  company?: string;
  domain?: string;
  profile_url?: string;
  email?: string;
}

async function createList(
  name: string,
  items: WizaListItem[],
  enrichmentLevel: "none" | "partial" | "phone" | "full" = "full"
): Promise<number> {
  const res = await wizaFetch("/api/lists", {
    method: "POST",
    body: JSON.stringify({
      list: {
        name,
        enrichment_level: enrichmentLevel,
        email_options: {
          accept_work: true,
          accept_personal: true,
          accept_generic: false,
        },
        items,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`List creation failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.data.id;
}

async function getListStatus(listId: number): Promise<{ status: string; complete: boolean }> {
  const res = await wizaFetch(`/api/lists/${listId}`);
  if (!res.ok) throw new Error(`Get list failed: ${res.status}`);
  const data = await res.json();
  const status = data.data.status;
  return { status, complete: status === "finished" || status === "failed" };
}

async function getListContacts(listId: number): Promise<Array<Record<string, unknown>>> {
  const res = await wizaFetch(`/api/lists/${listId}/contacts?segment=people`);
  if (!res.ok) throw new Error(`Get contacts failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

// ─── Dynamics account enrichment via PATCH ───

function buildAccountEnrichPayload(wiza: CompanyEnrichResult): Record<string, string> {
  const payload: Record<string, string> = {};

  const domain = wiza.company_domain?.trim() || wiza.domain?.trim();
  if (domain) {
    payload.cr21a_domain = domain;
    payload.websiteurl = domain.startsWith("http") ? domain : `https://${domain}`;
  }

  if (wiza.company_description?.trim()) payload.description = wiza.company_description.trim();
  if (wiza.company_street?.trim()) payload.address1_line1 = wiza.company_street.trim();
  if (wiza.company_locality?.trim()) payload.address1_city = wiza.company_locality.trim();
  if (wiza.company_region?.trim()) payload.address1_stateorprovince = wiza.company_region.trim();
  if (wiza.company_country?.trim()) payload.address1_country = wiza.company_country.trim();
  if (wiza.company_postal_code?.trim()) payload.address1_postalcode = wiza.company_postal_code.trim();
  if (wiza.company_industry?.trim()) payload.cr21a_industry_text = wiza.company_industry.trim();
  if (wiza.company_size_range?.trim()) payload.cr21a_companysizerange = wiza.company_size_range.trim();
  if (wiza.company_revenue_range?.trim()) payload.cr21a_companyrevenue = wiza.company_revenue_range.trim();
  if (wiza.company_funding?.trim()) payload.cr21a_companyfunding = wiza.company_funding.trim();
  if (wiza.company_linkedin?.trim()) payload.cr21a_companylinkedin = wiza.company_linkedin.trim();
  if (wiza.company_ticker?.trim()) payload.tickersymbol = wiza.company_ticker.trim();

  return payload;
}

async function enrichAccountInDynamics(accountId: string, payload: Record<string, string>): Promise<boolean> {
  if (Object.keys(payload).length === 0) return false;
  const res = await dynamicsFetch(`/accounts(${accountId})`, {
    method: "PATCH",
    headers: { "If-Match": "*" },
    body: JSON.stringify(payload),
  });
  return res.ok;
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

// ─── IPC Handlers ───

export function registerWizaHandlers(ipcMain: IpcMain) {
  // Check Wiza API credits
  ipcMain.handle("wiza:getCredits", async () => {
    const res = await wizaFetch("/api/meta/credits");
    if (!res.ok) throw new Error(`Credits check failed: ${res.status}`);
    return await res.json();
  });

  // Enrich accounts from the current batch
  ipcMain.handle(
    "wiza:enrichAccounts",
    async (_event, accounts: Array<{ name: string; domain?: string; id: string }>) => {
      const results = { enriched: 0, skipped: 0, errors: [] as string[] };

      for (const account of accounts) {
        try {
          // Rate limit: 30/min for company enrichment
          const enrichData = await enrichCompany({
            company_name: account.name,
            company_domain: account.domain,
          });

          if (!enrichData) {
            results.skipped++;
            continue;
          }

          const payload = buildAccountEnrichPayload(enrichData);
          const success = await enrichAccountInDynamics(account.id, payload);
          if (success) results.enriched++;
          else results.skipped++;
        } catch (err) {
          results.errors.push(`${account.name}: ${String(err)}`);
        }

        // Respect rate limit: ~2 per second to stay under 30/min
        await new Promise((r) => setTimeout(r, 2100));
      }

      return results;
    }
  );

  // Create a Wiza list from contacts/profiles, wait for completion, return enriched contacts
  ipcMain.handle(
    "wiza:pullContacts",
    async (
      _event,
      params: {
        items: WizaListItem[];
        listName?: string;
        enrichmentLevel?: "none" | "partial" | "phone" | "full";
      }
    ) => {
      if (params.items.length === 0) {
        return { contacts: [], message: "No items to process" };
      }

      // Create list
      const listName = params.listName || `JakeJobs ${new Date().toISOString().slice(0, 10)}`;
      const listId = await createList(listName, params.items, params.enrichmentLevel || "full");

      // Poll until complete
      await pollUntilComplete(async () => {
        const status = await getListStatus(listId);
        return { complete: status.complete, data: status };
      });

      // Fetch contacts
      const contacts = await getListContacts(listId);

      return {
        contacts,
        listId,
        count: contacts.length,
      };
    }
  );

  // Process Wiza contacts: create in Dynamics linked to accounts
  ipcMain.handle(
    "wiza:processContacts",
    async (_event, contacts: Array<Record<string, string>>) => {
      const results = {
        created: 0,
        existing: 0,
        errors: [] as string[],
      };

      for (const c of contacts) {
        const fullname = c.full_name || c.name || `${c.first_name || ""} ${c.last_name || ""}`.trim();
        const parts = fullname.split(" ");
        const company = c.company || c.company_name || "";
        const accountId = company ? findAccountId(company) : undefined;

        try {
          const result = await upsertContact({
            firstname: c.first_name || parts[0] || "",
            lastname: c.last_name || parts.slice(1).join(" ") || "",
            email: c.email || c.work_email || c.personal_email || "",
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
