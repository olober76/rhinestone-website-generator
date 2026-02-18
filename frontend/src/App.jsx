import React from "react";
import useStore from "./store";
import Header from "./components/Header";
import CanvasSetup from "./components/CanvasSetup";
import EditorCanvas from "./components/EditorCanvas";
import ControlPanel from "./components/ControlPanel";
import ExportPanel from "./components/ExportPanel";
import LayerPanel from "./components/LayerPanel";
import Toolbar from "./components/Toolbar";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

export default function App() {
  const canvasCreated = useStore((s) => s.canvasCreated);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const rightSidebarOpen = useStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useStore((s) => s.toggleRightSidebar);

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

      {!canvasCreated ? (
        /* ── Canvas Setup Screen ── */
        <CanvasSetup />
      ) : (
        /* ── Editor Layout ── */
        <div className="flex-1 flex overflow-hidden">
          {/* Left — Controls */}
          <aside className="w-80 min-w-[320px] max-w-[320px] shrink-0 border-r border-gray-700/50 overflow-y-auto bg-surface-light flex flex-col">
            <ControlPanel />
            <ExportPanel />
          </aside>

          {/* Center — Canvas */}
          <main className="flex-1 flex flex-col min-w-0">
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

          {/* Right — Layer Panel (hideable) */}
          {rightSidebarOpen && (
            <aside className="w-72 min-w-[288px] max-w-[288px] shrink-0 border-l border-gray-700/50 overflow-y-auto bg-surface-light flex flex-col relative">
              <LayerPanel />
            </aside>
          )}

          {/* Right sidebar toggle — top-right corner */}
          <button
            onClick={toggleRightSidebar}
            className="absolute top-16 right-2 z-40 p-1.5 rounded-md bg-surface-light border border-gray-700/50 text-gray-400 hover:text-white hover:bg-surface-lighter transition"
            title={rightSidebarOpen ? "Hide layers panel" : "Show layers panel"}
          >
            {rightSidebarOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
