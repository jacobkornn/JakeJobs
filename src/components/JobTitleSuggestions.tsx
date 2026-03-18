import { useState } from "react";
import { api } from "../lib/ipc";

interface JobTitleSuggestionsProps {
  companies: Array<Record<string, string>>;
}

export default function JobTitleSuggestions({ companies }: JobTitleSuggestionsProps) {
  const [titles, setTitles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleGenerate = async () => {
    if (!api || companies.length === 0) return;
    setLoading(true);
    try {
      const result = await api.claude.suggestJobTitles(companies);
      setTitles(result);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to generate job title suggestions:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!loaded) {
    return (
      <button
        onClick={handleGenerate}
        disabled={loading || companies.length === 0}
        className="text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors"
      >
        {loading ? "Generating suggestions..." : "Get job title suggestions from Claude"}
      </button>
    );
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">Suggested job titles for Sales Navigator search:</p>
      <div className="flex flex-wrap gap-2">
        {titles.map((title, i) => (
          <span
            key={i}
            className="px-2.5 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full border border-blue-600/30"
          >
            {title}
          </span>
        ))}
      </div>
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="text-xs text-gray-500 hover:text-gray-400 mt-2 transition-colors"
      >
        {loading ? "Regenerating..." : "Regenerate"}
      </button>
    </div>
  );
}
