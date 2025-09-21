"use client";

import { useState } from "react";
import DeepgramSTT from "./DeepgramSTT";
import LiveSTT from "./LiveSTT";

export default function InterviewPage() {
  const [usePro, setUsePro] = useState(true);
  const [status, setStatus] = useState("");
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<string[]>([]);

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Interview</h1>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={usePro}
          onChange={(e) => setUsePro(e.target.checked)}
        />
        Utiliser Deepgram (pro) — décocher pour STT navigateur
      </label>

      <span className="text-xs text-gray-500">{status}</span>

      {usePro ? (
        <DeepgramSTT
          onPartial={setPartial}
          onFinal={(t) => setFinals((p) => [...p, t])}
          setStatus={setStatus}
        />
      ) : (
        <LiveSTT
          onPartial={setPartial}
          onFinal={(t) => setFinals((p) => [...p, t])}
          setStatus={setStatus}
        />
      )}

      <div>
        <h2 className="text-sm text-gray-500">En cours…</h2>
        <div className="p-3 bg-white shadow rounded min-h-12">{partial}</div>
      </div>

      <div>
        <h2 className="text-sm text-gray-500">Validé</h2>
        <div className="space-y-1">
          {finals.map((f, i) => (
            <div key={i} className="p-2 bg-gray-50 rounded">
              {f}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
