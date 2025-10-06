"use client";

import { useEffect, useRef, useState } from "react";
import { useUserNameFromBlocks } from "@/hooks/useUserNameFromBlocks";
import { useBetterTTS } from "@/hooks/useBetterTTS";

type Props = {
  value: string;
  onChange: (val: string) => void;
  onValidate: () => void;
};

export default function VoiceChatControls({ value, onChange, onValidate }: Props) {
  const [recording, setRecording] = useState(false);
  const [sttSupported, setSttSupported] = useState<boolean | null>(null);
  const [vumeterLevel, setVumeterLevel] = useState(0);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const userName = useUserNameFromBlocks();

  // === TTS (même voix que l'interview) ===
  const [ttsOn, setTtsOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return (localStorage.getItem("tts_on") ?? "1") !== "0";
  });
  const [ttsVoice, setTtsVoice] = useState<string>(() => {
    if (typeof window === "undefined") return "alloy";
    return localStorage.getItem("tts_voice") || "alloy";
  });
  const { speak: speakTTS, stop: stopTTS } = useBetterTTS("alloy");

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
    setSttSupported(Boolean(SpeechRecognition));

    // Sync initial TTS prefs (au cas où elles changent ailleurs)
    try {
      const on = localStorage.getItem("tts_on");
      if (on != null) setTtsOn(on !== "0");
      const v = localStorage.getItem("tts_voice");
      if (v) setTtsVoice(v);
    } catch {}

    return () => {
      stopRecording();
      try { stopTTS(); } catch {}
    };
  }, []);

  const playBeep = (freq = 800, durationMs = 120) => {
    try {
      const AC: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ac = new AC();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0;

      osc.connect(gain);
      gain.connect(ac.destination);

      const now = ac.currentTime;
      const dur = durationMs / 1000;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
      gain.gain.linearRampToValueAtTime(0, now + dur);

      osc.start(now);
      osc.stop(now + dur + 0.02);

      setTimeout(() => {
        try {
          ac.close();
        } catch {}
      }, durationMs + 50);
    } catch {}
  };

  const startAnalyser = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac = new AC();
    audioContextRef.current = ac;

    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const loop = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length) / 255;
      setVumeterLevel(rms);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopAnalyser = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    setVumeterLevel(0);
  };

  const startSTT = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
    if (!SpeechRecognition) {
      setSttSupported(false);
      return;
    }

    const rec = new SpeechRecognition();
    recognitionRef.current = rec;
    rec.lang = "fr-FR";
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let full = "";
      for (let i = 0; i < event.results.length; i++) {
        full += event.results[i][0].transcript;
      }
      onChange(full);
    };

    rec.onerror = (e: any) => {
      console.warn("STT error", e);
    };

    rec.start();
  };

  const stopSTT = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop?.();
      } catch {}
      recognitionRef.current = null;
    }
  };

  const speakWelcome = () => {
    const base = userName
      ? `Bonjour ${userName}. Je suis prête à écrire ton histoire.`
      : `Bonjour. Je suis prête à écrire ton histoire.`;

    // 1) Utilise la même voix TTS que l'interview (OpenAI), si activée
    if (ttsOn) {
      try {
        speakTTS(base, ttsVoice);
        return;
      } catch {}
    }

    // 2) Fallback navigateur (SpeechSynthesis)
    try {
      const utter = new SpeechSynthesisUtterance(base);
      utter.lang = "fr-FR";
      utter.pitch = 1.05;
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    } catch {}
  };

  const startRecording = async () => {
    playBeep(880);
    setRecording(true);
    onChange("");
    speakWelcome();
    await startAnalyser();
    if (sttSupported) startSTT();
  };

  const stopRecording = () => {
    playBeep(440);
    setRecording(false);
    stopSTT();
    stopAnalyser();
  };

  return (
    <div className="space-y-3 w-full">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={`px-3 py-2 border rounded text-sm ${
            recording ? "bg-red-100" : ""
          }`}
          onClick={() => {
            if (recording) stopRecording();
            else startRecording();
          }}
        >
          {recording ? "Arrêter" : "Démarrer le dialogue"}
        </button>

        <button
          className="px-3 py-2 border rounded text-sm"
          onClick={() => {
            stopRecording();
            onChange("");
          }}
        >
          Effacer brouillon
        </button>

        <button
          className="px-3 py-2 border rounded text-sm"
          onClick={() => {
            stopRecording();
            onValidate();
          }}
          disabled={!value.trim()}
        >
          Valider la transcription
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className={`h-3 w-40 rounded-full overflow-hidden border ${
            recording ? "border-red-300" : "border-gray-200"
          }`}
        >
          <div
            style={{
              width: `${Math.min(100, Math.round(vumeterLevel * 100))}%`,
              height: "100%",
              background: recording
                ? "linear-gradient(90deg,#f97316,#f43f5e)"
                : "linear-gradient(90deg,#d1d5db,#9ca3af)",
              transition: "width 120ms linear",
            }}
          />
        </div>
        <span
          className={`text-xs px-2 py-1 rounded ${
            recording ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {sttSupported === null
            ? "Vérification STT…"
            : sttSupported
            ? recording
              ? "Enregistrement en cours…"
              : "Prêt à enregistrer"
            : "STT non dispo"}
        </span>
      </div>

      <textarea
        className="w-full border rounded p-3 text-sm bg-white"
        rows={4}
        placeholder="Transcription (brouillon)…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
