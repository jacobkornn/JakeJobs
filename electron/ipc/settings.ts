import { IpcMain } from "electron";
import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(__dirname, "..", "..", "data", "settings.json");

interface AppSettings {
  careerflowDefaults: {
    keywords: string;
    location: string;
  };
  emailTemplates: {
    sales: string;
    engineering: string;
  };
  outlookAccount: string;
  outlookFolder: string;
  contactCooldownDays: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  careerflowDefaults: {
    keywords: "",
    location: "",
  },
  emailTemplates: {
    sales: "",
    engineering: "",
  },
  outlookAccount: process.env.OUTLOOK_ACCOUNT || "",
  outlookFolder: process.env.CUSTOM_FOLDER_NAME || "JakeJobs Outbound",
  contactCooldownDays: parseInt(process.env.CONTACT_COOLDOWN_DAYS || "7", 10),
};

function loadSettings(): AppSettings {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return { ...DEFAULT_SETTINGS, ...data };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: AppSettings) {
  const dir = path.dirname(SETTINGS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export function registerSettingsHandlers(ipcMain: IpcMain) {
  ipcMain.handle("settings:get", async () => {
    return loadSettings();
  });

  ipcMain.handle("settings:update", async (_event, updates: Partial<AppSettings>) => {
    const current = loadSettings();
    const updated = { ...current, ...updates };
    saveSettings(updated);
    return updated;
  });
}
