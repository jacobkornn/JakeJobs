// Typed wrapper around the preload API exposed via contextBridge

export interface ProcessBatchResult {
  newAccounts: number;
  existingAccounts: number;
  newJobs: number;
  skippedJobs: number;
  errors: string[];
}

export interface DynamicsApi {
  getAccounts: () => Promise<Array<{ id: string; name: string; domain?: string; website?: string }>>;
  getContacts: () => Promise<Array<{ id: string; name: string; email?: string; accountId?: string }>>;
  getJobs: () => Promise<Array<Record<string, string>>>;
  processJobBatch: (jobs: Array<Record<string, string>>) => Promise<ProcessBatchResult>;
  getBatchNewAccounts: () => Promise<Array<{ id: string; name: string; website?: string }>>;
  getBatchNewJobs: () => Promise<Array<Record<string, unknown>>>;
  refreshCaches: () => Promise<{ accounts: number; jobLinks: number }>;
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

export interface WizaList {
  id: number;
  name: string;
  status: string;
  created_at: string;
  finished_at?: string;
  stats?: { people?: number; credits?: number };
  enrichment_level?: string;
}

export interface WizaApi {
  getCredits: () => Promise<{ credits: Record<string, unknown> }>;
  getList: (listId: number) => Promise<WizaList>;
  getListContacts: (listId: number) => Promise<{ contacts: Array<Record<string, unknown>>; count: number }>;
  processContacts: (contacts: Array<Record<string, string>>) =>
    Promise<{ created: number; existing: number; noEmail: number; matched: number; unmatched: number; errors: string[] }>;
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
    leadType?: string;
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
  getAttachments: (leadType: string) => Promise<Array<{ name: string; contentBytes: string; contentType: string }>>;
}

export interface TrackedEmail {
  messageId: string;
  conversationId: string;
  to: string;
  subject: string;
  sentAt: string;
  contactId?: string;
  jobId?: string;
}

export interface EmailReply {
  originalEmail: TrackedEmail;
  replyFrom: string;
  replySubject: string;
  replyPreview: string;
  replyReceivedAt: string;
}

export interface GraphApi {
  sendEmail: (email: {
    to: string;
    subject: string;
    bodyHtml: string;
    contactId?: string;
    jobId?: string;
    attachments?: Array<{ name: string; contentBytes: string; contentType: string }>;
  }) => Promise<{ success: boolean; tracked: TrackedEmail | null }>;
  checkReplies: () => Promise<EmailReply[]>;
  getTrackedEmails: () => Promise<TrackedEmail[]>;
  loadTrackedEmails: () => Promise<number>;
  saveTrackedEmails: () => Promise<number>;
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
  graph: GraphApi;
  settings: SettingsApi;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}

export const api = (typeof window !== "undefined" ? window.api : null) as Api;
