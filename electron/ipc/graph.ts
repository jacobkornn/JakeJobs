import { IpcMain } from "electron";
import { ConfidentialClientApplication } from "@azure/msal-node";

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
   * Check inbox for replies to tracked outbound emails.
   * Returns any new replies found since last check.
   */
  ipcMain.handle("graph:checkReplies", async () => {
    if (sentEmails.size === 0) return [];

    const user = getUserPrincipal();
    const replies: Array<{
      originalEmail: TrackedEmail;
      replyFrom: string;
      replySubject: string;
      replyPreview: string;
      replyReceivedAt: string;
    }> = [];

    // Check inbox for messages in tracked conversations
    const conversationIds = Array.from(sentEmails.keys());

    for (const convId of conversationIds) {
      const tracked = sentEmails.get(convId)!;

      const res = await graphFetch(
        `/users/${user}/mailFolders/inbox/messages?$filter=conversationId eq '${convId}'&$top=5&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,receivedDateTime,isRead`
      );

      if (!res.ok) continue;

      const data = await res.json();
      for (const msg of data.value || []) {
        const fromAddr = msg.from?.emailAddress?.address?.toLowerCase();
        // Only count messages FROM the recipient (not our own messages)
        if (fromAddr && fromAddr === tracked.to.toLowerCase()) {
          replies.push({
            originalEmail: tracked,
            replyFrom: fromAddr,
            replySubject: msg.subject || "",
            replyPreview: msg.bodyPreview || "",
            replyReceivedAt: msg.receivedDateTime || "",
          });
        }
      }
    }

    return replies;
  });

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
}
