"use client";

import { useRef, useState } from "react";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Hook TTS basé sur /api/tts (OpenAI gpt-4o-mini-tts).
 * - speak(text, voice?) : génère et joue l'audio (remplace l'audio en cours proprement)
 * - stop() : stoppe la lecture en cours
 * - loading : génération en cours
 * - playing : lecture en cours
 */
export function useBetterTTS(defaultVoice = "alloy") {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tokenRef = useRef<number>(0); // anti-course: id de requête

  function cleanupAudio() {
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
  }

  async function stop() {
    try {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
    } catch {}
    setPlaying(false);
    cleanupAudio();
  }

  async function speak(text: string, voice?: string) {
    const clean = text?.trim();
    if (!clean) return;

    // Invalide toute requête précédente
    const myToken = ++tokenRef.current;

    // Stoppe proprement l’audio en cours et laisse le navigateur "respirer"
    await stop();
    await sleep(20); // petit délai pour éviter l'AbortError sur certains navigateurs

    setLoading(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
          voice: voice ?? defaultVoice,
        }),
      });

      if (!res.ok) {
        // Log lisible même si ce n’est pas du JSON
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

      // Si une nouvelle speak() est partie entre temps, on abandonne ce résultat
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
        cleanupAudio();
      };
      audio.onerror = () => {
        setPlaying(false);
        cleanupAudio();
      };

      // Démarre la lecture avec gestion propre de l'AbortError
      const playPromise = audio.play();
if (playPromise && typeof playPromise.then === "function") {
  playPromise
    .then(() => {
      if (myToken !== tokenRef.current) return;
      setPlaying(true);
    })
    .catch((err: any) => {
      // Autoplay bloqué par le navigateur
      if (err?.name === "NotAllowedError") {
        console.warn("[TTS] Lecture bloquée par le navigateur (autoplay). L'utilisateur doit interagir (ex: cliquer).");
      } else if (err?.name === "AbortError") {
        // attendu si on stoppe/remplace très vite
      } else {
        console.error("audio.play() failed:", err);
      }
      setPlaying(false);
    });
} else {
  setPlaying(true);
}
          } finally {
      // Si une autre requête a pris la main, laisser son loading gérer
      if (myToken === tokenRef.current) setLoading(false);
    }
  }

  return { speak, stop, loading, playing };
}
