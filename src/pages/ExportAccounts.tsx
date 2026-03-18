import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import FileGallery from "../components/FileGallery";
import JobTitleSuggestions from "../components/JobTitleSuggestions";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api } from "../lib/ipc";

export default function ExportAccounts() {
  const navigate = useNavigate();
  const [batchAccounts, setBatchAccounts] = useState<Array<{ id: string; name: string; website?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const [galleryKey, setGalleryKey] = useState(0);

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
      console.error("Failed to load batch accounts:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!api || batchAccounts.length === 0) return;
    setExporting(true);

    try {
      addMessage(`Exporting ${batchAccounts.length} new accounts to CSV...`);
      const result = await api.files.exportAccountsCsv(
        batchAccounts.map((a) => ({ name: a.name, website: a.website, id: a.id }))
      );

      if (result.count === 0) {
        addMessage(result.message || "No new accounts to export.", "warning");
      } else {
        addMessage(`Exported ${result.count} accounts to ${result.fileName}`, "success");
        setGalleryKey((k) => k + 1);
        setExported(true);
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
        Step 2: Export new accounts from this batch as CSV for LinkedIn Sales Navigator
      </p>

      {/* Batch info */}
      <div className="mb-4 p-4 bg-gray-900 border border-gray-800 rounded-lg">
        {loading ? (
          <p className="text-sm text-gray-500">Loading batch data...</p>
        ) : batchAccounts.length > 0 ? (
          <div>
            <p className="text-sm text-gray-200">
              <span className="text-green-400 font-medium">{batchAccounts.length}</span> new accounts from the current batch
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {batchAccounts.slice(0, 20).map((a, i) => (
                <span key={i} className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
                  {a.name}
                </span>
              ))}
              {batchAccounts.length > 20 && (
                <span className="px-2 py-0.5 text-gray-600 text-xs">
                  +{batchAccounts.length - 20} more
                </span>
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-500">No new accounts in the current batch.</p>
            <button
              onClick={() => navigate("/pull-jobs")}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              &larr; Go to Pull from Careerflow
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={handleExport}
          disabled={exporting || loading || batchAccounts.length === 0}
          className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {exporting ? "Exporting..." : `Export ${batchAccounts.length} accounts to CSV`}
        </button>
      </div>

      <StatusFeed messages={messages} />

      {/* Job Title Suggestions */}
      {batchAccounts.length > 0 && (
        <div className="mt-6 mb-8">
          <JobTitleSuggestions
            companies={batchAccounts.map((a) => ({
              name: a.name,
              website: a.website || "",
              domain: "",
            }))}
          />
        </div>
      )}

      {/* Next step */}
      {exported && (
        <div className="mt-4 p-4 bg-blue-900/20 border border-blue-800/30 rounded-lg">
          <p className="text-sm text-gray-300 mb-2">
            CSV exported. Import it into Sales Navigator, search for leads, then:
          </p>
          <button
            onClick={() => navigate("/pull-contacts")}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
          >
            Next: Pull from Wiza &rarr;
          </button>
        </div>
      )}

      {/* File Gallery */}
      <div className="mt-8">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Exported CSVs</h3>
        <FileGallery key={galleryKey} />
      </div>
    </div>
  );
}
