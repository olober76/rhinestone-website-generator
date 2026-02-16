import React from "react";
import useStore from "./store";
import Header from "./components/Header";
import UploadZone from "./components/UploadZone";
import EditorCanvas from "./components/EditorCanvas";
import ControlPanel from "./components/ControlPanel";
import ExportPanel from "./components/ExportPanel";
import Toolbar from "./components/Toolbar";

export default function App() {
  const sessionId = useStore((s) => s.sessionId);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 text-sm text-center">
          {error}
          <button
            className="ml-4 underline"
            onClick={() => useStore.getState().setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {!sessionId ? (
        <div className="flex-1 flex items-center justify-center p-8">
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="spinner" />
              <p className="text-gray-400 text-sm">Processing image, please wait...</p>
            </div>
          ) : (
            <UploadZone />
          )}
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left — Controls */}
          <aside className="w-80 min-w-[320px] max-w-[320px] shrink-0 border-r border-gray-700/50 overflow-y-auto bg-surface-light flex flex-col">
            <ControlPanel />
            <ExportPanel />
          </aside>

          {/* Center — Canvas */}
          <main className="flex-1 flex flex-col">
            <Toolbar />
            <div className="flex-1 relative flex items-center justify-center overflow-auto p-4 bg-surface">
              {loading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="spinner" />
                </div>
              )}
              <EditorCanvas />
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
