"use client";

import { useEffect, useState } from "react";
import DeepgramSTT from "./DeepgramSTT";
import LiveSTT from "./LiveSTT";

export default function InterviewPage() {
  const [usePro, setUsePro] = useState(true);
  const [status, setStatus] = useState("");
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<string[]>([]);

  // mémoriser le choix utilisateur
  useEffect(() => {
    const saved = localStorage.getItem("stt_mode");
    if (saved === "browser") setUsePro(false);
  }, []);
  useEffect(() => {
    localStorage.setItem("stt_mode", usePro ? "pro" : "browser");
  }, [usePro]);

  const handlePartial = (t: string) => setPartial(t);
  const handleFinal = (t: string) => {
    setFinals((prev) => [...prev, t]);
    setPartial("");
  };

  // si Deepgram plante → fallback auto navigateur
  const handleFatal = (why: string) => {
    setStatus(`Deepgram indisponible (${why}). Passage au mode navigateur.`);
    setUsePro(false);
  };

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Interview</h1>
        <p className="text-sm text-gray-600">
          Choisis le moteur de transcription. Si “Pro” échoue, on bascule
          automatiquement sur le navigateur.
        </p>
      </header>

      <section className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={usePro}
            onChange={(e) => setUsePro(e.target.checked)}
          />
          Utiliser Deepgram (pro) — décocher pour STT navigateur
        </label>
        <span className="text-xs text-gray-500">{status}</span>
      </section>

      <section className="space-y-3">
        {usePro ? (
          <DeepgramSTT
            onPartial={handlePartial}
            onFinal={handleFinal}
            setStatus={setStatus}
            onFatal={handleFatal}   // ← fallback auto
          />
        ) : (
          <LiveSTT
            onPartial={handlePartial}
            onFinal={handleFinal}
            setStatus={setStatus}
          />
        )}

        <div className="space-y-2">
          <div className="text-sm text-gray-500">En cours…</div>
          <div className="min-h-12 p-3 rounded bg-white shadow text-sm">
            {partial || <em>(silence)</em>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-500">Transcriptions validées</div>
          <div className="space-y-1">
            {finals.map((f, i) => (
              <div key={i} className="p-3 rounded bg-white shadow text-sm">
                {f}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
