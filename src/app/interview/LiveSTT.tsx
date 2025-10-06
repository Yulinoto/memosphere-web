// src/app/interview/LiveSTT.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onPartial: (t: string) => void;
  onFinal: (t: string) => void | Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  onStart?: () => void;
  onStop?: () => void;
  /** Optionnel : callback en cas d’erreur "fatale" du STT navigateur */
  onFatal?: (why: string) => void;
  buttonLabel?: string;
  disabled?: boolean;
};

export default function LiveSTT({
  onPartial,
  onFinal,
  setStatus,
  onStart,
  onStop,
  onFatal,
  buttonLabel = "Parler (navigateur)",
  disabled
}: Props) {
  const [listening, setListening] = useState(false);
  const recogRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    return () => {
      try {
        recogRef.current?.stop();
        // @ts-expect-error vendor prefix
        recogRef.current?.abort?.();
      } catch {}
      recogRef.current = null;
    };
  }, []);

  const start = () => {
    // @ts-expect-error webkit prefix for Chrome
    const SR: typeof SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("STT navigateur indisponible");
      onFatal?.("no_speech_recognition");
      return;
    }

    try {
      const recog = new SR();
      recog.lang = "fr-FR";
      recog.interimResults = true;
      recog.continuous = true;
      recog.maxAlternatives = 1;

      recog.onstart = () => {
        setListening(true);
        setStatus("Écoute en cours…");
        onStart?.();
      };

      recog.onerror = (ev: any) => {
        const code = String(ev?.error || "unknown");
        setStatus(`Erreur STT (${code})`);
        onFatal?.(code);
      };

      recog.onresult = (ev: SpeechRecognitionEvent) => {
        let interim = "";
        let final = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          const txt = res[0]?.transcript ?? "";
          if (res.isFinal) final += txt;
          else interim += txt;
        }
        if (interim.trim()) onPartial(interim);
        if (final.trim()) onFinal(final);
      };

      recog.onend = () => {
        setListening(false);
        setStatus("Prêt.");
        onStop?.();
      };

      recogRef.current = recog;
      recog.start();
    } catch (e: any) {
      setStatus("Impossible de démarrer le STT.");
      onFatal?.("start_failed");
    }
  };

  const stop = () => {
    try {
      recogRef.current?.stop();
      // @ts-expect-error vendor prefix
      recogRef.current?.abort?.();
    } catch {}
    recogRef.current = null;
  };

  return (
    <button
      className={`px-3 py-2 border rounded text-sm ${listening ? "bg-red-50" : "hover:bg-gray-50"}`}
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      title={listening ? "Arrêter" : "Démarrer"}
    >
      {listening ? "■ Stop" : (buttonLabel || "Parler (navigateur)")}
    </button>
  );
}
