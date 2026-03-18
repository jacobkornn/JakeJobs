import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api } from "../lib/ipc";

export default function PullContacts() {
  const navigate = useNavigate();
  const [batchAccounts, setBatchAccounts] = useState<Array<{ id: string; name: string; website?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichDone, setEnrichDone] = useState(false);
  const [pullingContacts, setPullingContacts] = useState(false);
  const [processingContacts, setProcessingContacts] = useState(false);
  const [contacts, setContacts] = useState<Array<Record<string, unknown>>>([]);
  const [contactsDone, setContactsDone] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    loadBatchAccounts();
  }, []);

  const loadBatchAccounts = async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.dynamics.getBatchNewAccounts();
      setBatchAccounts(result);
      if (result.length === 0) {
        addMessage("No new accounts from the current batch. Pull from Careerflow first.", "warning");
      }
    } catch (err) {
      addMessage(`Failed to load accounts: ${String(err)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Enrich accounts with Wiza company data
  const handleEnrichAccounts = async () => {
    if (!api || batchAccounts.length === 0) return;
    setEnriching(true);

    try {
      addMessage(`Enriching ${batchAccounts.length} accounts with Wiza company data...`);
      addMessage("This may take a few minutes (rate-limited to ~30 requests/min).", "info");

      const result = await api.wiza.enrichAccounts(
        batchAccounts.map((a) => ({
          name: a.name,
          domain: a.website?.replace(/^https?:\/\//, "") || undefined,
          id: a.id,
        }))
      );

      setEnrichDone(true);
      addMessage(
        `Account enrichment complete: ${result.enriched} enriched, ${result.skipped} skipped.`,
        "success"
      );

      if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 5)) {
          addMessage(err, "error");
        }
      }
    } catch (err) {
      addMessage(`Enrichment failed: ${String(err)}`, "error");
    } finally {
      setEnriching(false);
    }
  };

  // Step 2: Pull contacts from Wiza (create a list from account domains)
  const handlePullContacts = async () => {
    if (!api || batchAccounts.length === 0) return;
    setPullingContacts(true);

    try {
      // Build Wiza list items from account domains
      const items = batchAccounts
        .filter((a) => a.website || a.name)
        .map((a) => ({
          company: a.name,
          domain: a.website?.replace(/^https?:\/\//, "") || "",
        }));

      addMessage(`Creating Wiza list with ${items.length} companies...`);
      addMessage("Wiza is enriching contacts. This may take a few minutes.", "info");

      const result = await api.wiza.pullContacts({
        items,
        listName: `JakeJobs ${new Date().toISOString().slice(0, 10)}`,
        enrichmentLevel: "full",
      });

      if (result.message) {
        addMessage(result.message, "warning");
      }

      setContacts(result.contacts);
      addMessage(`Wiza returned ${result.count} contacts.`, "success");
    } catch (err) {
      addMessage(`Pull contacts failed: ${String(err)}`, "error");
    } finally {
      setPullingContacts(false);
    }
  };

  // Step 3: Send contacts to Dynamics
  const handleSendToDynamics = async () => {
    if (!api || contacts.length === 0) return;
    setProcessingContacts(true);

    try {
      addMessage(`Sending ${contacts.length} contacts to Dynamics...`);

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
        `Contacts processed: ${result.created} created, ${result.existing} already existed.`,
        "success"
      );

      if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 5)) {
          addMessage(err, "error");
        }
      }
    } catch (err) {
      addMessage(`Failed: ${String(err)}`, "error");
    } finally {
      setProcessingContacts(false);
    }
  };

  const str = (v: unknown) => (v != null ? String(v) : "");

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Pull from Wiza</h2>
      <p className="text-sm text-gray-500 mb-6">
        Step 3: Enrich accounts with company data, then pull and create contacts
      </p>

      {/* Batch info */}
      <div className="mb-6 p-4 bg-gray-900 border border-gray-800 rounded-lg">
        {loading ? (
          <p className="text-sm text-gray-500">Loading batch data...</p>
        ) : batchAccounts.length > 0 ? (
          <p className="text-sm text-gray-200">
            <span className="text-green-400 font-medium">{batchAccounts.length}</span> accounts from current batch
          </p>
        ) : (
          <div>
            <p className="text-sm text-gray-500">No accounts in current batch.</p>
            <button onClick={() => navigate("/pull-jobs")} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
              &larr; Pull from Careerflow first
            </button>
          </div>
        )}
      </div>

      {/* Step 1: Enrich Accounts */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Step 1: Enrich Accounts</h3>
        <p className="text-xs text-gray-600 mb-3">
          Wiza enriches company data: industry, size, revenue, funding, address, LinkedIn, and more.
          Costs 2 API credits per company.
        </p>
        <button
          onClick={handleEnrichAccounts}
          disabled={enriching || batchAccounts.length === 0}
          className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {enriching
            ? "Enriching..."
            : enrichDone
              ? "Re-enrich accounts"
              : `Enrich ${batchAccounts.length} accounts`}
        </button>
      </div>

      {/* Step 2: Pull Contacts */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Step 2: Pull Contacts</h3>
        <p className="text-xs text-gray-600 mb-3">
          Creates a Wiza list from your accounts to find contacts with verified emails and phone numbers.
        </p>
        <button
          onClick={handlePullContacts}
          disabled={pullingContacts || batchAccounts.length === 0}
          className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {pullingContacts ? "Pulling contacts..." : `Pull contacts for ${batchAccounts.length} accounts`}
        </button>
      </div>

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
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-900/50">
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
                {processingContacts ? "Sending..." : `Send ${contacts.length} contacts to Dynamics`}
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <span className="text-sm text-green-400">Contacts saved to Dynamics</span>
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
