import React from "react";
import useStore from "../store";
import { ArrowLeft, Diamond } from "lucide-react";

export default function Header() {
  const sessionId = useStore((s) => s.sessionId);
  const dotCount = useStore((s) => s.dots.length);

  return (
    <header className="h-14 bg-surface-light border-b border-gray-700/50 flex items-center px-5 gap-3 shrink-0">
      {/* Back button first, then logo — swapped positions */}
      {sessionId && (
        <button
          onClick={() => {
            useStore.getState().setSessionId(null);
            useStore.getState().setDots([]);
            useStore.getState().resetParams();
          }}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition text-sm mr-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      )}

      <Diamond className="w-6 h-6 text-brand-500" />
      <h1 className="text-lg font-bold tracking-tight">
        Halftone <span className="text-brand-500">Studio</span>
      </h1>

      {sessionId && (
        <div className="ml-auto flex items-center gap-4 text-sm text-gray-400">
          <span>
            <strong className="text-gray-200">
              {dotCount.toLocaleString()}
            </strong>{" "}
            dots
          </span>
        </div>
      )}
    </header>
  );
}
