import { format } from "date-fns";

interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
}

export default function DateRangePicker({ dateFrom, dateTo, onChange }: DateRangePickerProps) {
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="flex items-center gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">From</label>
        <input
          type="date"
          value={dateFrom}
          max={today}
          onChange={(e) => onChange(e.target.value, dateTo)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">To</label>
        <input
          type="date"
          value={dateTo}
          max={today}
          onChange={(e) => onChange(dateFrom, e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}
