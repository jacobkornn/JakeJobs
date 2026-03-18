import { useNavigate } from "react-router-dom";

const actions = [
  {
    title: "Pull from Careerflow",
    description: "Fetch new job postings and deduplicate companies",
    path: "/pull-jobs",
    color: "blue",
  },
  {
    title: "Export Accounts",
    description: "Generate CSV for Sales Navigator import",
    path: "/export-accounts",
    color: "green",
  },
  {
    title: "Pull from Wiza",
    description: "Enrich contacts for exported accounts",
    path: "/pull-contacts",
    color: "purple",
  },
  {
    title: "Outreach",
    description: "Personalize and stage outreach emails",
    path: "/outreach",
    color: "orange",
  },
];

const colorMap: Record<string, string> = {
  blue: "border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/5",
  green: "border-green-500/30 hover:border-green-500/60 hover:bg-green-500/5",
  purple: "border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5",
  orange: "border-orange-500/30 hover:border-orange-500/60 hover:bg-orange-500/5",
};

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Dashboard</h2>
      <p className="text-sm text-gray-500 mb-8">Choose an action to get started</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        {actions.map((action) => (
          <button
            key={action.path}
            onClick={() => navigate(action.path)}
            className={`text-left p-5 bg-gray-900 border rounded-lg transition-all ${colorMap[action.color]}`}
          >
            <h3 className="text-base font-semibold text-gray-200">{action.title}</h3>
            <p className="text-sm text-gray-500 mt-1">{action.description}</p>
          </button>
        ))}
      </div>

      <div className="mt-12 max-w-3xl">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Workflow</h3>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="px-2 py-1 bg-blue-900/30 text-blue-400 rounded">Careerflow</span>
          <span>&rarr;</span>
          <span className="px-2 py-1 bg-gray-800 text-gray-400 rounded">Claude dedup</span>
          <span>&rarr;</span>
          <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded">CSV Export</span>
          <span>&rarr;</span>
          <span className="px-2 py-1 bg-gray-800 text-gray-400 rounded">Sales Navigator</span>
          <span>&rarr;</span>
          <span className="px-2 py-1 bg-purple-900/30 text-purple-400 rounded">Wiza</span>
          <span>&rarr;</span>
          <span className="px-2 py-1 bg-orange-900/30 text-orange-400 rounded">Outreach</span>
        </div>
      </div>
    </div>
  );
}
