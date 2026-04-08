import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Dynamics 365
  dynamics: {
    getAccounts: () => ipcRenderer.invoke("dynamics:getAccounts"),
    getContacts: () => ipcRenderer.invoke("dynamics:getContacts"),
    getJobs: () => ipcRenderer.invoke("dynamics:getJobs"),
    processJobBatch: (jobs: Array<Record<string, string>>) =>
      ipcRenderer.invoke("dynamics:processJobBatch", jobs),
    getBatchNewAccounts: () => ipcRenderer.invoke("dynamics:getBatchNewAccounts"),
    getBatchNewJobs: () => ipcRenderer.invoke("dynamics:getBatchNewJobs"),
    refreshCaches: () => ipcRenderer.invoke("dynamics:refreshCaches"),
    getSystemUserId: (email: string) =>
      ipcRenderer.invoke("dynamics:getSystemUserId", email),
    logEmailActivity: (params: { contactId: string; subject: string; body: string; senderSystemUserId: string; jobPostingId?: string }) =>
      ipcRenderer.invoke("dynamics:logEmailActivity", params),
    getSentEmails: (senderSystemUserId: string) =>
      ipcRenderer.invoke("dynamics:getSentEmails", senderSystemUserId),
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
    getCredits: () => ipcRenderer.invoke("wiza:getCredits"),
    getList: (listId: number) => ipcRenderer.invoke("wiza:getList", listId),
    getListContacts: (listId: number) => ipcRenderer.invoke("wiza:getListContacts", listId),
    processContacts: (contacts: Array<Record<string, string>>) =>
      ipcRenderer.invoke("wiza:processContacts", contacts),
  },

  // Claude
  claude: {
    deduplicateCompanies: (jobs: unknown[]) =>
      ipcRenderer.invoke("claude:deduplicateCompanies", jobs),
    suggestJobTitles: (companies: unknown[]) =>
      ipcRenderer.invoke("claude:suggestJobTitles", companies),
    personalizeEmails: (params: { contacts: unknown[]; template: string; jobs: unknown[]; leadType?: string }) =>
      ipcRenderer.invoke("claude:personalizeEmails", params),
  },

  // Files
  files: {
    exportAccountsCsv: (accounts: unknown[]) =>
      ipcRenderer.invoke("files:exportAccountsCsv", accounts),
    getExportFiles: () => ipcRenderer.invoke("files:getExportFiles"),
    startDrag: (filePath: string) =>
      ipcRenderer.send("files:startDrag", filePath),
    getAttachments: (leadType: string) =>
      ipcRenderer.invoke("files:getAttachments", leadType),
  },

  // Graph (Email send + reply tracking)
  graph: {
    sendEmail: (email: { to: string; subject: string; bodyHtml: string; contactId?: string; jobId?: string; attachments?: Array<{ name: string; contentBytes: string; contentType: string }> }) =>
      ipcRenderer.invoke("graph:sendEmail", email),
    checkReplies: (tracked: unknown[]) => ipcRenderer.invoke("graph:checkReplies", tracked),
    getMessageBody: (messageId: string) => ipcRenderer.invoke("graph:getMessageBody", messageId),
    getTrackedEmails: () => ipcRenderer.invoke("graph:getTrackedEmails"),
    loadTrackedEmails: () => ipcRenderer.invoke("graph:loadTrackedEmails"),
    saveTrackedEmails: () => ipcRenderer.invoke("graph:saveTrackedEmails"),
    backfillSentEmails: (params: { senderSystemUserId: string; sinceIso?: string; maxMessages?: number }) =>
      ipcRenderer.invoke("graph:backfillSentEmails", params),
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
