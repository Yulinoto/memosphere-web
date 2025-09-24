"use client";

import { useState } from "react";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

type Props = {
  onPartial?: (t: string) => void;
  onFinal?: (t: string) => void;
  setStatus?: (s: string) => void;
  onFatal?: (reason: string) => void; // fallback auto
  onStart?: () => void;               // bips + vumètre
  onStop?: () => void;                // bips + vumètre
  buttonLabel?: string;               // libellé bouton
};

export default function DeepgramSTT({
  onPartial,
  onFinal,
  setStatus,
  onFatal,
  onStart,
  onStop,
  buttonLabel = "Voix pro (Deepgram)",
}: Props) {
  const [listening, setListening] = useState(false);

  async function start() {
    setStatus?.("Connexion à Deepgram…");

    let token: string | undefined;
    try {
      const res = await fetch("/api/dg-token");
      const json = await res.json();
      if (!res.ok || !json?.access_token) throw new Error("Token invalide");
      token = json.access_token;
    } catch (e: any) {
      setStatus?.("Erreur token Deepgram");
      onFatal?.("token");
      return;
    }

    let dg: any;
    try {
      dg = createClient({ accessToken: token });
    } catch {
      setStatus?.("Erreur client Deepgram");
      onFatal?.("client");
      return;
    }

    const conn = dg.listen.live({
      model: "nova-3",
      language: "fr",
      smart_format: true,
      interim_results: true,
      vad_events: true,
    });

    conn.on(LiveTranscriptionEvents.Open, async () => {
      setStatus?.("Deepgram connecté ✅");
      setListening(true);

      let stream: MediaStream | undefined;
      let rec: MediaRecorder | undefined;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        rec = new MediaRecorder(stream, { mimeType: mime });
        rec.ondataavailable = (e) => {
          if (e.data.size > 0 && conn.getReadyState() === WebSocket.OPEN) {
            conn.send(e.data);
          }
        };
        rec.start(250);
        onStart?.(); // démarre gadgets parent
      } catch {
        setStatus?.("Accès micro refusé / non dispo");
        onFatal?.("mic");
        try { conn.close(); } catch {}
        onStop?.();
        return;
      }

      conn.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const alt = data?.channel?.alternatives?.[0];
        const text = alt?.transcript || "";
        if (!text) return;
        if (data?.is_final) onFinal?.(text);
        else onPartial?.(text);
      });

      const cleanup = () => {
        setListening(false);
        try { rec && rec.state !== "inactive" && rec.stop(); } catch {}
        try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
        onStop?.(); // stop gadgets parent
      };

      conn.on(LiveTranscriptionEvents.Error, () => {
        setStatus?.("Erreur Deepgram");
        cleanup();
        onFatal?.("ws");
      });

      conn.on(LiveTranscriptionEvents.Close, () => {
        setStatus?.("Connexion fermée");
        cleanup();
      });
    });

    // timeout si la socket n’ouvre pas
    setTimeout(() => {
      if (!listening && typeof onFatal === "function") onFatal("timeout");
    }, 6000);
  }

  return (
    <button
      onClick={start}
      disabled={listening}
      className="px-4 py-2 rounded border bg-indigo-50 hover:bg-indigo-100"
    >
      {listening ? `${buttonLabel} — ON` : `${buttonLabel} — Démarrer`}
    </button>
  );
}
