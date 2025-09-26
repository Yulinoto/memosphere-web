"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  setStatus: (s: string) => void;
  onStart?: () => void;
  onStop?: () => void;
  buttonLabel?: string;

  /** Mains libres: reconnexion auto, pas besoin de recliquer */
  auto?: boolean;
  /** Langue (par défaut fr-FR) */
  lang?: string;
  /** Relance après fin (ms) en auto */
  autoRestartDelayMs?: number;
};

type WebkitSpeechRecognition = typeof window extends any
  ? any
  : never;

export default function LiveSTT({
  onPartial,
  onFinal,
  setStatus,
  onStart,
  onStop,
  buttonLabel = "Voix (navigateur)",
  auto = false,
  lang = "fr-FR",
  autoRestartDelayMs = 250
}: Props) {
  const recRef = useRef<WebkitSpeechRecognition | null>(null);
  const [supported, setSupported] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [permissionAsked, setPermissionAsked] = useState(false); // pour la 1re activation

  // Init / feature detection
  useEffect(() => {
    const W = window as any;
    if ("webkitSpeechRecognition" in W) {
      setSupported(true);
    } else {
      setSupported(false);
      setStatus("Reconnaissance vocale non supportée (essayez Chrome/Edge).");
    }
  }, [setStatus]);

  const attachHandlers = (rec: any) => {
    rec.onstart = () => {
      setRecognizing(true);
      setStatus("J’écoute…");
      onStart?.();
    };
    rec.onerror = (evt: any) => {
      const err = evt?.error;
      // Quelques erreurs fréquentes : "no-speech", "audio-capture", "not-allowed"
      if (err === "not-allowed" || err === "service-not-allowed") {
        setStatus("Permission micro refusée.");
      } else if (err === "no-speech") {
        setStatus("Pas de voix détectée.");
      } else {
        setStatus(`Erreur STT: ${err || "inconnue"}`);
      }
    };
    rec.onend = () => {
      setRecognizing(false);
      onStop?.();
      if (auto) {
        // Relance douce
        setTimeout(() => {
          tryStart();
        }, autoRestartDelayMs);
      } else {
        setStatus("Prêt.");
      }
    };
    rec.onresult = (evt: any) => {
      let interim = "";
      let finalText = "";

      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const res = evt.results[i];
        if (res.isFinal) {
          finalText += res[0].transcript;
        } else {
          interim += res[0].transcript;
        }
      }

      // Affichage du partiel
      onPartial(interim.trim());

      // À chaque finale, on pousse
      if (finalText.trim()) {
        onFinal(finalText.trim());
        onPartial(""); // nettoie l'interim
        // En mode auto + continuous, le moteur reste ouvert
        // On laisse tourner (le onend relancera si besoin)
      }
    };
  };

  const createRecognizer = () => {
    const W = window as any;
    const rec = new W.webkitSpeechRecognition();
    rec.continuous = true;         // écoute continue
    rec.interimResults = true;     // résultats partiels "en direct"
    rec.lang = lang;
    attachHandlers(rec);
    recRef.current = rec;
    return rec;
  };

  const tryStart = async () => {
    if (!supported) return;
    // Si un ancien instance existe, on s’assure qu’elle est stoppée
    try {
      recRef.current?.stop();
    } catch {}

    const rec = recRef.current ?? createRecognizer();

    try {
      rec.start(); // peut throw si pas d'interaction préalable
      setPermissionAsked(true);
    } catch (e: any) {
      // Autoplay/permissions: il faut un clic utilisateur initial
      // On laisse un statut explicite pour guider l’utilisateur
      if (e?.message?.includes("start")) {
        setStatus("Clique sur le bouton pour activer le micro.");
      } else {
        setStatus("Impossible de démarrer la reconnaissance (autorisation ?).");
      }
    }
  };

  const stop = () => {
    try {
      recRef.current?.stop();
    } catch {}
  };

  // Effet: mode auto => démarrer si possible
  useEffect(() => {
    if (!auto) return;
    // Si l’utilisateur n’a jamais autorisé le micro, il faudra un clic.
    if (!permissionAsked) return;
    if (!recognizing) {
      tryStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  // Cleanup
  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {}
      recRef.current = null;
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button
        className={`px-3 py-2 border rounded text-sm ${recognizing ? "bg-red-50" : "hover:bg-gray-50"}`}
        onClick={() => {
          if (!supported) return;
          if (recognizing) {
            stop();
          } else {
            tryStart();
          }
        }}
        title={recognizing ? "Arrêter" : "Activer le micro"}
      >
        {recognizing ? "■ Stop" : `🎙️ ${buttonLabel}`}
      </button>

      {auto ? (
        <span className="text-xs text-gray-600">Mains libres activé</span>
      ) : (
        <span className="text-xs text-gray-500">Cliquer pour parler</span>
      )}
    </div>
  );
}
