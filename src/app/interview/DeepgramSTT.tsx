// src/app/interview/DeepgramSTT.tsx
"use client";

import { useState } from "react";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

type Props = {
  onPartial?: (t: string) => void;
  onFinal?: (t: string) => void;
  setStatus?: (s: string) => void;
};

export default function DeepgramSTT({ onPartial, onFinal, setStatus }: Props) {
  const [listening, setListening] = useState(false);

  async function start() {
    setStatus?.("Connexion à Deepgram…");

    // 1) Récupérer un token éphémère
    const res = await fetch("/api/dg-token");
    const json = await res.json();

    if (!res.ok) {
      console.log("Token error payload:", json);
      setStatus?.(`Erreur token (${json?.status || res.status})`);
      return;
    }
    if (!json?.access_token) {
      console.log("Token missing access_token:", json);
      setStatus?.("Token invalide (pas d'access_token)");
      return;
    }

    // 2) Créer le client avec l’ACCESS TOKEN (important : pas apiKey ici)
    const dg = createClient({ accessToken: json.access_token });

    // 3) Ouvrir la connexion live
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

      // Micro → MediaRecorder (webm/opus)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });

      rec.ondataavailable = (e) => {
        if (e.data.size > 0 && conn.getReadyState() === WebSocket.OPEN) {
          conn.send(e.data);
        }
      };

      rec.start(250); // ~4 paquets/s

      // Transcripts
      conn.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const alt = data?.channel?.alternatives?.[0];
        const text = alt?.transcript || "";
        if (!text) return;
        if (data?.is_final) onFinal?.(text);
        else onPartial?.(text);
      });

      conn.on(LiveTranscriptionEvents.Error, (e) => {
        console.log("DG error:", e);
        setStatus?.("Erreur Deepgram");
      });

      conn.on(LiveTranscriptionEvents.Close, () => {
        setStatus?.("Connexion fermée");
        setListening(false);
        try { rec.state !== "inactive" && rec.stop(); } catch {}
        stream.getTracks().forEach((t) => t.stop());
      });
    });
  }

  return (
    <button
      onClick={start}
      disabled={listening}
      className="px-4 py-2 rounded border bg-indigo-50 hover:bg-indigo-100"
    >
      {listening ? "Deepgram ON 🎤" : "Activer transcription pro"}
    </button>
  );
}
