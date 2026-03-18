import { useState, useEffect } from "react";
import { api } from "../lib/ipc";

export default function SyncButton() {
  const [pending, setPending] = useState({ accounts: 0, contacts: 0, jobs: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const total = pending.accounts + pending.contacts + pending.jobs;

  useEffect(() => {
    const interval = setInterval(async () => {
      if (api) {
        const counts = await api.dynamics.getPendingCount();
        setPending(counts);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    if (!api || total === 0) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const result = await api.dynamics.syncPending();
      const msg = `Synced: ${result.accounts} accounts, ${result.contacts} contacts, ${result.jobs} jobs`;
      setLastResult(result.errors.length > 0 ? `${msg} (${result.errors.length} errors)` : msg);
      setPending({ accounts: 0, contacts: 0, jobs: 0 });
    } catch (err) {
      setLastResult(`Sync failed: ${String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={syncing || total === 0}
        className={`w-full py-2 px-3 rounded text-sm font-medium transition-colors ${
          total > 0
            ? "bg-blue-600 hover:bg-blue-500 text-white"
            : "bg-gray-800 text-gray-500 cursor-not-allowed"
        }`}
      >
        {syncing ? "Syncing..." : `Sync to Dynamics${total > 0 ? ` (${total})` : ""}`}
      </button>
      {total > 0 && (
        <p className="text-xs text-gray-500 mt-1 px-1">
          {pending.accounts}A {pending.contacts}C {pending.jobs}J pending
        </p>
      )}
      {lastResult && (
        <p className="text-xs text-green-400 mt-1 px-1">{lastResult}</p>
      )}
    </div>
  );
}
