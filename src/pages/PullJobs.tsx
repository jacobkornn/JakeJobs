import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import DateRangePicker from "../components/DateRangePicker";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api, type DownloadFile } from "../lib/ipc";

interface JobRow {
  companyName: string;
  jobTitle: string;
  location: string;
  jobLink: string;
  source: string;
  salary: string;
  dateAdded: string;
  status: string;
  website?: string;
  isNew?: boolean;
}

export default function PullJobs() {
  const navigate = useNavigate();
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [downloadFiles, setDownloadFiles] = useState<DownloadFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<Set<number>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    newAccounts: number;
    newJobs: number;
    skippedJobs: number;
  } | null>(null);
  const [messages, setMessages] = useState<StatusMessage[]>([]);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  useEffect(() => {
    scanDownloads();
  }, []);

  const scanDownloads = async () => {
    if (!api) return;
    try {
      const files = await api.careerflow.scanDownloads();
      setDownloadFiles(files);
    } catch (err) {
      console.error("Failed to scan downloads:", err);
    }
  };

  const toggleFile = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const handleBrowse = async () => {
    if (!api) return;
    const paths = await api.careerflow.browseFiles();
    if (paths.length > 0) {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        paths.forEach((p) => next.add(p));
        return next;
      });
    }
  };

  const toggleJob = (index: number) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAllJobs = () => {
    if (selectedJobs.size === jobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(jobs.map((_, i) => i)));
    }
  };

  const handlePull = async () => {
    if (!api || selectedFiles.size === 0) return;
    setPulling(true);
    setMessages([]);
    setJobs([]);
    setSelectedJobs(new Set());
    setProcessed(false);
    setBatchResult(null);

    try {
      const filePaths = Array.from(selectedFiles);
      addMessage(`Processing ${filePaths.length} file(s)...`);

      const result = await api.careerflow.pullJobs({ filePaths, dateFrom, dateTo });

      if (result.jobs.length === 0) {
        addMessage("No jobs found matching the date filter.", "warning");
        setPulling(false);
        return;
      }

      addMessage(`Parsed ${result.jobs.length} jobs from ${result.processedFiles.join(", ")}`);
      addMessage("Running Claude deduplication & enrichment...");

      const enriched = await api.claude.deduplicateCompanies(result.jobs);
      addMessage(`Claude identified ${enriched.length} unique companies.`, "success");

      const companyMap = new Map<string, (typeof enriched)[0]>();
      for (const company of enriched) {
        for (const variation of company.variations || [company.name]) {
          companyMap.set(variation.toLowerCase(), company);
        }
      }

      const jobRows: JobRow[] = result.jobs.map((j) => {
        const matched = companyMap.get((j.companyName || "").toLowerCase());
        return {
          companyName: matched?.name || j.companyName,
          jobTitle: j.jobTitle,
          location: j.location,
          jobLink: j.jobLink,
          source: j.source,
          salary: j.salary,
          dateAdded: j.dateAdded,
          status: j.status,
          website: matched?.website || "",
        };
      });

      setJobs(jobRows);
      setSelectedJobs(new Set(jobRows.map((_, i) => i)));
      addMessage(
        `${jobRows.length} jobs ready. Select and send to Dynamics.`,
        "success"
      );
    } catch (err) {
      addMessage(`Error: ${String(err)}`, "error");
    } finally {
      setPulling(false);
    }
  };

  const handleSendToDynamics = async () => {
    if (!api || selectedJobs.size === 0) return;
    setProcessing(true);

    try {
      const selected = jobs.filter((_, i) => selectedJobs.has(i));
      addMessage(`Sending ${selected.length} jobs to Dynamics (upserting accounts, linking jobs)...`);

      const payload = selected.map((j) => ({
        companyName: j.companyName,
        jobTitle: j.jobTitle,
        location: j.location,
        jobLink: j.jobLink,
        source: j.source,
        salary: j.salary,
        dateAdded: j.dateAdded,
        status: j.status,
        website: j.website || "",
      }));
      const result = await api.dynamics.processJobBatch(payload);

      setBatchResult({
        newAccounts: result.newAccounts,
        newJobs: result.newJobs,
        skippedJobs: result.skippedJobs,
      });
      setProcessed(true);

      addMessage(
        `Done: ${result.newAccounts} new accounts, ${result.newJobs} new jobs created, ${result.skippedJobs} duplicate jobs skipped.`,
        "success"
      );

      if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 5)) {
          addMessage(err, "error");
        }
        if (result.errors.length > 5) {
          addMessage(`...and ${result.errors.length - 5} more errors`, "error");
        }
      }

      if (result.newAccounts > 0) {
        addMessage(
          `${result.newAccounts} new accounts ready to export for Sales Navigator.`,
          "info"
        );
      }
    } catch (err) {
      addMessage(`Failed: ${String(err)}`, "error");
    } finally {
      setProcessing(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Pull from Careerflow</h2>
      <p className="text-sm text-gray-500 mb-6">
        Step 1: Import jobs, deduplicate with Claude, upsert accounts &amp; jobs in Dynamics
      </p>

      {/* File selection */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-sm font-medium text-gray-400">Select files</h3>
          <button onClick={scanDownloads} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Refresh
          </button>
          <button onClick={handleBrowse} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            Browse...
          </button>
        </div>

        {downloadFiles.length === 0 ? (
          <p className="text-xs text-gray-600 py-3">
            No Careerflow export files found in Downloads. Use "Browse..." to select files manually.
          </p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-auto">
            {downloadFiles.map((file) => (
              <label
                key={file.filePath}
                className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors ${
                  selectedFiles.has(file.filePath)
                    ? "bg-blue-600/15 border border-blue-600/30"
                    : "bg-gray-900 border border-gray-800 hover:border-gray-700"
                }`}
              >
                <input type="checkbox" checked={selectedFiles.has(file.filePath)} onChange={() => toggleFile(file.filePath)} className="accent-blue-500" />
                <span className="text-sm text-gray-200 flex-1 truncate">{file.fileName}</span>
                <span className="text-xs text-gray-500">{formatSize(file.size)}</span>
                <span className="text-xs text-gray-600">{new Date(file.modified).toLocaleDateString()}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Date filter + Pull */}
      <div className="flex items-end gap-4 mb-4">
        <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
        <button
          onClick={handlePull}
          disabled={pulling || selectedFiles.size === 0}
          className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {pulling ? "Processing..." : `Pull Jobs (${selectedFiles.size} file${selectedFiles.size !== 1 ? "s" : ""})`}
        </button>
      </div>

      <StatusFeed messages={messages} />

      {/* Results table */}
      {jobs.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-4 mb-3">
            <h3 className="text-sm font-medium text-gray-400">
              {selectedJobs.size} of {jobs.length} jobs selected
            </h3>
            <button onClick={selectAllJobs} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              {selectedJobs.size === jobs.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="overflow-auto max-h-[400px] border border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 sticky top-0">
                <tr className="text-left text-gray-500 text-xs">
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={selectedJobs.size === jobs.length && jobs.length > 0} onChange={selectAllJobs} className="accent-blue-500" />
                  </th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Job Title</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Salary</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Date Added</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, i) => (
                  <tr
                    key={i}
                    className={`border-t border-gray-800 cursor-pointer transition-colors ${selectedJobs.has(i) ? "bg-blue-600/10" : "hover:bg-gray-900/50"}`}
                    onClick={() => toggleJob(i)}
                  >
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selectedJobs.has(i)} onChange={() => toggleJob(i)} onClick={(e) => e.stopPropagation()} className="accent-blue-500" />
                    </td>
                    <td className="px-3 py-2 text-gray-200">{job.companyName}</td>
                    <td className="px-3 py-2 text-gray-300">
                      {job.jobLink ? (
                        <a href={job.jobLink} target="_blank" rel="noreferrer" className="hover:text-blue-400" onClick={(e) => e.stopPropagation()}>
                          {job.jobTitle}
                        </a>
                      ) : job.jobTitle}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{job.location}</td>
                    <td className="px-3 py-2 text-gray-400">{job.salary}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{job.source}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{job.dateAdded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action bar */}
          <div className="mt-4 flex items-center gap-3">
            {!processed ? (
              <button
                onClick={handleSendToDynamics}
                disabled={processing || selectedJobs.size === 0}
                className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
              >
                {processing ? "Sending to Dynamics..." : `Send ${selectedJobs.size} jobs to Dynamics`}
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <div className="text-sm">
                  <span className="text-green-400">{batchResult?.newJobs} new jobs</span>
                  <span className="text-gray-600 mx-1">|</span>
                  <span className="text-green-400">{batchResult?.newAccounts} new accounts</span>
                  {(batchResult?.skippedJobs ?? 0) > 0 && (
                    <>
                      <span className="text-gray-600 mx-1">|</span>
                      <span className="text-gray-500">{batchResult?.skippedJobs} duplicates skipped</span>
                    </>
                  )}
                </div>
                {(batchResult?.newAccounts ?? 0) > 0 && (
                  <button
                    onClick={() => navigate("/export-accounts")}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
                  >
                    Next: Export {batchResult?.newAccounts} new accounts &rarr;
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
