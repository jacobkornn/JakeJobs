import { useState, useEffect } from "react";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api, type TrackedEmail, type EmailReply } from "../lib/ipc";

interface EmailDraft {
  contactEmail: string;
  contactName: string;
  company: string;
  subject: string;
  body: string;
  originalSubject: string;
  originalBody: string;
  edited: boolean;
  sent: boolean;
  personalized: boolean;
  personalizing: boolean;
  contactId?: string;
  jobId?: string;
  leadType: string;
}

const SALES_TEMPLATE = `<html><body>
Hi {{firstname}},<br>
<br>
Hope this message finds you well! I recently applied for the {{jobtitle}} position at {{company}} and wanted to reach out directly. With a CS background and startup experience applying machine learning to sales and marketing, I bring technical depth plus strong communication skills. Given your role as {{contacttitle}}, I'd love to connect and learn more about navigating potential opportunities at {{company}}.<br>
<br>
Best,<br>
Jacob Korn<br>
<br>
(425) 354-0440<br>
<a href="https://www.linkedin.com/in/jacob-korn-3aa792248/">My LinkedIn</a>
</body></html>`;

const ENGINEERING_TEMPLATE = `<html><body>
Hi {{firstname}},<br>
<br>
Hope this message finds you well! I recently applied for the {{jobtitle}} position at {{company}} and wanted to reach out directly. I am a software engineer with entrepreneurial experience building and applying machine learning to CRM data workflows. Given your role as {{contacttitle}}, I'd love to connect and learn more about navigating potential opportunities at {{company}}.<br>
<br>
Best,<br>
Jacob Korn<br>
<br>
(425) 354-0440<br>
<a href="https://www.linkedin.com/in/jacob-korn-3aa792248/">My LinkedIn</a>
</body></html>`;

function detectLeadType(jobTitle: string, contactTitle: string): string {
  const combined = `${jobTitle} ${contactTitle}`.toLowerCase();
  const salesKeywords = ["sales", "account executive", "bdr", "sdr", "business development", "revenue", "partnerships", "customer success", "solutions engineer", "sales engineer", "presales"];
  if (salesKeywords.some((k) => combined.includes(k))) return "sales";
  return "engineering";
}

export default function Outreach() {
  const [contacts, setContacts] = useState<Array<Record<string, string>>>([]);
  const [jobs, setJobs] = useState<Array<Record<string, string>>>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [sending, setSending] = useState<number | null>(null);
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);
  const [trackedEmails, setTrackedEmails] = useState<TrackedEmail[]>([]);
  const [replies, setReplies] = useState<EmailReply[]>([]);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [attachResumes, setAttachResumes] = useState(true);
  const [editingHtml, setEditingHtml] = useState(false);
  const [systemUserId, setSystemUserId] = useState<string | null>(null);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    loadData();
    loadTracking();
    // Cache systemuser ID for Dynamics activity logging
    if (api) {
      api.dynamics.getSystemUserId("jake.korn@theboxk.com").then(setSystemUserId).catch(() => {});
    }
  }, []);

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

  const loadTracking = async () => {
    if (!api) return;
    try {
      await api.graph.loadTrackedEmails();
      const tracked = await api.graph.getTrackedEmails();
      setTrackedEmails(tracked);
    } catch (err) {
      console.error("Failed to load tracked emails:", err);
    }
  };

  // Stage all emails using templates (no Claude)
  const handleStage = () => {
    if (contacts.length === 0) return;
    setMessages([]);

    // Build job lookup by account ID (contact's parent account → job title)
    const jobsByAccount = new Map<string, Record<string, string>>();
    const jobsByCompanyName = new Map<string, Record<string, string>>();
    for (const j of jobs) {
      const accId = j._cr21a_jobposting_value;
      if (accId && !jobsByAccount.has(accId)) jobsByAccount.set(accId, j);
      const name = (j.accountName || j.cr21a_companyname || "").toLowerCase().trim();
      if (name && !jobsByCompanyName.has(name)) jobsByCompanyName.set(name, j);
    }

    const emailDrafts: EmailDraft[] = [];

    for (const contact of contacts) {
      const email = contact.emailaddress1 || "";
      if (!email) continue;

      const firstname = contact.firstname || contact.fullname?.split(" ")[0] || "";
      const contactTitle = contact.jobtitle || "";
      const contactLeadType = contact.cr21a_leadtype || "";
      const accountId = contact._parentcustomerid_value || "";

      // Find related job - first by account ID, then by company name
      const relatedJob = jobsByAccount.get(accountId)
        || (contact.accountName ? jobsByCompanyName.get(contact.accountName.toLowerCase().trim()) : undefined);

      // Resolve company name: account name → job's company name → empty
      const accountName = contact.accountName || relatedJob?.accountName || relatedJob?.cr21a_companyname || "";
      const jobTitle = relatedJob?.cr21a_jobtitle || "";

      // Determine lead type: use Dynamics cr21a_leadtype if set, otherwise detect from titles
      const leadType = contactLeadType
        ? contactLeadType.toLowerCase()
        : detectLeadType(jobTitle, contactTitle);
      const template = leadType === "sales" ? SALES_TEMPLATE : ENGINEERING_TEMPLATE;

      const body = template
        .replace(/\{\{firstname\}\}/g, firstname)
        .replace(/\{\{company\}\}/g, accountName)
        .replace(/\{\{jobtitle\}\}/g, jobTitle)
        .replace(/\{\{contacttitle\}\}/g, contactTitle);

      const subject = `Introduction - Interested in ${accountName}`;

      emailDrafts.push({
        contactEmail: email,
        contactName: contact.fullname || `${firstname} ${contact.lastname || ""}`.trim(),
        company: accountName,
        subject,
        body,
        originalSubject: subject,
        originalBody: body,
        edited: false,
        sent: false,
        personalized: false,
        personalizing: false,
        contactId: contact.contactid,
        jobId: relatedJob?.cr21a_jobpostingid,
        leadType,
      });
    }

    setDrafts(emailDrafts);
    if (emailDrafts.length > 0) setSelectedDraft(0);
    addMessage(`Staged ${emailDrafts.length} emails from templates.`, "success");
  };

  // Personalize a single draft with Claude
  const handlePersonalize = async (index: number) => {
    if (!api) return;
    const draft = drafts[index];
    if (!draft || draft.sent || draft.personalizing) return;

    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, personalizing: true } : d))
    );

    try {
      const contact = contacts.find(
        (c) => (c.email || c.emailaddress1 || "").toLowerCase() === draft.contactEmail.toLowerCase()
      );

      const relatedJobs = jobs.filter(
        (j) => (j.accountName || j.cr21a_companyname || j.companyName || j.company || "").toLowerCase() === draft.company.toLowerCase()
      );

      const result = await api.claude.personalizeEmails({
        contacts: contact ? [contact] : [],
        template: draft.body,
        jobs: relatedJobs,
        leadType: draft.leadType,
      });

      if (result.length > 0) {
        setDrafts((prev) =>
          prev.map((d, i) =>
            i === index
              ? { ...d, subject: result[0].subject, body: result[0].body, personalized: true, personalizing: false }
              : d
          )
        );
        addMessage(`Personalized email for ${draft.contactName}.`, "success");
      } else {
        setDrafts((prev) =>
          prev.map((d, i) => (i === index ? { ...d, personalizing: false } : d))
        );
        addMessage(`Claude returned no result for ${draft.contactName}.`, "warning");
      }
    } catch (err) {
      setDrafts((prev) =>
        prev.map((d, i) => (i === index ? { ...d, personalizing: false } : d))
      );
      addMessage(`Personalization failed for ${draft.contactName}: ${String(err)}`, "error");
    }
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
      // Load attachments based on lead type
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
        if (result.tracked) {
          setTrackedEmails((prev) => [...prev, result.tracked!]);
        }
        await api.graph.saveTrackedEmails();

        // Log email as activity in Dynamics
        if (systemUserId && draft.contactId) {
          try {
            await api.dynamics.logEmailActivity({
              contactId: draft.contactId,
              subject: draft.subject,
              body: draft.body,
              senderSystemUserId: systemUserId,
              jobPostingId: draft.jobId,
            });
          } catch (err) {
            addMessage(`Sent but failed to log activity in Dynamics: ${String(err)}`, "warning");
          }
        }

        addMessage(`Sent to ${draft.contactEmail} (${draft.leadType})`, "success");
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

  const isTracked = (email: string) =>
    trackedEmails.some((t) => t.to.toLowerCase() === email.toLowerCase());

  const hasReply = (email: string) =>
    replies.some((r) => r.replyFrom.toLowerCase() === email.toLowerCase());

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Outreach</h2>
      <p className="text-sm text-gray-500 mb-6">
        Personalized emails with resume/cover letter attached per lead type (sales vs engineering)
      </p>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={handleStage}
          disabled={contacts.length === 0}
          className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          Stage {contacts.length} emails
        </button>
        <button
          onClick={loadData}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          Refresh contacts
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

      {/* Reply tracking section */}
      <div className="mt-6 mb-6">
        <div className="flex items-center gap-4 mb-3">
          <h3 className="text-sm font-medium text-gray-400">Reply Tracking</h3>
          <button
            onClick={handleCheckReplies}
            disabled={checkingReplies || trackedEmails.length === 0}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:text-gray-600 text-gray-300 text-xs rounded transition-colors"
          >
            {checkingReplies ? "Checking..." : "Check for replies"}
          </button>
          <span className="text-xs text-gray-600">
            {trackedEmails.length} emails tracked
          </span>
        </div>

        {replies.length > 0 && (
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
        )}
      </div>

      {/* Drafts */}
      {drafts.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-3">
            <h3 className="text-sm font-medium text-gray-400">{drafts.length} Drafts</h3>
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
                    {draft.personalized && (
                      <span className="text-[10px] text-purple-400 shrink-0">AI</span>
                    )}
                    {draft.personalizing && (
                      <span className="text-[10px] text-purple-300 shrink-0 animate-pulse">...</span>
                    )}
                    {draft.sent && (
                      <span className="text-[10px] text-green-400 shrink-0">sent</span>
                    )}
                    {hasReply(draft.contactEmail) && (
                      <span className="text-[10px] text-green-300 bg-green-900/30 px-1.5 py-0.5 rounded shrink-0">
                        replied
                      </span>
                    )}
                    {!draft.sent && isTracked(draft.contactEmail) && (
                      <span className="text-[10px] text-yellow-400 shrink-0">prev sent</span>
                    )}
                  </div>
                  <p className="text-xs text-orange-400 truncate">{contacts.find((c) => (c.emailaddress1 || "").toLowerCase() === draft.contactEmail.toLowerCase())?.jobtitle || ""}</p>
                  <p className="text-xs text-gray-500 truncate">{draft.company}</p>
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
                  <span className={`text-xs px-2 py-1 rounded ${
                    drafts[selectedDraft].leadType === "sales"
                      ? "text-orange-400 bg-orange-900/30"
                      : "text-blue-400 bg-blue-900/30"
                  }`}>
                    {drafts[selectedDraft].leadType} template
                  </span>
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
                      rows={12}
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
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-green-400">Sent</span>
                    {hasReply(drafts[selectedDraft].contactEmail) && (
                      <span className="text-sm text-green-300 bg-green-900/30 px-2 py-0.5 rounded">
                        Replied
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {drafts[selectedDraft].personalized ? (
                      <button
                        onClick={() => {
                          setDrafts((prev) =>
                            prev.map((d, i) =>
                              i === selectedDraft
                                ? { ...d, subject: d.originalSubject, body: d.originalBody, personalized: false, edited: false }
                                : d
                            )
                          );
                          addMessage(`Reverted email for ${drafts[selectedDraft].contactName}.`, "info");
                        }}
                        className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors"
                      >
                        Revert to original
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePersonalize(selectedDraft)}
                        disabled={drafts[selectedDraft].personalizing}
                        className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors"
                      >
                        {drafts[selectedDraft].personalizing ? "Personalizing..." : "Personalize with Claude"}
                      </button>
                    )}
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
  );
}
