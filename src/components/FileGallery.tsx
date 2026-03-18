import { useState, useEffect } from "react";
import { api } from "../lib/ipc";

interface ExportFile {
  fileName: string;
  filePath: string;
  size: number;
  created: string;
  modified: string;
  rowCount: number;
}

export default function FileGallery() {
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFiles = async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.files.getExportFiles();
      setFiles(result.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()));
    } catch (err) {
      console.error("Failed to load export files:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleDragStart = (e: React.DragEvent, file: ExportFile) => {
    // Prevent the default browser drag behavior so Electron's native drag takes over
    e.preventDefault();
    // Electron's startDrag initiates an OS-level file drag (like dragging from File Explorer)
    api?.files.startDrag(file.filePath);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (loading) {
    return <div className="text-gray-500 text-sm py-4">Loading exports...</div>;
  }

  if (files.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center border border-dashed border-gray-700 rounded-lg">
        No exported CSVs yet. Export accounts to see them here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => (
        <div
          key={file.filePath}
          draggable
          onDragStart={(e) => handleDragStart(e, file)}
          className="bg-gray-800 border border-gray-700 rounded-lg p-3 cursor-grab hover:border-blue-500/50 hover:bg-gray-750 transition-colors active:cursor-grabbing group select-none"
        >
          <div className="flex items-start gap-2">
            <div className="text-2xl text-green-400 shrink-0">
              {"\u{1F4C4}"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-200 font-medium truncate" title={file.fileName}>
                {file.fileName}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {file.rowCount} rows &middot; {formatSize(file.size)}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {formatDate(file.created)}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            Drag to file explorer
          </p>
        </div>
      ))}
    </div>
  );
}

export { type ExportFile };
