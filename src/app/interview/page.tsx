// src/app/interview/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import localforage from "localforage";

type Clip = {
  id: string;
  name: string;
  blobUrl: string;
  size: number;
  createdAt: number;
};

export default function InterviewPage() {
  const [micAllowed, setMicAllowed] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0); // secondes
  const [clips, setClips] = useState<Clip[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // configure localforage
  useEffect(() => {
    localforage.config({
      name: "memosphere",
      storeName: "audio_clips",
    });
    loadClipsFromStorage();
  }, []);

  // demande permission micro
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        setMicAllowed(true);
      } catch {
        setMicAllowed(false);
      }
    })();
    return () => {
      // cleanup
      timerRef.current && window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const loadClipsFromStorage = async () => {
    try {
      const keys = await localforage.keys();
      const loaded: Clip[] = [];
      for (const key of keys) {
        const blob = await localforage.getItem<Blob>(key);
        if (blob) {
          const b = blob as Blob;
          const id = key;
          loaded.push({
            id,
            name: `clip-${new Date(parseInt(id, 10)).toLocaleString()}`,
            blobUrl: URL.createObjectURL(b),
            size: b.size,
            createdAt: parseInt(id, 10),
          });
        }
      }
      // trier par date décroissante
      loaded.sort((a, b) => b.createdAt - a.createdAt);
      setClips(loaded);
    } catch (e) {
      console.error("Erreur chargement clips", e);
    }
  };

  const startTimer = () => {
    setDuration(0);
    timerRef.current = window.setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const options: MediaRecorderOptions = { mimeType: "audio/webm" };
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(streamRef.current, options);
    } catch {
      // fallback sans options
      mr = new MediaRecorder(streamRef.current);
    }
    recorderRef.current = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const id = Date.now().toString();
      await localforage.setItem(id, blob);
      const clip: Clip = {
        id,
        name: `clip-${new Date(parseInt(id, 10)).toLocaleString()}`,
        blobUrl: URL.createObjectURL(blob),
        size: blob.size,
        createdAt: parseInt(id, 10),
      };
      setClips((c) => [clip, ...c]);
      setDuration(0);
      stopTimer();
    };
    mr.start();
    setIsRecording(true);
    startTimer();
  };

  const stopRecording = () => {
    if (!recorderRef.current) return;
    recorderRef.current.stop();
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const deleteClip = async (id: string) => {
    await localforage.removeItem(id);
    setClips((c) => c.filter((x) => x.id !== id));
  };

  const clearAll = async () => {
    await localforage.clear();
    // revoke blob URLs
    clips.forEach((c) => URL.revokeObjectURL(c.blobUrl));
    setClips([]);
  };

  return (
    <main className="min-h-dvh p-6 grid place-items-center">
      <div className="w-full max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold">Interview</h1>

        {micAllowed === null && <div className="p-3 rounded-lg border">Vérification du micro…</div>}
        {micAllowed === false && (
          <div className="p-3 rounded-lg border bg-red-50">Accès micro refusé. Autorise le micro.</div>
        )}
        {micAllowed === true && <div className="p-3 rounded-lg border bg-green-50">Micro autorisé ✔</div>}

        <div className="flex items-center gap-4">
          <button
            onClick={toggleRecording}
            disabled={!micAllowed}
            className={`rounded-xl px-6 py-3 border transition ${
              isRecording ? "bg-red-100" : "bg-white hover:bg-gray-50"
            }`}
          >
            {isRecording ? `Enregistrement… ${duration}s (cliquer pour arrêter)` : "Enregistrer un clip"}
          </button>

          <button
            onClick={clearAll}
            className="rounded-xl px-4 py-2 border text-sm hover:bg-gray-50"
            title="Supprime tous les clips locaux"
          >
            Supprimer tout
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Clips enregistrés (local)</div>
          <div className="space-y-3">
            {clips.length === 0 && <div className="text-gray-500">— Aucun clip —</div>}
            {clips.map((c) => (
              <div key={c.id} className="flex items-center justify-between border rounded-lg p-2 bg-white">
                <div className="flex items-center gap-3">
                  <audio controls src={c.blobUrl} />
                  <div className="text-sm">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-gray-500">{(c.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      // forcer lecture via JS si besoin
                      const aud = document.querySelector(`audio[src="${c.blobUrl}"]`) as HTMLAudioElement | null;
                      aud?.play();
                    }}
                    className="px-3 py-1 border rounded"
                  >
                    Play
                  </button>
                  <button onClick={() => deleteClip(c.id)} className="px-3 py-1 border rounded">
                    Suppr
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-sm text-gray-500">
          Les clips sont stockés localement (IndexedDB). Tu peux les exporter ou les synchroniser vers le cloud plus
          tard.
        </div>
      </div>
    </main>
  );
}
