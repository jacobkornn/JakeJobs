import { IpcMain, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const EXPORTED_IDS_FILE = path.join(DATA_DIR, "exported_account_ids.json");

function ensureDirs() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "pipeline"), { recursive: true });
}

function getExportedIds(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(EXPORTED_IDS_FILE, "utf-8"));
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveExportedIds(ids: Set<string>) {
  fs.writeFileSync(EXPORTED_IDS_FILE, JSON.stringify([...ids]));
}

export function registerFileHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    "files:exportAccountsCsv",
    async (_event, accounts: Array<{ name: string; linkedinUrl?: string; website?: string; id?: string }>) => {
      ensureDirs();

      const exportedIds = getExportedIds();
      const newAccounts = accounts.filter((a) => !a.id || !exportedIds.has(a.id));

      if (newAccounts.length === 0) {
        return { filePath: null, count: 0, message: "No new accounts to export" };
      }

      // Build CSV
      const header = "Company Name,LinkedIn URL,Website";
      const rows = newAccounts.map((a) => {
        const name = `"${(a.name || "").replace(/"/g, '""')}"`;
        const linkedin = a.linkedinUrl || "";
        const website = a.website || "";
        return `${name},${linkedin},${website}`;
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fileName = `SalesNavigator_Import_${timestamp}.csv`;
      const filePath = path.join(EXPORTS_DIR, fileName);

      fs.writeFileSync(filePath, [header, ...rows].join("\n"), "utf-8");

      // Track exported IDs
      for (const a of newAccounts) {
        if (a.id) exportedIds.add(a.id);
      }
      saveExportedIds(exportedIds);

      return { filePath, count: newAccounts.length, fileName };
    }
  );

  ipcMain.handle("files:getExportFiles", async () => {
    ensureDirs();

    const files = fs.readdirSync(EXPORTS_DIR).filter((f) => f.endsWith(".csv"));
    return files.map((fileName) => {
      const filePath = path.join(EXPORTS_DIR, fileName);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const lineCount = content.split("\n").length - 1; // subtract header

      return {
        fileName,
        filePath,
        size: stat.size,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        rowCount: Math.max(0, lineCount),
      };
    });
  });

  ipcMain.on("files:startDrag", (event, filePath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      event.sender.startDrag({
        file: filePath,
        icon: path.join(__dirname, "..", "..", "src", "assets", "csv-icon.png"),
      });
    }
  });
}
