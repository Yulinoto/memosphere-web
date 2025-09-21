// src/app/interview/LiveSTT.tsx
"use client";

import { useEffect, useRef, useState } from "react";

/** Types minimaux pour éviter les prises de tête TS strictes */
type SRConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: any) => void) | null;
  onend: (() => void) | null;
};

function getSRConstructor(): SRConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  // Chrome/Edge: webkitSpeechRecognition; Firefox: pas supporté
  const ctor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return ctor ? (ctor as SRConstructor) : undefined;
}

type Props = {
  lang?: string;                      // par défaut "fr-FR"
  onPartial?: (t: string) => void;    // texte provisoire (interim)
  onFinal?: (t: string) => void;      // texte validé (final)
  setStatus?: (s: string) => void;    // petit statut UI
};

export default function LiveSTT({
  lang = "fr-FR",
  onPartial,
  onFinal,
  setStatus,
}: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const SR = getSRConstructor();
    if (!SR) {
      setSupported(false);
      setStatus?.("STT navigateur non supporté (essaie Chrome/Edge).");
      return;
    }
    setSupported(true);

    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      // Agrège l'interim et collecte les finals
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (res.isFinal) finalChunk += alt.transcript + " ";
        else interim += alt.transcript;
      }
      setPartial(interim);
      onPartial?.(interim);
      const finalTrim = finalChunk.trim();
      if (finalTrim) onFinal?.(finalTrim);
    };

    rec.onend = () => {
      setListening(false);
      setStatus?.("STT arrêté.");
    };

    recRef.current = rec;

    return () => {
      try {
        rec.stop();
      } catch {/* noop */}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const start = () => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.start();
      setListening(true);
      setStatus?.("STT navigateur en cours…");
    } catch {/* noop */}
  };

  const stop = () => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
      setListening(false);
      setStatus?.("STT arrêté.");
    } catch {/* noop */}
  };

  if (supported === null) {
    return <div className="p-3 rounded-lg border">Initialisation STT…</div>;
  }
  if (supported === false) {
    return (
      <div className="p-3 rounded-lg border bg-yellow-50">
        La transcription en direct n’est pas supportée par ce navigateur.
        Utilise Chrome/Edge, ou active Deepgram dans le switch.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={listening ? stop : start}
          className={`rounded-xl px-4 py-2 border ${listening ? "bg-green-100" : "hover:bg-gray-50"}`}
        >
          {listening ? "STT ON — Arrêter" : "Transcrire en direct (navigateur)"}
        </button>
        {listening && <span className="text-sm text-green-700">Écoute en cours…</span>}
      </div>

      <div className="min-h-12 text-sm text-gray-700 italic">
        {partial ? `• ${partial}` : "— (texte provisoire en direct) —"}
      </div>
    </div>
  );
}
