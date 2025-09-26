"use client";

import { useCallback, useRef, useState } from "react";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * TTS basé sur /api/tts (OpenAI gpt-4o-mini-tts) avec gestion propre:
 * - Séquentialise les lectures (pas de chevauchement),
 * - Evite AbortError (pause/play),
 * - Révoque les blobs,
 * - Gère l'autoplay bloqué (NotAllowedError).
 */
export function useBetterTTS(defaultVoice = "alloy") {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tokenRef = useRef<number>(0); // anti-course
  const currentJobRef = useRef<Promise<void> | null>(null);

  const cleanup = () => {
    try {
      const a = audioRef.current;
      if (a) {
        a.onended = null;
        a.onerror = null;
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    } catch {}
  };

  const stop = useCallback(async () => {
    try {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
    } catch {}
    setPlaying(false);
    cleanup();
    await sleep(10);
  }, []);

  const speak = useCallback(async (text: string, voice?: string) => {
    const clean = text?.trim();
    if (!clean) return;

    const myToken = ++tokenRef.current;

    // stoppe une éventuelle lecture en cours avant d'en lancer une autre
    await stop();

    setLoading(true);
    const job = (async () => {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voice: voice ?? defaultVoice }),
        });

        if (!res.ok) {
          try {
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const err = await res.json();
              console.error("TTS HTTP error", res.status, err);
            } else {
              const txt = await res.text();
              console.error("TTS HTTP error", res.status, txt.slice(0, 200));
            }
          } catch {
            console.error("TTS HTTP error", res.status);
          }
          return;
        }

        if (myToken !== tokenRef.current) return;

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        let audio = audioRef.current;
        if (!audio) {
          audio = new Audio();
          audioRef.current = audio;
        }
        audio.src = url;

        audio.onended = () => {
          setPlaying(false);
          cleanup();
        };
        audio.onerror = () => {
          setPlaying(false);
          cleanup();
        };

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === "function") {
          await playPromise
            .then(() => {
              if (myToken !== tokenRef.current) return;
              setPlaying(true);
            })
            .catch((err: any) => {
              if (err?.name === "NotAllowedError") {
                console.warn("[TTS] Lecture bloquée par le navigateur (autoplay). Clic requis (Relire).");
              } else if (err?.name !== "AbortError") {
                console.error("audio.play() failed:", err);
              }
              setPlaying(false);
            });
        } else {
          setPlaying(true);
        }
      } finally {
        if (myToken === tokenRef.current) setLoading(false);
      }
    })();

    currentJobRef.current = job;
    await job.catch(() => {});
    if (myToken === tokenRef.current) {
      currentJobRef.current = null;
    }
  }, [defaultVoice, stop]);

  return { speak, stop, loading, playing };
}
