import { useState, useEffect } from "react";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api, type TrackedEmail, type EmailReply } from "../lib/ipc";

interface EmailDraft {
  contactEmail: string;
  contactName: string;
  company: string;
  subject: string;
  body: string;
  edited: boolean;
  sent: boolean;
  contactId?: string;
  jobId?: string;
}

const DEFAULT_TEMPLATE = `Hi {{name}},

I came across {{company}} and was really impressed by what your team is building. I'm a software engineer with experience in full-stack development and sales engineering, and I'd love to explore how I might contribute to your team.

Would you be open to a quick chat this week?

Best,
Jake`;

export default function Outreach() {
  const [contacts, setContacts] = useState<Array<Record<string, string>>>([]);
  const [jobs, setJobs] = useState<Array<Record<string, string>>>([]);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);
  const [trackedEmails, setTrackedEmails] = useState<TrackedEmail[]>([]);
  const [replies, setReplies] = useState<EmailReply[]>([]);
  const [checkingReplies, setCheckingReplies] = useState(false);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    loadData();
    loadTracking();
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

  const handleGenerate = async () => {
    if (!api || contacts.length === 0) return;
    setGenerating(true);
    setMessages([]);
    setDrafts([]);

    try {
      addMessage(`Personalizing emails for ${contacts.length} contacts with Claude...`);

      const result = await api.claude.personalizeEmails({
        contacts,
        template,
        jobs,
      });

      const emailDrafts: EmailDraft[] = result.map((r) => {
        const contact = contacts.find(
          (c) => (c.email || c.emailaddress1 || "").toLowerCase() === r.contactEmail.toLowerCase()
        );
        return {
          contactEmail: r.contactEmail,
          contactName: contact?.fullname || contact?.name || r.contactEmail,
          company: contact?.company || "",
          subject: r.subject,
          body: r.body,
          edited: false,
          sent: false,
          contactId: contact?.id,
          jobId: undefined,
        };
      });

      setDrafts(emailDrafts);
      addMessage(`Generated ${emailDrafts.length} personalized drafts.`, "success");
    } catch (err) {
      addMessage(`Error: ${String(err)}`, "error");
    } finally {
      setGenerating(false);
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
      const result = await api.graph.sendEmail({
        to: draft.contactEmail,
        subject: draft.subject,
        bodyHtml: draft.body.replace(/\n/g, "<br>"),
        contactId: draft.contactId,
        jobId: draft.jobId,
      });

      if (result.success) {
        setDrafts((prev) =>
          prev.map((d, i) => (i === index ? { ...d, sent: true } : d))
        );
        if (result.tracked) {
          setTrackedEmails((prev) => [...prev, result.tracked!]);
        }
        await api.graph.saveTrackedEmails();
        addMessage(`Sent email to ${draft.contactEmail}`, "success");
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
      const newReplies = await api.graph.checkReplies();
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

  // Check if a contact has already been emailed (in tracked list)
  const isTracked = (email: string) =>
    trackedEmails.some((t) => t.to.toLowerCase() === email.toLowerCase());

  // Check if a contact has replied
  const hasReply = (email: string) =>
    replies.some((r) => r.replyFrom.toLowerCase() === email.toLowerCase());

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Outreach</h2>
      <p className="text-sm text-gray-500 mb-6">
        Claude personalizes your email template per company/role. Send via Microsoft Graph.
      </p>

      {/* Template editor */}
      <div className="mb-6">
        <label className="block text-xs text-gray-500 mb-2">
          Base Email Template (use {"{{name}}"} and {"{{company}}"} as placeholders)
        </label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={8}
          className="w-full max-w-2xl bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono"
        />
      </div>

      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={handleGenerate}
          disabled={generating || contacts.length === 0}
          className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {generating ? "Generating..." : `Personalize for ${contacts.length} contacts`}
        </button>
        <button
          onClick={loadData}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          Refresh contacts
        </button>
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
                <div className="mb-3">
                  <label className="text-xs text-gray-500">To</label>
                  <p className="text-sm text-gray-300">{drafts[selectedDraft].contactEmail}</p>
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
                  <label className="text-xs text-gray-500">Body</label>
                  <textarea
                    value={drafts[selectedDraft].body}
                    onChange={(e) => updateDraft(selectedDraft, "body", e.target.value)}
                    disabled={drafts[selectedDraft].sent}
                    rows={12}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 mt-1 font-mono disabled:opacity-50"
                  />
                </div>
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
                  <button
                    onClick={() => handleSendEmail(selectedDraft)}
                    disabled={sending === selectedDraft}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm rounded transition-colors"
                  >
                    {sending === selectedDraft ? "Sending..." : "Send via Graph"}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
