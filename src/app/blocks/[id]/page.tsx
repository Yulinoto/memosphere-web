// src/app/blocks/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useBlocks } from "@/hooks/useBlocks";
import type { Entry } from "@/data/blocks";

/**
 * Page bloc :
 * - Saisie texte
 * - Mode voix : Web Speech (si dispo) + vumètre (WebAudio) + bips start/stop
 * - Résumé (proto)
 */

export default function BlockViewPage() {
  // Normalise l'id (string | string[] -> string | undefined)
  const rawParams = useParams() as Record<string, string | string[] | undefined>;
  const id = Array.isArray(rawParams.id) ? rawParams.id?.[0] : rawParams.id;

  const router = useRouter();
  const { loading, blocks, addTextEntry, setSummary } = useBlocks();

  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");

  // STT (Web Speech) support & state
  const [sttSupported, setSttSupported] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState("");

  // WebAudio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Web Speech ref
  const recognitionRef = useRef<any | null>(null);

  // Vumètre (0..1)
  const [vumeterLevel, setVumeterLevel] = useState(0);

  // Sélection du bloc courant
  const block = useMemo(() => {
    if (!blocks || !id) return null;
    return blocks[id] ?? null;
  }, [blocks, id]);

  /* ---------------------------
     Helpers déclarés AVANT useEffect (pour éviter ReferenceError)
     --------------------------- */

  function stopSpeechRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop?.();
      } catch {}
      recognitionRef.current = null;
    }
  }

  function stopAnalyser() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
  }

  /* ---------------------------
     useEffect init + cleanup
     --------------------------- */
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
    setSttSupported(Boolean(SpeechRecognition));
    return () => {
      // Ces fonctions sont maintenant déjà définies → plus de ReferenceError
      stopAnalyser();
      stopSpeechRecognition();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Garde navigation
  useEffect(() => {
    if (!id) router.replace("/blocks");
  }, [id, router]);

  useEffect(() => {
    if (!id) return;
    if (!loading && blocks && !block) router.replace("/blocks");
  }, [loading, blocks, block, id, router]);

  if (!id) return <div className="p-6">Chargement…</div>;
  if (loading || !blocks) return <div className="p-6">Chargement…</div>;
  if (!block) return <div className="p-6">Chargement…</div>;

  const nextQ =
    block.pinnedQuestions?.[
      block.entries.length % (block.pinnedQuestions?.length || 1)
    ] || "Raconte-moi un souvenir lié à ce thème.";

  /* ---------------------------
     Saisie texte
     --------------------------- */
  const handleAddText = async () => {
    if (!answer.trim()) return;
    await addTextEntry(block.id, nextQ, answer.trim());
    setAnswer("");
  };

  /* ---------------------------
     WebAudio : démarrer l'analyseur (vumètre)
     (avec Uint8Array<ArrayBuffer> pour TS récent)
     --------------------------- */
  const startAnalyser = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn("getUserMedia non supporté");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AC: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ac = audioContextRef.current ?? new AC();
      audioContextRef.current = ac;

      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;

      // Uint8Array typé explicitement sur ArrayBuffer
      const bufferLength = analyser.frequencyBinCount;
      const dataArray: Uint8Array<ArrayBuffer> = new Uint8Array(bufferLength);

      const loop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // RMS-ish level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i];
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length) / 255; // 0..1
        setVumeterLevel(rms);

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      console.error("Microphone permission denied or error", err);
    }
  };

  /* ---------------------------
     Beeps start/stop (WebAudio)
     --------------------------- */
  const playBeep = (opts?: { freq?: number; durationMs?: number }) => {
    try {
      const AC: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ac = new AC();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = opts?.freq ?? 880;
      gain.gain.value = 0;

      osc.connect(gain);
      gain.connect(ac.destination);

      const now = ac.currentTime;
      const dur = (opts?.durationMs ?? 120) / 1000;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
      gain.gain.linearRampToValueAtTime(0, now + dur);

      osc.start(now);
      osc.stop(now + dur + 0.02);

      setTimeout(() => {
        try {
          ac.close();
        } catch {}
      }, (opts?.durationMs ?? 120) + 50);
    } catch {
      /* ignore */
    }
  };

  /* ---------------------------
     Web Speech (STT simple si dispo)
     --------------------------- */
  const startSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
    if (!SpeechRecognition) {
      setSttSupported(false);
      return;
    }
    stopSpeechRecognition(); // fresh

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
      setDraft(full);
    };

    rec.onerror = (ev: any) => {
      console.error("SpeechRecognition error", ev);
    };

    try {
      rec.start();
    } catch (err) {
      console.error("Could not start SpeechRecognition", err);
    }
  };

  /* ---------------------------
     Contrôles enregistrement (mode voix)
     --------------------------- */
  const startRecording = async () => {
    playBeep({ freq: 900, durationMs: 120 });
    setDraft("");
    setRecording(true);
    await startAnalyser();
    if (sttSupported) {
      startSpeechRecognition();
    }
  };

  const stopRecording = () => {
    playBeep({ freq: 440, durationMs: 120 });
    setRecording(false);
    stopAnalyser();
    stopSpeechRecognition();
  };

  const handleValidateVoice = async () => {
    const text = (draft || "").trim();
    if (!text) {
      alert("Aucune transcription détectée. Parle plus fort ou utilise la saisie texte.");
      return;
    }
    await addTextEntry(block.id, nextQ, text);
    setDraft("");
    setMode("text");
  };

  /* ---------------------------
     Résumé (proto)
     --------------------------- */
  const handleSummarize = async () => {
    const parts: string[] = block.entries
      .filter((e: Entry) => e.type === "texte")
      .map((e: Entry) => ("a" in e ? (e.a as string) : ""))
      .map((s) => s.trim())
      .filter(Boolean);

    const summary =
      parts.length > 0 ? parts.join("\n\n") : "Aucun contenu textuel pour le moment.";
    await setSummary(block.id, summary);
  };

  /* ---------------------------
     UI
     --------------------------- */
  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <button className="text-sm text-gray-500" onClick={() => router.push("/blocks")}>
        ← Retour
      </button>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{block.title}</h1>
        <div className="text-xs text-gray-500">
          {block.progress}% • {block.entries.length} entrée(s)
        </div>
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700">
            <span className="font-medium">Question :</span> {nextQ}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <button
              className={`px-2 py-1 border rounded ${mode === "text" ? "bg-gray-100" : ""}`}
              onClick={() => setMode("text")}
            >
              Saisie
            </button>
            <button
              className={`px-2 py-1 border rounded ${mode === "voice" ? "bg-gray-100" : ""}`}
              onClick={() => setMode("voice")}
            >
              Voix
            </button>
          </div>
        </div>

        {mode === "text" && (
          <>
            <textarea
              className="w-full border rounded p-3 text-sm"
              rows={4}
              placeholder="Réponds ici…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="px-3 py-2 border rounded hover:bg-gray-50" onClick={handleAddText}>
                Ajouter la réponse
              </button>
              <button className="px-3 py-2 border rounded hover:bg-gray-50" onClick={handleSummarize}>
                Résumé (proto)
              </button>
            </div>
          </>
        )}

        {mode === "voice" && (
          <>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  className={`px-3 py-2 border rounded ${recording ? "bg-red-100" : ""}`}
                  onClick={() => {
                    if (!recording) startRecording();
                    else stopRecording();
                  }}
                >
                  {recording ? "Arrêter" : "Démarrer l'enregistrement"}
                </button>

                <button
                  className="px-3 py-2 border rounded"
                  onClick={() => {
                    setDraft("");
                    stopRecording();
                  }}
                >
                  Effacer brouillon
                </button>

                <button className="px-3 py-2 border rounded" onClick={handleValidateVoice}>
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
                    ? "Vérification transcription…"
                    : sttSupported
                    ? recording
                      ? "Enregistrement — transcription en cours…"
                      : "Prêt. Clique Démarrer."
                    : "Transcription non dispo (Chrome/Edge recommandé)."}
                </span>
              </div>

              <textarea
                className="w-full border rounded p-3 text-sm bg-gray-50"
                rows={4}
                placeholder="Transcription (brouillon)…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
          </>
        )}
      </section>

      {block.summary && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Résumé</h2>
          <p className="text-sm whitespace-pre-wrap border rounded p-3 bg-white">
            {block.summary}
          </p>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Contenu</h2>
        <ul className="space-y-2">
          {block.entries.map((e, i) => (
            <li key={i} className="border rounded p-3 bg-white">
              <div className="text-xs text-gray-500 mb-1">[{new Date(e.ts).toLocaleString()}]</div>
              {"q" in e && (
                <div className="text-sm">
                  <span className="font-medium">Q:</span> {e.q}
                </div>
              )}
              {"a" in e && (
                <div className="text-sm">
                  <span className="font-medium">A:</span> {e.a}
                </div>
              )}
              {e.type === "photo" && (
                <div className="text-sm">
                  <span className="font-medium">Photo:</span> {e.url}
                  {e.caption ? ` — ${e.caption}` : ""}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
