import { IpcMain, dialog } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import XLSX from "xlsx";

const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");
const PIPELINE_DIR = path.join(__dirname, "..", "..", "data", "pipeline");
const ARCHIVE_DIR = path.join(__dirname, "..", "..", "data", "digest");

function ensureDirs() {
  fs.mkdirSync(PIPELINE_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

/**
 * Parse Excel serial date (UTC) to JS Date in local timezone.
 * Careerflow stores "Date Added (UTC)" as Excel serial numbers.
 * We convert to a local date so filtering by "today" matches the user's day.
 */
function excelDateToLocal(serial: number): Date {
  // Excel epoch is 1899-12-30 UTC
  const msFromEpoch = (serial - 25569) * 86400000; // 25569 = days from 1899-12-30 to 1970-01-01
  const utcDate = new Date(msFromEpoch);
  // Return a Date representing the local calendar date
  return new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
}

/**
 * Parse a date value (Excel serial or string) to Date
 */
function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "number") return excelDateToLocal(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Read CSV or XLSX file into array of row objects
 */
function readSpreadsheet(filePath: string): Array<Record<string, unknown>> {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws);
}

/**
 * Normalize a row from Careerflow export format into a standard job object.
 *
 * Careerflow columns:
 *   Id, Company Name, Job Title, Status, Date Added (UTC),
 *   Date Applied (UTC), Date Interviewed (UTC), Date Offered (UTC),
 *   Date Rejected (UTC), Created By, Location, Salary, Job Link, Source, Tags
 */
function normalizeJob(row: Record<string, unknown>): Record<string, string> {
  const str = (v: unknown) => (v != null && String(v) !== "NaN" ? String(v).trim() : "");
  const dateStr = (v: unknown) => {
    const d = parseDate(v);
    if (!d) return "";
    // Format as YYYY-MM-DD using local date components
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return {
    id: str(row["Id"]),
    companyName: str(row["Company Name"]),
    jobTitle: str(row["Job Title"]),
    status: str(row["Status"]),
    dateAdded: dateStr(row["Date Added (UTC)"]),
    dateApplied: dateStr(row["Date Applied (UTC)"]),
    dateInterviewed: dateStr(row["Date Interviewed (UTC)"]),
    dateOffered: dateStr(row["Date Offered (UTC)"]),
    dateRejected: dateStr(row["Date Rejected (UTC)"]),
    createdBy: str(row["Created By"]),
    location: str(row["Location"]),
    salary: str(row["Salary"]),
    jobLink: str(row["Job Link"]),
    source: str(row["Source"]),
    tags: str(row["Tags"]),
  };
}

export function registerCareerflowHandlers(ipcMain: IpcMain) {
  // Scan Downloads folder for Careerflow CSV/XLSX files
  ipcMain.handle("careerflow:scanDownloads", async () => {
    const files = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter((f) => {
        const lower = f.toLowerCase();
        return (
          (lower.endsWith(".csv") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) &&
          (lower.includes("jobs_export") || lower.includes("careerflow"))
        );
      });

    return files
      .map((fileName) => {
        const filePath = path.join(DOWNLOADS_DIR, fileName);
        const stat = fs.statSync(filePath);
        return {
          fileName,
          filePath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  });

  // Ingest selected CSV/XLSX files
  ipcMain.handle(
    "careerflow:pullJobs",
    async (
      _event,
      params: { filePaths: string[]; dateFrom?: string; dateTo?: string }
    ) => {
      ensureDirs();

      const allJobs: Array<Record<string, string>> = [];
      const processedFiles: string[] = [];

      for (const filePath of params.filePaths) {
        try {
          const rows = readSpreadsheet(filePath);
          const normalized = rows.map(normalizeJob);

          // Apply date filter
          const dateFrom = params.dateFrom ? new Date(params.dateFrom) : null;
          const dateTo = params.dateTo ? new Date(params.dateTo + "T23:59:59") : null;

          const filtered = normalized.filter((job) => {
            if (!dateFrom && !dateTo) return true;
            if (!job.dateAdded) return false; // skip jobs without dates
            const jobDate = new Date(job.dateAdded);
            if (isNaN(jobDate.getTime())) return false;
            // Compare date-only (strip time component)
            const jobDateStr = jobDate.toISOString().slice(0, 10);
            if (dateFrom && jobDateStr < params.dateFrom!) return false;
            if (dateTo && jobDateStr > params.dateTo!) return false;
            return true;
          });

          allJobs.push(...filtered);
          processedFiles.push(filePath);
        } catch (err) {
          console.error(`Failed to process ${filePath}:`, err);
        }
      }

      // Save raw jobs to pipeline
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const pipelineFile = path.join(PIPELINE_DIR, `jobs_raw_${timestamp}.json`);
      fs.writeFileSync(pipelineFile, JSON.stringify(allJobs, null, 2));

      return {
        jobs: allJobs,
        processedFiles: processedFiles.map((f) => path.basename(f)),
        pipelineFile,
      };
    }
  );

  // Archive processed files (move to digest folder)
  ipcMain.handle("careerflow:archiveFiles", async (_event, filePaths: string[]) => {
    ensureDirs();
    const archived: string[] = [];

    for (const filePath of filePaths) {
      try {
        const fileName = path.basename(filePath);
        const dest = path.join(ARCHIVE_DIR, fileName);
        fs.copyFileSync(filePath, dest);
        fs.unlinkSync(filePath);
        archived.push(fileName);
      } catch (err) {
        console.error(`Failed to archive ${filePath}:`, err);
      }
    }

    return archived;
  });

  // Browse for files via native dialog
  ipcMain.handle("careerflow:browseFiles", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Careerflow job export files",
      defaultPath: DOWNLOADS_DIR,
      filters: [
        { name: "Spreadsheets", extensions: ["csv", "xlsx", "xls"] },
      ],
      properties: ["openFile", "multiSelections"],
    });

    if (result.canceled) return [];
    return result.filePaths;
  });
}
