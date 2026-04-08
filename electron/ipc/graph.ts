import { IpcMain } from "electron";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { dynamicsFetch, fetchAllPaginated } from "./dynamics";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let msalClient: ConfidentialClientApplication | null = null;
let cachedToken: string | null = null;
let tokenExpiry = 0;

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
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire Graph token");
  cachedToken = result.accessToken;
  tokenExpiry = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3600_000;
  return cachedToken;
}

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return graphFetch(path, options);
  }

  return res;
}

/**
 * The user principal (email) for Graph mailbox operations.
 * Uses OUTLOOK_ACCOUNT from .env.
 */
function getUserPrincipal(): string {
  const email = process.env.OUTLOOK_ACCOUNT;
  if (!email) throw new Error("OUTLOOK_ACCOUNT not configured in .env");
  return email;
}

export interface EmailAttachment {
  name: string;
  contentBytes: string; // base64
  contentType: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  bodyHtml: string;
  contactId?: string;
  jobId?: string;
  attachments?: EmailAttachment[];
}

export interface TrackedEmail {
  messageId: string;
  conversationId: string;
  to: string;
  subject: string;
  sentAt: string;
  contactId?: string;
  jobId?: string;
}

// In-memory store of sent emails for reply matching
// In production this would be persisted to disk
const sentEmails = new Map<string, TrackedEmail>();

export function registerGraphHandlers(ipcMain: IpcMain) {
  /**
   * Send an email via Microsoft Graph
   */
  ipcMain.handle("graph:sendEmail", async (_event, email: OutboundEmail) => {
    const user = getUserPrincipal();

    const message: Record<string, unknown> = {
      message: {
        subject: email.subject,
        body: {
          contentType: "HTML",
          content: email.bodyHtml,
        },
        toRecipients: [
          {
            emailAddress: { address: email.to },
          },
        ],
        attachments: (email.attachments || []).map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.contentBytes,
        })),
      },
      saveToSentItems: true,
    };

    const res = await graphFetch(`/users/${user}/sendMail`, {
      method: "POST",
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to send email: ${res.status} ${errText}`);
    }

    // After sending, find the sent message to get its conversationId for tracking
    // Small delay to allow Graph to index the sent message
    await new Promise((r) => setTimeout(r, 2000));

    const sentRes = await graphFetch(
      `/users/${user}/mailFolders/sentItems/messages?$filter=subject eq '${email.subject.replace(/'/g, "''")}'&$top=1&$orderby=sentDateTime desc&$select=id,conversationId,subject,sentDateTime`
    );

    let tracked: TrackedEmail | null = null;
    if (sentRes.ok) {
      const data = await sentRes.json();
      const msg = data.value?.[0];
      if (msg) {
        tracked = {
          messageId: msg.id,
          conversationId: msg.conversationId,
          to: email.to,
          subject: email.subject,
          sentAt: msg.sentDateTime || new Date().toISOString(),
          contactId: email.contactId,
          jobId: email.jobId,
        };
        sentEmails.set(msg.conversationId, tracked);
      }
    }

    return { success: true, tracked };
  });

  /**
   * Check inbox for replies to a provided list of tracked outbound emails.
   * The caller supplies the tracked list (typically sourced from Dynamics
   * email activities) so this handler is stateless and works standalone.
   *
   * For each unique recipient we query the inbox for messages from that
   * sender received on/after the earliest send date, and match them back to
   * the most recent send to that address.
   */
  ipcMain.handle(
    "graph:checkReplies",
    async (_event, tracked: TrackedEmail[] = []) => {
      if (!tracked || tracked.length === 0) return [];

      const user = getUserPrincipal();

      // Group tracked emails by lowercased recipient, keeping the earliest
      // sentAt (to bound the inbox query) and the latest send (to attribute
      // the reply to the most recent outreach).
      type Bucket = {
        earliest: string;
        latest: TrackedEmail;
      };
      const byAddress = new Map<string, Bucket>();
      for (const t of tracked) {
        if (!t.to) continue;
        const key = t.to.toLowerCase();
        const existing = byAddress.get(key);
        if (!existing) {
          byAddress.set(key, { earliest: t.sentAt, latest: t });
          continue;
        }
        if (new Date(t.sentAt) < new Date(existing.earliest)) {
          existing.earliest = t.sentAt;
        }
        if (new Date(t.sentAt) > new Date(existing.latest.sentAt)) {
          existing.latest = t;
        }
      }

      const replies: Array<{
        originalEmail: TrackedEmail;
        replyFrom: string;
        replySubject: string;
        replyPreview: string;
        replyReceivedAt: string;
      }> = [];

      for (const [address, bucket] of byAddress) {
        const safeAddr = address.replace(/'/g, "''");
        const since = new Date(bucket.earliest).toISOString();
        const filter = `from/emailAddress/address eq '${safeAddr}' and receivedDateTime ge ${since}`;
        const res = await graphFetch(
          `/users/${user}/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$top=5&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,receivedDateTime`
        );
        if (!res.ok) continue;
        const data = await res.json();
        for (const msg of data.value || []) {
          const fromAddr = msg.from?.emailAddress?.address?.toLowerCase();
          if (!fromAddr || fromAddr !== address) continue;
          replies.push({
            originalEmail: bucket.latest,
            replyFrom: fromAddr,
            replySubject: msg.subject || "",
            replyPreview: msg.bodyPreview || "",
            replyReceivedAt: msg.receivedDateTime || "",
          });
        }
      }

      return replies;
    }
  );

  /**
   * Get all tracked outbound emails
   */
  ipcMain.handle("graph:getTrackedEmails", async () => {
    return Array.from(sentEmails.values());
  });

  /**
   * Load tracked emails from disk (persistence)
   */
  ipcMain.handle("graph:loadTrackedEmails", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(__dirname, "..", "..", "data", "tracked_emails.json");
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      sentEmails.clear();
      for (const email of data) {
        sentEmails.set(email.conversationId, email);
      }
      return data.length;
    } catch {
      return 0;
    }
  });

  /**
   * Fetch the HTML body of a sent message by its messageId.
   * Used to include original email content in follow-up replies.
   */
  ipcMain.handle("graph:getMessageBody", async (_event, messageId: string) => {
    const user = getUserPrincipal();
    const res = await graphFetch(
      `/users/${user}/messages/${messageId}?$select=body,subject,sentDateTime,toRecipients`
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to fetch message: ${res.status} ${errText}`);
    }
    const msg = await res.json();
    return {
      body: msg.body?.content || "",
      subject: msg.subject || "",
      sentAt: msg.sentDateTime || "",
    };
  });

  /**
   * Save tracked emails to disk
   */
  ipcMain.handle("graph:saveTrackedEmails", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.join(__dirname, "..", "..", "data");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "tracked_emails.json");
    const data = Array.from(sentEmails.values());
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return data.length;
  });

  /**
   * Backfill Dynamics email activities from the user's Graph Sent Items.
   *
   * For each sent message whose sole recipient is a known Dynamics contact
   * and which does not already have a matching activity, this creates an
   * email activity with actualend set to the real send time.
   *
   * Returns a summary: { scanned, matched, created, skipped, unmatched, errors }.
   */
  ipcMain.handle(
    "graph:backfillSentEmails",
    async (
      _event,
      params: { senderSystemUserId: string; sinceIso?: string; maxMessages?: number }
    ) => {
      if (!params?.senderSystemUserId) throw new Error("senderSystemUserId required");
      const user = getUserPrincipal();
      const max = params.maxMessages ?? 2000;

      // 1. Fetch Dynamics contacts, build email → contactid map.
      const contactsRes = await dynamicsFetch(
        "/contacts?$select=contactid,emailaddress1"
      );
      if (!contactsRes.ok) throw new Error(`Failed to fetch contacts: ${contactsRes.status}`);
      const contactsData = await contactsRes.json();
      const contactByEmail = new Map<string, string>();
      for (const c of contactsData.value || []) {
        const em = (c.emailaddress1 || "").toLowerCase();
        if (em && c.contactid) contactByEmail.set(em, c.contactid);
      }

      // 2. Fetch existing email activity subjects/recipients for dedupe.
      //    Key: `${to-lower}|${subject}` — duplicates are skipped.
      const existing = await fetchAllPaginated<{
        subject?: string;
        email_activity_parties?: Array<{
          participationtypemask?: number;
          addressused?: string;
        }>;
      }>(
        "/emails?$select=subject,activityid&$filter=directioncode eq true&$expand=email_activity_parties($select=addressused,participationtypemask)"
      );
      const existingKeys = new Set<string>();
      for (const e of existing) {
        const toParty = (e.email_activity_parties || []).find(
          (p) => p.participationtypemask === 2
        );
        const addr = (toParty?.addressused || "").toLowerCase();
        if (!addr) continue;
        existingKeys.add(`${addr}|${e.subject || ""}`);
      }

      // 3. Page through Graph Sent Items.
      type SentMsg = {
        id: string;
        subject?: string;
        body?: { contentType?: string; content?: string };
        toRecipients?: Array<{ emailAddress?: { address?: string } }>;
        sentDateTime?: string;
      };
      const messages: SentMsg[] = [];
      let next: string | null =
        `/users/${user}/mailFolders/sentItems/messages` +
        `?$select=id,subject,body,toRecipients,sentDateTime` +
        `&$orderby=sentDateTime desc&$top=100` +
        (params.sinceIso ? `&$filter=sentDateTime ge ${params.sinceIso}` : "");
      while (next && messages.length < max) {
        const res: Response = await graphFetch(next);
        if (!res.ok) throw new Error(`Graph sent items failed: ${res.status} ${await res.text()}`);
        const data: { value?: SentMsg[]; "@odata.nextLink"?: string } = await res.json();
        for (const m of data.value || []) messages.push(m);
        next = data["@odata.nextLink"] || null;
      }

      // 4. For each message, match to a contact, dedupe, and create activity.
      let matched = 0;
      let created = 0;
      let skipped = 0;
      let unmatched = 0;
      const errors: string[] = [];

      for (const msg of messages) {
        const recipients = msg.toRecipients || [];
        if (recipients.length !== 1) {
          unmatched++;
          continue;
        }
        const to = (recipients[0].emailAddress?.address || "").toLowerCase();
        if (!to) {
          unmatched++;
          continue;
        }
        const contactId = contactByEmail.get(to);
        if (!contactId) {
          unmatched++;
          continue;
        }
        matched++;

        const subject = msg.subject || "";
        const key = `${to}|${subject}`;
        if (existingKeys.has(key)) {
          skipped++;
          continue;
        }

        const payload: Record<string, unknown> = {
          subject,
          description: msg.body?.content || "",
          directioncode: true,
          actualend: msg.sentDateTime,
          email_activity_parties: [
            {
              "partyid_systemuser@odata.bind": `/systemusers(${params.senderSystemUserId})`,
              participationtypemask: 1,
            },
            {
              "partyid_contact@odata.bind": `/contacts(${contactId})`,
              participationtypemask: 2,
            },
          ],
          "regardingobjectid_contact@odata.bind": `/contacts(${contactId})`,
        };

        const createRes = await dynamicsFetch("/emails", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!createRes.ok) {
          errors.push(`${to} / ${subject}: ${createRes.status} ${await createRes.text()}`);
          continue;
        }
        created++;
        existingKeys.add(key);
      }

      return {
        scanned: messages.length,
        matched,
        created,
        skipped,
        unmatched,
        errors: errors.slice(0, 20),
      };
    }
  );
}
