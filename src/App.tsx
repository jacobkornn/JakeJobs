import { Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import PullJobs from "./pages/PullJobs";
import ExportAccounts from "./pages/ExportAccounts";
import PullContacts from "./pages/PullContacts";
import Outreach from "./pages/Outreach";
import FollowUp from "./pages/FollowUp";
import SyncButton from "./components/SyncButton";

function App() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white">JakeJobs</h1>
          <p className="text-xs text-gray-500">System</p>
        </div>

        <div className="flex-1 py-2">
          <NavItem to="/" label="Dashboard" icon="grid" />
          <NavItem to="/pull-jobs" label="Pull from Careerflow" icon="download" />
          <NavItem to="/export-accounts" label="Export Accounts" icon="upload" />
          <NavItem to="/pull-contacts" label="Pull from Wiza" icon="users" />
          <NavItem to="/outreach" label="Outreach" icon="mail" />
          <NavItem to="/follow-up" label="Follow-Up" icon="reply" />
        </div>

        <div className="p-3 border-t border-gray-800">
          <SyncButton />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pull-jobs" element={<PullJobs />} />
          <Route path="/export-accounts" element={<ExportAccounts />} />
          <Route path="/pull-contacts" element={<PullContacts />} />
          <Route path="/outreach" element={<Outreach />} />
          <Route path="/follow-up" element={<FollowUp />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  const icons: Record<string, string> = {
    grid: "\u25A6",
    download: "\u2B07",
    upload: "\u2B06",
    users: "\u263A",
    mail: "\u2709",
    reply: "\u21A9",
  };

  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
          isActive
            ? "bg-blue-600/20 text-blue-400 border-r-2 border-blue-400"
            : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
        }`
      }
    >
      <span className="text-base">{icons[icon] || "\u25CF"}</span>
      {label}
    </NavLink>
  );
}

export default App;
