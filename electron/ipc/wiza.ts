import { IpcMain } from "electron";

// Stub - needs Wiza API docs to implement
// Will be replaced with actual API calls once docs are provided

const WIZA_API_KEY = () => process.env.WIZA_API_KEY || "";
const WIZA_BASE_URL = "https://api.wiza.co"; // placeholder

export function registerWizaHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    "wiza:pullContacts",
    async (_event, params: { dateFrom: string; dateTo: string }) => {
      const apiKey = WIZA_API_KEY();
      if (!apiKey) {
        throw new Error("WIZA_API_KEY not configured in .env");
      }

      // TODO: Replace with actual Wiza API call
      console.log(`[Wiza] Pulling contacts from ${params.dateFrom} to ${params.dateTo}`);

      /*
      const res = await fetch(`${WIZA_BASE_URL}/contacts`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      return data.contacts;
      */

      return {
        contacts: [],
        message: "Wiza API not yet configured. Provide API docs to implement.",
      };
    }
  );
}
