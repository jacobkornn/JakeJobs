import { useState } from "react";
import { format } from "date-fns";
import DateRangePicker from "../components/DateRangePicker";
import StatusFeed, { type StatusMessage } from "../components/StatusFeed";
import { api } from "../lib/ipc";

interface ContactRow {
  name: string;
  email: string;
  company: string;
  title: string;
}

export default function PullContacts() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [pulling, setPulling] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);

  const addMessage = (text: string, type: StatusMessage["type"] = "info") => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, type, timestamp: new Date() },
    ]);
  };

  const handlePull = async () => {
    if (!api) return;
    setPulling(true);
    setMessages([]);
    setContacts([]);

    try {
      addMessage("Pulling contacts from Wiza...");
      const result = await api.wiza.pullContacts({ dateFrom, dateTo });

      if (result.message) {
        addMessage(result.message, "warning");
      }

      if (result.contacts.length === 0) {
        addMessage("No contacts found for the selected timeframe.", "warning");
        setPulling(false);
        return;
      }

      const contactRows: ContactRow[] = result.contacts.map((c) => ({
        name: c.fullname || `${c.firstname || ""} ${c.lastname || ""}`.trim(),
        email: c.email || c.emailaddress1 || "",
        company: c.company || "",
        title: c.jobtitle || c.title || "",
      }));

      setContacts(contactRows);
      addMessage(`Found ${contactRows.length} contacts.`, "success");
    } catch (err) {
      addMessage(`Error: ${String(err)}`, "error");
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-white mb-1">Pull from Wiza</h2>
      <p className="text-sm text-gray-500 mb-6">
        Enrich contacts for your exported accounts
      </p>

      <div className="flex items-end gap-4 mb-4">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        <button
          onClick={handlePull}
          disabled={pulling}
          className="px-5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
        >
          {pulling ? "Pulling..." : "Pull Contacts"}
        </button>
      </div>

      <StatusFeed messages={messages} />

      {contacts.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-400 mb-3">{contacts.length} Contacts</h3>
          <div className="overflow-auto max-h-[500px] border border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 sticky top-0">
                <tr className="text-left text-gray-500 text-xs">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Title</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-900/50">
                    <td className="px-3 py-2 text-gray-200">{c.name}</td>
                    <td className="px-3 py-2 text-gray-300">{c.email}</td>
                    <td className="px-3 py-2 text-gray-400">{c.company}</td>
                    <td className="px-3 py-2 text-gray-400">{c.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
