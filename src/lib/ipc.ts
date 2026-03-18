// Typed wrapper around the preload API exposed via contextBridge

export interface DynamicsApi {
  getAccounts: () => Promise<Array<{ id: string; name: string; domain?: string; website?: string; linkedinUrl?: string }>>;
  getContacts: () => Promise<Array<{ id: string; name: string; email?: string; accountId?: string }>>;
  getJobs: () => Promise<Array<Record<string, string>>>;
  syncPending: () => Promise<{ accounts: number; contacts: number; jobs: number; errors: string[] }>;
  getPendingCount: () => Promise<{ accounts: number; contacts: number; jobs: number }>;
}

export interface DownloadFile {
  fileName: string;
  filePath: string;
  size: number;
  modified: string;
}

export interface CareerflowApi {
  scanDownloads: () => Promise<DownloadFile[]>;
  pullJobs: (params: {
    filePaths: string[];
    dateFrom?: string;
    dateTo?: string;
  }) => Promise<{
    jobs: Array<Record<string, string>>;
    processedFiles: string[];
    pipelineFile: string;
  }>;
  archiveFiles: (filePaths: string[]) => Promise<string[]>;
  browseFiles: () => Promise<string[]>;
}

export interface WizaApi {
  pullContacts: (params: {
    dateFrom: string;
    dateTo: string;
  }) => Promise<{ contacts: Array<Record<string, string>>; message?: string }>;
}

export interface ClaudeApi {
  deduplicateCompanies: (
    jobs: Array<Record<string, string>>
  ) => Promise<Array<{ name: string; linkedinUrl: string; website: string; variations: string[] }>>;
  suggestJobTitles: (
    companies: Array<Record<string, string>>
  ) => Promise<string[]>;
  personalizeEmails: (params: {
    contacts: Array<Record<string, string>>;
    template: string;
    jobs: Array<Record<string, string>>;
  }) => Promise<Array<{ contactEmail: string; subject: string; body: string }>>;
}

export interface FilesApi {
  exportAccountsCsv: (
    accounts: Array<{ name: string; linkedinUrl?: string; website?: string; id?: string }>
  ) => Promise<{ filePath: string | null; count: number; fileName?: string; message?: string }>;
  getExportFiles: () => Promise<
    Array<{
      fileName: string;
      filePath: string;
      size: number;
      created: string;
      modified: string;
      rowCount: number;
    }>
  >;
  startDrag: (filePath: string) => void;
}

export interface SettingsApi {
  get: () => Promise<Record<string, unknown>>;
  update: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface Api {
  dynamics: DynamicsApi;
  careerflow: CareerflowApi;
  wiza: WizaApi;
  claude: ClaudeApi;
  files: FilesApi;
  settings: SettingsApi;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}

export const api = (typeof window !== "undefined" ? window.api : null) as Api;
