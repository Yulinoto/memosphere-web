// src/app/interview/LiveSTT.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type SpeechRecognitionType =
  | (typeof window & {
      webkitSpeechRecognition?: any;
      SpeechRecognition?: any;
    })["SpeechRecognition"]
  | any;

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
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalChunk += t + " ";
        } else {
          interim += t;
        }
      }
      setPartial(interim);
      if (finalChunk.trim()) {
        onFinal?.(finalChunk.trim());
      }
    };

    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, [lang, onFinal]);

  const start = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {}
  };

  const stop = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
      setListening(false);
    } catch {}
  };

  if (supported === null) {
    return <div className="p-3 rounded-lg border">Initialisation STT…</div>;
  }
  if (supported === false) {
    return (
      <div className="p-3 rounded-lg border bg-yellow-50">
        La transcription vocale en direct n’est pas supportée par ce navigateur.
        Utilise Chrome/Edge pour ce mode. (On ajoutera Whisper côté serveur ensuite.)
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
        {listening && (
          <span className="text-sm text-green-700">Écoute en cours…</span>
        )}
      </div>
      <div className="min-h-12 text-sm text-gray-700 italic">
        {partial ? `• ${partial}` : "— (texte provisoire en direct) —"}
      </div>
    </div>
  );
}
