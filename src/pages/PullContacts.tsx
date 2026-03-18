import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api } from "../lib/ipc";
import type { WizaList } from "../lib/ipc";

export default function PullContacts() {
  const navigate = useNavigate();
  const [listIdInput, setListIdInput] = useState("");
  const [listInfo, setListInfo] = useState<WizaList | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [contacts, setContacts] = useState<Array<Record<string, unknown>>>([]);
  const [pullingContacts, setPullingContacts] = useState(false);
  const [processingContacts, setProcessingContacts] = useState(false);
  const [contactsDone, setContactsDone] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  const str = (v: unknown) => (v != null ? String(v) : "");

  // Fetch list info by ID
  const handleFetchList = async () => {
    if (!api || !listIdInput.trim()) return;
    const id = parseInt(listIdInput.trim(), 10);
    if (isNaN(id)) {
      addMessage("Please enter a valid list ID (number).", "error");
      return;
    }

    setLoadingList(true);
    setListInfo(null);
    setContacts([]);
    setContactsDone(false);

    try {
      const list = await api.wiza.getList(id);
      setListInfo(list);
      addMessage(`Found list: "${list.name}" (${list.status}, ${list.stats?.people || 0} people)`, "success");

      if (list.status !== "finished") {
        addMessage(`List status is "${list.status}" — contacts may not be ready yet.`, "warning");
      }
    } catch (err) {
      addMessage(`Failed to fetch list: ${String(err)}`, "error");
    } finally {
      setLoadingList(false);
    }
  };

  // Pull contacts from the list
  const handlePullContacts = async () => {
    if (!api || !listInfo) return;
    setPullingContacts(true);

    try {
      addMessage(`Fetching contacts from list ${listInfo.id}...`);
      const result = await api.wiza.getListContacts(listInfo.id);

      // Deduplicate by email within the batch
      const seen = new Set<string>();
      const deduped = result.contacts.filter((c) => {
        const email = String(c.email || c.work_email || "").toLowerCase().trim();
        if (!email || seen.has(email)) return false;
        seen.add(email);
        return true;
      });

      const dupeCount = result.count - deduped.length;
      setContacts(deduped);
      addMessage(`Retrieved ${result.count} contacts${dupeCount > 0 ? ` (${dupeCount} duplicates removed)` : ""}.`, "success");

      if (deduped.length === 0) {
        addMessage("No contacts found. The list may still be processing or has no results.", "warning");
      }
    } catch (err) {
      addMessage(`Failed to pull contacts: ${String(err)}`, "error");
    } finally {
      setPullingContacts(false);
    }
  };

  // Send contacts to Dynamics
  const handleSendToDynamics = async () => {
    if (!api || contacts.length === 0) return;
    setProcessingContacts(true);

    try {
      addMessage(`Syncing ${contacts.length} contacts to Dynamics...`);

      const contactRecords = contacts.map((c) => {
        const rec: Record<string, string> = {};
        for (const [k, v] of Object.entries(c)) {
          if (v != null) rec[k] = String(v);
        }
        return rec;
      });

      const result = await api.wiza.processContacts(contactRecords);

      setContactsDone(true);
      addMessage(
        `Done: ${result.created} created, ${result.existing} existing, ${result.matched} matched to accounts, ${result.unmatched} unmatched.`,
        "success"
      );

      if (result.noEmail > 0) {
        addMessage(`${result.noEmail} contacts skipped (no email).`, "warning");
      }
      if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 5)) {
          addMessage(err, "error");
        }
        if (result.errors.length > 5) {
          addMessage(`...and ${result.errors.length - 5} more errors.`, "error");
        }
      }
    } catch (err) {
      addMessage(`Failed: ${String(err)}`, "error");
    } finally {
      setProcessingContacts(false);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Pull from Wiza</h2>
      <p className="text-sm text-gray-500 mb-6">
        Fetch contacts from an existing Wiza list (created from Sales Navigator), then sync to Dynamics
      </p>

      {/* Step 1: Enter list ID */}
      <div className="mb-6 p-4 bg-gray-900 border border-gray-800 rounded-lg">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Step 1: Load Wiza List</h3>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={listIdInput}
            onChange={(e) => setListIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFetchList()}
            placeholder="Wiza List ID (e.g. 12345)"
            className="flex-1 max-w-xs px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleFetchList}
            disabled={loadingList || !listIdInput.trim()}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
          >
            {loadingList ? "Loading..." : "Fetch List"}
          </button>
        </div>

        {listInfo && (
          <div className="mt-3 text-sm text-gray-300">
            <span className="text-white font-medium">{listInfo.name}</span>
            <span className="text-gray-500 ml-2">
              ({listInfo.status} · {listInfo.stats?.people || 0} people · {listInfo.enrichment_level || "unknown"})
            </span>
          </div>
        )}
      </div>

      {/* Step 2: Pull contacts */}
      {listInfo && (
        <div className="mb-6 p-4 bg-gray-900 border border-gray-800 rounded-lg">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Step 2: Pull Contacts</h3>
          <button
            onClick={handlePullContacts}
            disabled={pullingContacts}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
          >
            {pullingContacts ? "Pulling..." : `Pull contacts from "${listInfo.name}"`}
          </button>
        </div>
      )}

      <StatusFeed messages={messages} />

      {/* Contacts table */}
      {contacts.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-4 mb-3">
            <h3 className="text-sm font-medium text-gray-400">{contacts.length} Contacts</h3>
          </div>

          <div className="overflow-auto max-h-[400px] border border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 sticky top-0">
                <tr className="text-left text-gray-500 text-xs">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Location</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-900/50 group">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setContacts((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        title="Remove contact"
                      >
                        X
                      </button>
                    </td>
                    <td className="px-3 py-2 text-gray-200">{str(c.full_name || c.name)}</td>
                    <td className="px-3 py-2 text-gray-300">{str(c.email || c.work_email)}</td>
                    <td className="px-3 py-2 text-gray-400">{str(c.company || c.company_name)}</td>
                    <td className="px-3 py-2 text-gray-400">{str(c.title || c.job_title)}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{str(c.mobile_phone || c.phone)}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{str(c.location)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Step 3: Send to Dynamics */}
          <div className="mt-4 flex items-center gap-3">
            {!contactsDone ? (
              <button
                onClick={handleSendToDynamics}
                disabled={processingContacts}
                className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
              >
                {processingContacts ? "Syncing..." : `Sync ${contacts.length} contacts to Dynamics`}
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <span className="text-sm text-green-400">Contacts synced to Dynamics</span>
                <button
                  onClick={() => navigate("/outreach")}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
                >
                  Next: Outreach &rarr;
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
