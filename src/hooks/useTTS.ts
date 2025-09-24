// src/hooks/useTTS.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TTSOptions = {
  lang?: string;     // "fr-FR" par défaut
  rate?: number;     // 0.5..2 (1 par défaut)
  pitch?: number;    // 0..2 (1 par défaut)
  voiceName?: string; // optionnel: nom de voix spécifique
};

export function useTTS(opts: TTSOptions = {}) {
  const [supported, setSupported] = useState<boolean>(false);
  const [speaking, setSpeaking] = useState<boolean>(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // load voices
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;

    return () => {
      window.speechSynthesis.onvoiceschanged = null as any;
    };
  }, []);

  const stop = useCallback(() => {
    try {
      window.speechSynthesis.cancel();
    } catch {}
    setSpeaking(false);
    utterRef.current = null;
  }, []);

  const speak = useCallback((text: string) => {
    if (!supported || !text?.trim()) return;
    stop();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang ?? "fr-FR";
    u.rate = typeof opts.rate === "number" ? opts.rate : 1;
    u.pitch = typeof opts.pitch === "number" ? opts.pitch : 1;

    if (opts.voiceName && voices.length) {
      const v = voices.find(v => v.name === opts.voiceName);
      if (v) u.voice = v;
    } else {
      // pick a FR voice if possible
      const v = voices.find(v => v.lang?.toLowerCase().startsWith("fr"));
      if (v) u.voice = v;
    }

    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);

    utterRef.current = u;
    try {
      window.speechSynthesis.speak(u);
    } catch {}
  }, [opts.lang, opts.rate, opts.pitch, opts.voiceName, supported, voices, stop]);

  return { supported, speaking, voices, speak, stop };
}
