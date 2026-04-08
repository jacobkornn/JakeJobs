import { useState, useEffect } from "react";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api, type TrackedEmail, type EmailReply } from "../lib/ipc";

interface FollowUpDraft {
  contactEmail: string;
  contactName: string;
  company: string;
  jobTitle: string;
  subject: string;
  body: string;
  originalSubject: string;
  originalBody: string;
  edited: boolean;
  sent: boolean;
  contactId?: string;
  jobId?: string;
  leadType: string;
  originalSentAt: string;
  originalEmailSubject: string;
}

const FOLLOWUP_TEMPLATE = `<html><body>
Hi {{firstname}},<br>
<br>
Just wanted to make sure you saw my message. I'd love to connect and learn more about {{company}} and the {{jobtitle}} position available! Just let me know if there is a time that works for you for a quick chat.<br>
<br>
Best,<br>
Jacob Korn<br>
<br>
(425) 354-0440<br>
<a href="https://www.linkedin.com/in/jacob-korn-3aa792248/">My LinkedIn</a>
</body></html>`;

type TimeframeOption = "3d" | "1w" | "2w" | "1m";

const TIMEFRAME_OPTIONS: { value: TimeframeOption; label: string; days: number }[] = [
  { value: "3d", label: "3 days", days: 3 },
  { value: "1w", label: "1 week", days: 7 },
  { value: "2w", label: "2 weeks", days: 14 },
  { value: "1m", label: "1 month", days: 30 },
];

export default function FollowUp() {
  const [contacts, setContacts] = useState<Array<Record<string, string>>>([]);
  const [jobs, setJobs] = useState<Array<Record<string, string>>>([]);
  const [trackedEmails, setTrackedEmails] = useState<TrackedEmail[]>([]);
  const [replies, setReplies] = useState<EmailReply[]>([]);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeOption>("1w");
  const [drafts, setDrafts] = useState<FollowUpDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [staging, setStaging] = useState(false);
  const [editingHtml, setEditingHtml] = useState(false);
  const [attachResumes, setAttachResumes] = useState(false);
  const [systemUserId, setSystemUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    if (!api) return;
    setLoading(true);
    try {
      // Resolve the systemuser first — tracked emails are filtered by owner.
      const uid = await api.dynamics
        .getSystemUserId("jake.korn@theboxk.com")
        .catch(() => null);
      setSystemUserId(uid);
      await Promise.all([loadData(), loadTracking(uid)]);
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    if (!api) return;
    try {
      const [contactsResult, jobsResult] = await Promise.all([
        api.dynamics.getContacts(),
        api.dynamics.getJobs(),
      ]);
      setContacts(contactsResult as unknown as Array<Record<string, string>>);
      setJobs(jobsResult);
    } catch (err) {
      console.error("Failed to load data:", err);
    }
  };

  const loadTracking = async (uid: string | null) => {
    if (!api || !uid) return;
    try {
      const tracked = await api.dynamics.getSentEmails(uid);
      setTrackedEmails(tracked);
    } catch (err) {
      console.error("Failed to load tracked emails from Dynamics:", err);
    }
  };

  const handleCheckReplies = async () => {
    if (!api) return;
    setCheckingReplies(true);
    try {
      const newReplies = await api.graph.checkReplies(trackedEmails);
      setReplies(newReplies);
      if (newReplies.length > 0) {
        addMessage(`Found ${newReplies.length} reply(ies)!`, "success");
      } else {
        addMessage("No new replies found.", "info");
      }
    } catch (err) {
      addMessage(`Failed to check replies: ${String(err)}`, "error");
    } finally {
      setCheckingReplies(false);
    }
  };

  // Get emails sent without a reply within the selected timeframe
  const getUnrepliedEmails = (): TrackedEmail[] => {
    const days = TIMEFRAME_OPTIONS.find((t) => t.value === timeframe)?.days || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const repliedAddresses = new Set(
      replies.map((r) => r.replyFrom.toLowerCase())
    );

    return trackedEmails.filter((t) => {
      const sentDate = new Date(t.sentAt);
      return sentDate <= cutoff && !repliedAddresses.has(t.to.toLowerCase());
    });
  };

  const unrepliedEmails = getUnrepliedEmails();

  // Find the Dynamics contact record matching a tracked email
  const findContact = (email: string) =>
    contacts.find((c) => (c.emailaddress1 || "").toLowerCase() === email.toLowerCase());

  // Find the related job for a contact
  const findJob = (contact: Record<string, string> | undefined, tracked: TrackedEmail) => {
    // First try via tracked jobId
    if (tracked.jobId) {
      const job = jobs.find((j) => j.cr21a_jobpostingid === tracked.jobId);
      if (job) return job;
    }
    // Then try via contact's parent account
    if (contact) {
      const accountId = contact._parentcustomerid_value;
      if (accountId) {
        const job = jobs.find((j) => j._cr21a_jobposting_value === accountId);
        if (job) return job;
      }
      // Finally try by company name
      const companyName = (contact.accountName || "").toLowerCase().trim();
      if (companyName) {
        const job = jobs.find((j) =>
          (j.accountName || j.cr21a_companyname || "").toLowerCase().trim() === companyName
        );
        if (job) return job;
      }
    }
    return undefined;
  };

  // Stage follow-up drafts — fetches original email bodies for conversation history
  const handleStageFollowUps = async () => {
    if (!api || unrepliedEmails.length === 0) return;
    setMessages([]);
    setStaging(true);
    addMessage(`Staging ${unrepliedEmails.length} follow-ups — fetching original emails...`, "info");

    const followUpDrafts: FollowUpDraft[] = [];

    for (const tracked of unrepliedEmails) {
      const contact = findContact(tracked.to);
      const job = findJob(contact, tracked);

      // Resolve real names from Dynamics data
      const firstname = contact?.firstname || contact?.fullname?.split(" ")[0] || tracked.to.split("@")[0].split(".")[0];
      const contactName = contact?.fullname || `${firstname} ${contact?.lastname || ""}`.trim() || firstname;
      const company = contact?.accountName || job?.accountName || job?.cr21a_companyname || "";
      const jobTitle = job?.cr21a_jobtitle || "";
      const leadType = contact?.cr21a_leadtype?.toLowerCase() || "engineering";

      // Original body is stored on the Dynamics email activity (description field).
      const originalEmailHtml = tracked.body || "";

      // Build follow-up body with conversation thread
      const followUpBody = FOLLOWUP_TEMPLATE
        .replace(/\{\{firstname\}\}/g, firstname)
        .replace(/\{\{company\}\}/g, company)
        .replace(/\{\{jobtitle\}\}/g, jobTitle);

      // Build full email with quoted original below
      const sentDate = new Date(tracked.sentAt);
      const dateStr = sentDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

      const fullBody = originalEmailHtml
        ? `${followUpBody.replace("</body></html>", "")}<br><br><div style="border-left: 2px solid #ccc; padding-left: 12px; margin-top: 16px; color: #666;"><p style="font-size: 12px; color: #999;">On ${dateStr}, Jacob Korn wrote:</p>${originalEmailHtml.replace(/<\/?html>|<\/?body>/gi, "")}</div></body></html>`
        : followUpBody;

      const subject = `Re: ${tracked.subject}`;

      followUpDrafts.push({
        contactEmail: tracked.to,
        contactName,
        company,
        jobTitle,
        subject,
        body: fullBody,
        originalSubject: subject,
        originalBody: fullBody,
        edited: false,
        sent: false,
        contactId: tracked.contactId || contact?.contactid,
        jobId: tracked.jobId || job?.cr21a_jobpostingid,
        leadType,
        originalSentAt: tracked.sentAt,
        originalEmailSubject: tracked.subject,
      });
    }

    setDrafts(followUpDrafts);
    if (followUpDrafts.length > 0) setSelectedDraft(0);
    setStaging(false);
    addMessage(`Staged ${followUpDrafts.length} follow-up emails with conversation history.`, "success");
  };

  const updateDraft = (index: number, field: "subject" | "body", value: string) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value, edited: true } : d))
    );
  };

  const handleSendEmail = async (index: number) => {
    if (!api) return;
    const draft = drafts[index];
    if (!draft || draft.sent) return;

    setSending(index);
    try {
      let attachments: Array<{ name: string; contentBytes: string; contentType: string }> = [];
      if (attachResumes) {
        attachments = await api.files.getAttachments(draft.leadType);
      }

      const result = await api.graph.sendEmail({
        to: draft.contactEmail,
        subject: draft.subject,
        bodyHtml: draft.body,
        contactId: draft.contactId,
        jobId: draft.jobId,
        attachments,
      });

      if (result.success) {
        setDrafts((prev) =>
          prev.map((d, i) => (i === index ? { ...d, sent: true } : d))
        );

        // Log follow-up activity in Dynamics (this is the source of truth
        // for tracked emails). Refresh the tracked list afterward so the
        // newly-sent follow-up replaces the stale original in the view.
        if (systemUserId && draft.contactId) {
          try {
            await api.dynamics.logEmailActivity({
              contactId: draft.contactId,
              subject: draft.subject,
              body: draft.body,
              senderSystemUserId: systemUserId,
              jobPostingId: draft.jobId,
            });
            await loadTracking(systemUserId);
          } catch (err) {
            addMessage(`Sent but failed to log activity in Dynamics: ${String(err)}`, "warning");
          }
        }

        addMessage(`Follow-up sent to ${draft.contactEmail}`, "success");
      }
    } catch (err) {
      addMessage(`Failed to send to ${draft.contactEmail}: ${String(err)}`, "error");
    } finally {
      setSending(null);
    }
  };

  const handleSendAll = async () => {
    const unsent = drafts.reduce<number[]>((acc, d, i) => {
      if (!d.sent) acc.push(i);
      return acc;
    }, []);

    for (const index of unsent) {
      await handleSendEmail(index);
    }
  };

  const daysSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Helper to get display name for unreplied list
  const getContactDisplayName = (email: string) => {
    const contact = findContact(email);
    return contact?.fullname || email;
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Follow-Up after Outreach</h2>
      <p className="text-sm text-gray-500 mb-6">
        Track replies and send follow-ups to contacts who haven't responded
      </p>

      {/* ═══ Reply Tracking Section (top quarter) ═══ */}
      <div className="mb-8 bg-gray-900 border border-gray-800 rounded-lg p-5">
        <div className="flex items-center gap-4 mb-4">
          <h3 className="text-base font-medium text-white">Reply Scanner</h3>
          <button
            onClick={handleCheckReplies}
            disabled={checkingReplies || trackedEmails.length === 0}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors"
          >
            {checkingReplies ? "Scanning..." : "Scan for replies"}
          </button>
          <span className="text-xs text-gray-600">
            {trackedEmails.length} emails tracked
          </span>
        </div>

        {replies.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-auto">
            {replies.map((reply, i) => (
              <div
                key={i}
                className="bg-green-900/20 border border-green-700/30 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-green-400 text-sm font-medium">{reply.replyFrom}</span>
                  <span className="text-xs text-gray-500">replied</span>
                  <span className="text-xs text-gray-600">
                    {new Date(reply.replyReceivedAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{reply.replySubject}</p>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{reply.replyPreview}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">
            {loading ? "Loading tracked emails..." : "No replies yet. Click scan to check your inbox."}
          </p>
        )}
      </div>

      {/* ═══ Follow-Up Section (rest of page) ═══ */}
      <div>
        <div className="flex items-center gap-4 mb-4">
          <h3 className="text-base font-medium text-white">Unreplied Contacts</h3>

          {/* Timeframe toggle */}
          <div className="flex bg-gray-800 rounded-lg p-0.5">
            {TIMEFRAME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimeframe(opt.value)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  timeframe === opt.value
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-xs text-gray-600">
            {unrepliedEmails.length} contacts without a reply
          </span>
        </div>

        {/* Stage controls */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={handleStageFollowUps}
            disabled={unrepliedEmails.length === 0 || staging}
            className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
          >
            {staging ? "Staging..." : `Stage ${unrepliedEmails.length} follow-ups`}
          </button>
          <button
            onClick={loadAll}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Refresh tracking
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-400 ml-4">
            <input
              type="checkbox"
              checked={attachResumes}
              onChange={(e) => setAttachResumes(e.target.checked)}
              className="rounded"
            />
            Attach resume + cover letter
          </label>
        </div>

        <StatusFeed messages={messages} />

        {/* Unreplied contact list (when no drafts staged) */}
        {drafts.length === 0 && unrepliedEmails.length > 0 && (
          <div className="mt-4 border border-gray-800 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_1fr_100px] gap-4 px-4 py-2 bg-gray-800/50 text-xs text-gray-500 font-medium">
              <span>Contact</span>
              <span>Company</span>
              <span>Original Subject</span>
              <span>Sent</span>
            </div>
            <div className="max-h-[400px] overflow-auto">
              {unrepliedEmails.map((email, i) => {
                const contact = findContact(email.to);
                const job = findJob(contact, email);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_1fr_100px] gap-4 px-4 py-2.5 border-t border-gray-800/50 text-sm"
                  >
                    <div>
                      <span className="text-gray-300 truncate block">{getContactDisplayName(email.to)}</span>
                      <span className="text-xs text-gray-600 truncate block">{email.to}</span>
                    </div>
                    <span className="text-gray-500 truncate">{contact?.accountName || job?.cr21a_companyname || ""}</span>
                    <span className="text-gray-500 truncate">{email.subject}</span>
                    <span className="text-gray-600 text-xs">
                      {daysSince(email.sentAt)}d ago
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Drafts */}
        {drafts.length > 0 && (
          <>
            <div className="flex items-center gap-4 mb-3 mt-4">
              <h3 className="text-sm font-medium text-gray-400">{drafts.length} Follow-Up Drafts</h3>
              <button
                onClick={handleSendAll}
                disabled={sending !== null || drafts.every((d) => d.sent)}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors"
              >
                Send all unsent
              </button>
            </div>

            <div className="flex gap-4">
              {/* Draft list */}
              <div className="w-72 shrink-0 border border-gray-800 rounded-lg overflow-auto max-h-[500px]">
                {drafts.map((draft, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedDraft(i)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-800 transition-colors ${
                      selectedDraft === i ? "bg-gray-800" : "hover:bg-gray-900"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-200 truncate flex-1">{draft.contactName}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        draft.leadType === "sales"
                          ? "text-orange-400 bg-orange-900/30"
                          : "text-blue-400 bg-blue-900/30"
                      }`}>
                        {draft.leadType}
                      </span>
                      {draft.sent && (
                        <span className="text-[10px] text-green-400 shrink-0">sent</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{draft.company}</p>
                    <p className="text-xs text-gray-600 truncate">{draft.jobTitle}</p>
                    <p className="text-[10px] text-gray-600">
                      Original sent {daysSince(draft.originalSentAt)}d ago
                    </p>
                    {draft.edited && !draft.sent && (
                      <span className="text-[10px] text-yellow-500">edited</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Draft editor */}
              {selectedDraft !== null && drafts[selectedDraft] && (
                <div className="flex-1 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500">To</label>
                      <p className="text-sm text-gray-300">{drafts[selectedDraft].contactEmail}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded text-yellow-400 bg-yellow-900/30">
                      follow-up
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      drafts[selectedDraft].leadType === "sales"
                        ? "text-orange-400 bg-orange-900/30"
                        : "text-blue-400 bg-blue-900/30"
                    }`}>
                      {drafts[selectedDraft].leadType}
                    </span>
                  </div>
                  <div className="mb-2">
                    <p className="text-[10px] text-gray-600">
                      Original: &ldquo;{drafts[selectedDraft].originalEmailSubject}&rdquo; — sent {daysSince(drafts[selectedDraft].originalSentAt)}d ago
                    </p>
                  </div>
                  <div className="mb-3">
                    <label className="text-xs text-gray-500">Subject</label>
                    <input
                      type="text"
                      value={drafts[selectedDraft].subject}
                      onChange={(e) => updateDraft(selectedDraft, "subject", e.target.value)}
                      disabled={drafts[selectedDraft].sent}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 mt-1 disabled:opacity-50"
                    />
                  </div>
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs text-gray-500">Body</label>
                      {!drafts[selectedDraft].sent && (
                        <button
                          onClick={() => setEditingHtml(!editingHtml)}
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          {editingHtml ? "Preview" : "Edit HTML"}
                        </button>
                      )}
                    </div>
                    {editingHtml && !drafts[selectedDraft].sent ? (
                      <textarea
                        value={drafts[selectedDraft].body}
                        onChange={(e) => updateDraft(selectedDraft, "body", e.target.value)}
                        rows={16}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
                      />
                    ) : (
                      <div
                        className="w-full bg-white rounded px-4 py-3 text-sm text-gray-900 border border-gray-300 min-h-[200px] overflow-auto prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: drafts[selectedDraft].body }}
                      />
                    )}
                  </div>
                  {attachResumes && (
                    <p className="text-xs text-gray-600 mb-3">
                      Attachments: Jacob_Korn_Resume.pdf, Jacob_Korn_CoverLetter.pdf ({drafts[selectedDraft].leadType})
                    </p>
                  )}
                  {drafts[selectedDraft].sent ? (
                    <span className="text-sm text-green-400">Sent</span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleSendEmail(selectedDraft)}
                        disabled={sending === selectedDraft}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm rounded transition-colors"
                      >
                        {sending === selectedDraft ? "Sending..." : "Send via Graph"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
