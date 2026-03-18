import { useState, useEffect } from "react";
import FileGallery from "../components/FileGallery";
import JobTitleSuggestions from "../components/JobTitleSuggestions";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api } from "../lib/ipc";

export default function ExportAccounts() {
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; domain?: string; website?: string; linkedinUrl?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const [galleryKey, setGalleryKey] = useState(0);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.dynamics.getAccounts();
      setAccounts(result);
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!api || accounts.length === 0) return;
    setExporting(true);
    setMessages([]);

    try {
      addMessage(`Exporting ${accounts.length} accounts to CSV...`);
      const result = await api.files.exportAccountsCsv(accounts);

      if (result.count === 0) {
        addMessage(result.message || "No new accounts to export.", "warning");
      } else {
        addMessage(`Exported ${result.count} accounts to ${result.fileName}`, "success");
        setGalleryKey((k) => k + 1); // refresh gallery
      }
    } catch (err) {
      addMessage(`Export failed: ${String(err)}`, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Export Accounts</h2>
      <p className="text-sm text-gray-500 mb-6">
        Generate CSVs for LinkedIn Sales Navigator import
      </p>

      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={handleExport}
          disabled={exporting || loading || accounts.length === 0}
          className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {exporting ? "Exporting..." : `Export CSV (${accounts.length} accounts)`}
        </button>
        <button
          onClick={loadAccounts}
          disabled={loading}
          className="px-3 py-2 text-gray-400 hover:text-gray-200 text-sm transition-colors"
        >
          {loading ? "Loading..." : "Refresh from Dynamics"}
        </button>
      </div>

      <StatusFeed messages={messages} />

      {/* Job Title Suggestions */}
      <div className="mt-6 mb-8">
        <JobTitleSuggestions companies={accounts.map((a) => ({ name: a.name, website: a.website || "", domain: a.domain || "" }))} />
      </div>

      {/* File Gallery */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Exported CSVs</h3>
        <FileGallery key={galleryKey} />
      </div>
    </div>
  );
}
