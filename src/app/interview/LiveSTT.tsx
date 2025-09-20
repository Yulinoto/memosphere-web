// src/app/interview/LiveSTT.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type SRConstructor = new () => SpeechRecognition;

function getSRConstructor(): SRConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export default function LiveSTT({
  lang = "fr-FR",
  onFinal,
}: {
  lang?: string;
  onFinal?: (text: string) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SR = getSRConstructor();
    if (!SR) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (res.isFinal) finalChunk += alt.transcript + " ";
        else interim += alt.transcript;
      }
      setPartial(interim);
      if (finalChunk.trim()) onFinal?.(finalChunk.trim());
    };

    rec.onend = () => setListening(false);

    recognitionRef.current = rec;

    return () => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    };
  }, [lang, onFinal]);

  const start = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.start();
      setListening(true);
    } catch {/* noop */}
  };

  const stop = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
      setListening(false);
    } catch {/* noop */}
  };

  if (supported === null) {
    return <div className="p-3 rounded-lg border">Initialisation STT…</div>;
  }
  if (supported === false) {
    return (
      <div className="p-3 rounded-lg border bg-yellow-50">
        La transcription en direct n’est pas supportée par ce navigateur.
        Utilise Chrome/Edge. (On ajoutera Whisper côté serveur ensuite.)
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={listening ? stop : start}
          className={`rounded-xl px-4 py-2 border ${
            listening ? "bg-green-100" : "hover:bg-gray-50"
          }`}
        >
          {listening ? "STT ON — Arrêter" : "Transcrire en direct (beta)"}
        </button>
        {listening && <span className="text-sm text-green-700">Écoute en cours…</span>}
      </div>
      <div className="min-h-12 text-sm text-gray-700 italic">
        {partial ? `• ${partial}` : "— (texte provisoire en direct) —"}
      </div>
    </div>
  );
}
