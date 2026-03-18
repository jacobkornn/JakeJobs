import { useState } from "react";
import { api } from "../lib/ipc";

export default function SyncButton() {
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleRefresh = async () => {
    if (!api) return;
    setRefreshing(true);
    setLastResult(null);
    try {
      const result = await api.dynamics.refreshCaches();
      setLastResult(`${result.accounts} accounts, ${result.jobLinks} jobs loaded`);
    } catch (err) {
      setLastResult(`Failed: ${String(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="w-full py-2 px-3 rounded text-sm font-medium transition-colors bg-gray-800 hover:bg-gray-700 text-gray-300"
      >
        {refreshing ? "Refreshing..." : "Refresh Dynamics Cache"}
      </button>
      {lastResult && (
        <p className="text-xs text-gray-500 mt-1 px-1">{lastResult}</p>
      )}
    </div>
  );
}
