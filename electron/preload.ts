import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Dynamics 365
  dynamics: {
    getAccounts: () => ipcRenderer.invoke("dynamics:getAccounts"),
    getContacts: () => ipcRenderer.invoke("dynamics:getContacts"),
    getJobs: () => ipcRenderer.invoke("dynamics:getJobs"),
    syncPending: () => ipcRenderer.invoke("dynamics:syncPending"),
    getPendingCount: () => ipcRenderer.invoke("dynamics:getPendingCount"),
  },

  // Careerflow (CSV import from Downloads)
  careerflow: {
    scanDownloads: () => ipcRenderer.invoke("careerflow:scanDownloads"),
    pullJobs: (params: { filePaths: string[]; dateFrom?: string; dateTo?: string }) =>
      ipcRenderer.invoke("careerflow:pullJobs", params),
    archiveFiles: (filePaths: string[]) =>
      ipcRenderer.invoke("careerflow:archiveFiles", filePaths),
    browseFiles: () => ipcRenderer.invoke("careerflow:browseFiles"),
  },

  // Wiza
  wiza: {
    pullContacts: (params: { dateFrom: string; dateTo: string }) =>
      ipcRenderer.invoke("wiza:pullContacts", params),
  },

  // Claude
  claude: {
    deduplicateCompanies: (jobs: unknown[]) =>
      ipcRenderer.invoke("claude:deduplicateCompanies", jobs),
    suggestJobTitles: (companies: unknown[]) =>
      ipcRenderer.invoke("claude:suggestJobTitles", companies),
    personalizeEmails: (params: { contacts: unknown[]; template: string; jobs: unknown[] }) =>
      ipcRenderer.invoke("claude:personalizeEmails", params),
  },

  // Files
  files: {
    exportAccountsCsv: (accounts: unknown[]) =>
      ipcRenderer.invoke("files:exportAccountsCsv", accounts),
    getExportFiles: () => ipcRenderer.invoke("files:getExportFiles"),
    startDrag: (filePath: string) =>
      ipcRenderer.send("files:startDrag", filePath),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (settings: Record<string, unknown>) =>
      ipcRenderer.invoke("settings:update", settings),
  },

  // Events (main → renderer)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ApiType = typeof api;
