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

  // Create a drag icon on disk (Electron startDrag requires a file path to a valid image)
  ensureDirs();
  const iconPath = path.join(DATA_DIR, "drag-icon.png");
  (function createDragIcon() {
    const zlib = require("zlib");
    const width = 16, height = 16;
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    function crc32(buf: Buffer): number {
      let c = 0xFFFFFFFF;
      for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
      }
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function chunk(type: string, data: Buffer): Buffer {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      const t = Buffer.from(type);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
      return Buffer.concat([len, t, data, crc]);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (width * 4 + 1)] = 0;
      for (let x = 0; x < width; x++) {
        const o = y * (width * 4 + 1) + 1 + x * 4;
        raw[o] = 100; raw[o + 1] = 100; raw[o + 2] = 100; raw[o + 3] = 200;
      }
    }

    const png = Buffer.concat([
      signature,
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    fs.writeFileSync(iconPath, png);
  })();

  ipcMain.on("files:startDrag", (event, filePath: string) => {
    event.sender.startDrag({ file: filePath, icon: iconPath });
  });

  // Load resume/cover letter attachments for a given lead type
  ipcMain.handle("files:getAttachments", async (_event, leadType: string) => {
    const WIZA_DATA = path.join(__dirname, "..", "..", "..", "Wiza", "Data");
    const lt = (leadType || "").trim().toLowerCase();
    const dir = lt === "sales" ? path.join(WIZA_DATA, "Sales") : path.join(WIZA_DATA, "Software");

    const resume = path.join(dir, "Jacob_Korn_Resume.pdf");
    const cover = path.join(dir, "Jacob_Korn_CoverLetter.pdf");

    const attachments: Array<{ name: string; contentBytes: string; contentType: string }> = [];

    for (const filePath of [resume, cover]) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        attachments.push({
          name: path.basename(filePath),
          contentBytes: content.toString("base64"),
          contentType: "application/pdf",
        });
      }
    }

    return attachments;
  });
}
