import { useState, useEffect } from "react";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api } from "../lib/ipc";

interface EmailDraft {
  contactEmail: string;
  contactName: string;
  company: string;
  subject: string;
  body: string;
  edited: boolean;
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
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    loadData();
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

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Outreach</h2>
      <p className="text-sm text-gray-500 mb-6">
        Claude personalizes your email template per company/role
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

      {/* Drafts */}
      {drafts.length > 0 && (
        <div className="mt-6 flex gap-4">
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
                <p className="text-sm text-gray-200 truncate">{draft.contactName}</p>
                <p className="text-xs text-gray-500 truncate">{draft.company}</p>
                {draft.edited && <span className="text-[10px] text-yellow-500">edited</span>}
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
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 mt-1"
                />
              </div>
              <div className="mb-4">
                <label className="text-xs text-gray-500">Body</label>
                <textarea
                  value={drafts[selectedDraft].body}
                  onChange={(e) => updateDraft(selectedDraft, "body", e.target.value)}
                  rows={12}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 mt-1 font-mono"
                />
              </div>
              <button
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
              >
                Stage in Outlook
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
