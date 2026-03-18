import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import dotenv from "dotenv";
import { registerDynamicsHandlers } from "./ipc/dynamics";
import { registerCareerflowHandlers } from "./ipc/careerflow";
import { registerWizaHandlers } from "./ipc/wiza";
import { registerClaudeHandlers } from "./ipc/claude";
import { registerFileHandlers } from "./ipc/files";
import { registerSettingsHandlers } from "./ipc/settings";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "JakeJobs System",
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerDynamicsHandlers(ipcMain);
  registerCareerflowHandlers(ipcMain);
  registerWizaHandlers(ipcMain);
  registerClaudeHandlers(ipcMain);
  registerFileHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
