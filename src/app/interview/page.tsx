// src/app/interview/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBlocks } from "@/hooks/useBlocks";
import type { Entry } from "@/data/blocks";
import { useBetterTTS } from "@/hooks/useBetterTTS";
import DeepgramSTT from "./DeepgramSTT";
import LiveSTT from "./LiveSTT";

type Mode = "voice" | "text";
type MsgRole = "assistant" | "user" | "draft";
type Message = { role: MsgRole; text: string; ts: number; key?: string };

type PendingPayload = {
  text: string;
  blockId?: string;
  question?: string;
};

export default function InterviewPage() {
  const router = useRouter();
  const { loading, blocks, appendNarrative } = useBlocks();

  // ===== Sélecteur bloc (mode libre) =====
  const items = useMemo(() => (blocks ? Object.values(blocks) : []), [blocks]);
  const [selectedId, setSelectedId] = useState<string>("");

  // ===== Parcours guidé =====
  const DEFAULT_ORDER = [
    "identite",
    "enfance",
    "adolescence",
    "debuts_adultes",
    "metier",
    "valeurs",
    "anecdotes",
    "lieux",
    "heritage",
  ] as const;
  const [guided, setGuided] = useState(false);
  const [scriptOrder, setScriptOrder] = useState<string[]>(
    DEFAULT_ORDER.filter((id) => !!blocks?.[id])
  );
  const [gIndex, setGIndex] = useState(0); // bloc
  const [qIndex, setQIndex] = useState(0); // question dans le bloc

  // ===== Bloc actif =====
  const guidedBlockId = guided ? scriptOrder[gIndex] : null;
  const activeBlock = useMemo(() => {
    if (guided) return guidedBlockId ? blocks?.[guidedBlockId] ?? null : null;
    if (!selectedId || !blocks) return null;
    return blocks[selectedId] ?? null;
  }, [guided, guidedBlockId, selectedId, blocks]);

  // ===== Mode (Voix / Texte) =====
  const [mode, setMode] = useState<Mode>("voice");

  // ===== TTS amélioré (OpenAI) =====
  const [voice, setVoice] = useState("alloy");
  const { speak: betterSpeak } = useBetterTTS(voice);
  const [ttsOn, setTtsOn] = useState(true);

  // Charger préférences TTS
  useEffect(() => {
    const v = localStorage.getItem("tts_on");
    if (v === "0") setTtsOn(false);
    const storedVoice = localStorage.getItem("tts_voice");
    if (storedVoice) setVoice(storedVoice);
  }, []);
  // Sauvegarde préférences TTS
  useEffect(() => {
    localStorage.setItem("tts_on", ttsOn ? "1" : "0");
  }, [ttsOn]);
  useEffect(() => {
    localStorage.setItem("tts_voice", voice);
  }, [voice]);

  // ===== STT moteur =====
  const [usePro, setUsePro] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("stt_mode");
    if (saved === "browser") setUsePro(false);
  }, []);
  useEffect(() => {
    localStorage.setItem("stt_mode", usePro ? "pro" : "browser");
  }, [usePro]);

  // ===== Opt-in correction IA =====
  const [aiOptIn, setAiOptIn] = useState(true);
  useEffect(() => {
    const v = localStorage.getItem("ai_optin");
    setAiOptIn(v !== "0");
  }, []);
  useEffect(() => {
    localStorage.setItem("ai_optin", aiOptIn ? "1" : "0");
  }, [aiOptIn]);

  // ===== Index par bloc (mode libre) =====
  const [freeQIndexByBlock, setFreeQIndexByBlock] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!guided && selectedId) {
      setFreeQIndexByBlock((prev) => (prev[selectedId] ??= 0, { ...prev }));
    }
  }, [guided, selectedId]);

  // ===== Helpers bloc/question =====
  function getActiveBlockId(): string {
    if (guided) return guidedBlockId ?? scriptOrder[gIndex] ?? "";
    return selectedId || "";
  }
  const blkIdReady = Boolean(activeBlock && getActiveBlockId());

  const nextQuestion = useMemo(() => {
    const p = activeBlock?.pinnedQuestions ?? [];
    if (!p.length) return "Raconte-moi un souvenir lié à ce thème.";
    if (guided) return p[qIndex % p.length];
    const blkId = getActiveBlockId();
    const freeIdx = freeQIndexByBlock[blkId] ?? 0;
    return p[freeIdx % p.length];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeBlock?.id,
    activeBlock?.pinnedQuestions?.length,
    guided,
    qIndex,
    selectedId,
    freeQIndexByBlock,
  ]);

  // ===== Refs =====
  const blocksRef = useRef(blocks);
  const questionRef = useRef(nextQuestion);
  const blockIdRef = useRef<string>(getActiveBlockId());
  const guidedRef = useRef(guided);
  const gIndexRef = useRef(gIndex);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { questionRef.current = nextQuestion; }, [nextQuestion]);
  useEffect(() => { blockIdRef.current = getActiveBlockId(); }, [guided, guidedBlockId, selectedId, activeBlock?.id]);
  useEffect(() => { guidedRef.current = guided; }, [guided]);
  useEffect(() => { gIndexRef.current = gIndex; }, [gIndex]);

  // ===== Fil de conversation =====
  const [messages, setMessages] = useState<Message[]>([]);

  // Injecte la question quand elle change (pas de dépendance sur messages pour éviter les doublons)
  useEffect(() => {
    if (guided) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.text === nextQuestion) return prev;
      return [...prev, { role: "assistant", text: nextQuestion, ts: Date.now() }];
    });
    if (ttsOn) betterSpeak(nextQuestion);
  }

  // 👉 En MODE LIBRE (GPT) : ne RIEN injecter ici (voir patch #2)
  // On laisse GPT proposer la question via commitAnswer ou seedFirstQuestion()

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [blkIdReady, guided, activeBlock?.id, nextQuestion, ttsOn, betterSpeak]);
// 🆕 Seed de la 1re question GPT en MODE LIBRE
useEffect(() => {
  if (!blkIdReady || guided) return;
  // si une question assistant existe déjà, on ne seed pas
  if (messages.some((m) => m.role === "assistant")) return;

  (async () => {
    try {
      const blkId = getActiveBlockId();
      const res = await fetch("/api/llm/nextQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: blkId, lastAnswer: "" }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("seed nextQuestion HTTP", res.status, txt.slice(0, 180));
        return;
      }

      const ct = res.headers.get("content-type") || "";
      const json = ct.includes("application/json") ? await res.json() : {};
      const q = json?.question || activeBlock?.pinnedQuestions?.[0] || "Raconte-moi un souvenir lié à ce thème.";

      setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
      if (ttsOn) betterSpeak(q);
    } catch (e) {
      console.error("seed nextQuestion error:", e);
    }
  })();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [blkIdReady, guided, selectedId, activeBlock?.id]);

  // ===== Correction IA =====
  async function reformulate(text: string, blockId?: string) {
    const clean = text.trim();
    if (!clean) return "";
    if (!aiOptIn) return clean;
    if (clean.replace(/\s+/g, " ").length < 10) return clean;
    try {
      const res = await fetch("/api/llm/rephrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
          blockId,
          lang: "fr",
          maxSentences: 4,
          style: "journal",
          removeFillers: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && typeof json.text === "string") {
        return String(json.text).trim() || clean;
      }
      return clean;
    } catch {
      return clean;
    }
  }

  // ===== Transcription =====
  const [livePartial, setLivePartial] = useState("");
  const [lastFinalRaw, setLastFinalRaw] = useState("");
  const [lastSavedText, setLastSavedText] = useState("");

  const sttCtxRef = useRef<{ blockId?: string; question?: string } | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<PendingPayload | null>(null);

  // Si une finale arrive avant que le bloc soit prêt → rejoue l’envoi
  useEffect(() => {
    const blkId = getActiveBlockId();
    if (pendingAnswer && (pendingAnswer.blockId || blkId)) {
      (async () => {
        const toSend = pendingAnswer;
        setPendingAnswer(null);
        await commitAnswer(toSend.text, {
          blockId: toSend.blockId || blkId,
          question: toSend.question || questionRef.current,
        });
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlock?.id, guided, selectedId, gIndex, qIndex, pendingAnswer]);

  // ===== Envoi réponse =====
  async function commitAnswer(raw: string, ctx?: { blockId?: string; question?: string }) {
    const base = raw.trim();
    if (!base) return;

    const blkId = ctx?.blockId || blockIdRef.current;
    const qRaw = ctx?.question || questionRef.current;

    if (!blkId || !blocksRef.current?.[blkId]) {
      setPendingAnswer({ text: base, blockId: blkId, question: qRaw });
      return;
    }

    // bulle utilisateur (brute)
    setMessages((prev) => [...prev, { role: "user", text: base, ts: Date.now() }]);
    setLastFinalRaw(base);

    // correction
    const corrected = await reformulate(base, blkId);
    setLastSavedText(corrected);

    // enregistrement narratif + compat Q/R
    try {
      await appendNarrative(blkId, corrected, { q: qRaw });
    } catch (e) {
      console.error("Échec appendNarrative:", e);
    }

    // === GPT: prochaine question naturelle ===
    try {
      const res = await fetch("/api/llm/nextQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: blkId, lastAnswer: corrected }),
      });
      const json = await res.json();
      if (json?.ok && json.question) {
        // on utilise cette question comme prochaine référence
        questionRef.current = json.question; // pour historiser la bonne Q
        setMessages((prev) => [...prev, { role: "assistant", text: json.question, ts: Date.now() }]);
        if (ttsOn) betterSpeak(json.question);
        return;
      }
    } catch (e) {
      console.error("Erreur nextQuestion:", e);
    }

    // === Fallback: pinnedQuestions (mode libre) ou progression guidée ===
    if (guidedRef.current) {
      const b = blocksRef.current?.[blkId];
      const p = b?.pinnedQuestions ?? [];
      const pqLen = Math.max(1, p.length || 1);
      const nextQi = qIndex + 1;
      if (nextQi < pqLen) {
        setQIndex(nextQi);
      } else {
        if (gIndexRef.current + 1 < scriptOrder.length) {
          setGIndex(gIndexRef.current + 1);
          setQIndex(0);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: "Merci, l’interview est terminée ✅", ts: Date.now() },
          ]);
          setGuided(false);
        }
      }
    } else {
      const p = (blocksRef.current?.[blkId]?.pinnedQuestions ?? []);
      if (p.length) {
        setFreeQIndexByBlock((prev) => {
          const cur = prev[blkId] ?? 0;
          return { ...prev, [blkId]: (cur + 1) % p.length };
        });
      }
    }
  }

  // ===== Draft clavier =====
  const [draft, setDraft] = useState("");

  // ===== STT UI =====
  const [status, setStatus] = useState("");

  const handlePartial = (t: string) => {
    const clean = t.trim();
    setLivePartial(clean);
    if (!clean) return;
    const key = "draft-singleton";
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.key === key);
      const msg: Message = { role: "draft", text: clean, ts: Date.now(), key };
      if (idx === -1) return [...prev, msg];
      const newArr = prev.slice();
      newArr[idx] = msg;
      return newArr;
    });
  };

  const handleFinal = async (t: string) => {
    const clean = t.trim();
    // retire la bulle draft
    setMessages((prev) => prev.filter((m) => m.key !== "draft-singleton"));
    if (!clean) { setLivePartial(""); return; }
    await commitAnswer(clean, sttCtxRef.current || undefined);
    setLivePartial("");
  };

  if (loading || !blocks) return <div className="p-6">Chargement…</div>;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Interview</h1>
        <button className="text-sm text-gray-500" onClick={() => router.push("/blocks")}>
          ← Voir les blocs
        </button>
      </header>

      {/* Contrôles haut */}
      <section className="space-y-2 border rounded-xl p-4 bg-white">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {/* Mode */}
            <button
              onClick={() => setMode("voice")}
              className={`px-3 py-2 border rounded text-sm ${mode === "voice" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            >
              Voix
            </button>
            <button
              onClick={() => setMode("text")}
              className={`px-3 py-2 border rounded text-sm ${mode === "text" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            >
              Texte
            </button>

            {/* Guidé */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={guided}
                onChange={(e) => {
                  const on = e.target.checked;
                  setGuided(on);
                  setMessages([]);
                  if (on) {
                    setSelectedId("");
                    setScriptOrder(DEFAULT_ORDER.filter((id) => !!blocks?.[id]));
                    setGIndex(0);
                    setQIndex(0);
                  }
                }}
              />
              Parcours guidé
            </label>

            {/* Contexte guidé */}
            {guided ? (
              <div className="text-xs text-gray-600">
                Bloc&nbsp;
                <span className="font-medium">
                  {guidedBlockId ? blocks?.[guidedBlockId]?.title || guidedBlockId : "—"}
                </span>
                &nbsp;• Q {qIndex + 1}/{Math.max(1, (activeBlock?.pinnedQuestions?.length ?? 1))}
              </div>
            ) : (
              <div className="text-xs text-gray-500">Mode libre</div>
            )}
          </div>

          {/* TTS + IA */}
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ttsOn} onChange={(e) => setTtsOn(e.target.checked)} />
              Lecture vocale
            </label>
            <select
              className="border rounded p-1 text-xs"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              title="Choisir la voix"
            >
              <option value="alloy">Alloy</option>
              <option value="verse">Verse</option>
              <option value="shimmer">Shimmer</option>
              <option value="sage">Sage</option>
            </select>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={aiOptIn} onChange={(e) => setAiOptIn(e.target.checked)} />
              Correction IA
            </label>
          </div>
        </div>

        {/* Sélecteur bloc (mode libre) */}
        {!guided && (
          <div className="flex items-end gap-3 pt-2">
            <div className="grow">
              <label className="text-sm font-medium">Bloc</label>
              <select
                className="w-full border rounded p-2 text-sm"
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setMessages([]); }}
              >
                {items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} — {b.entries.length} entrées ({b.progress}%)
                  </option>
                ))}
              </select>
            </div>

            {/* STT moteur */}
            {mode === "voice" && (
              <label className="text-xs text-gray-600 flex items-center gap-2">
                <input type="checkbox" checked={usePro} onChange={(e) => setUsePro(e.target.checked)} />
                STT Deepgram (pro)
              </label>
            )}
            {mode === "voice" && <span className="text-xs text-gray-500">{status || "—"}</span>}
          </div>
        )}
      </section>

      {/* Fil de chat */}
      <section className="border rounded-xl p-3 bg-white space-y-2" style={{ minHeight: 360 }}>
        {messages.map((m, i) => (
          <div key={m.key ?? i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow ${
                m.role === "assistant" ? "bg-indigo-50 text-indigo-900"
                : m.role === "draft" ? "bg-yellow-50 text-yellow-900"
                : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </section>

      {/* Entrées */}
      <section className="flex flex-col gap-3">
        {mode === "voice" && (
          <div className="flex items-center gap-2">
            {usePro ? (
              <DeepgramSTT
                onPartial={handlePartial}
                onFinal={handleFinal}
                setStatus={setStatus}
                onStart={() => {
                  // capture le contexte au début de la prise de parole
                  sttCtxRef.current = {
                    blockId: getActiveBlockId(),
                    question: questionRef.current,
                  };
                }}
                onStop={() => { /* on conserve le contexte pour handleFinal */ }}
                buttonLabel="Parler (Deepgram)"
              />
            ) : (
              <LiveSTT
                onPartial={handlePartial}
                onFinal={handleFinal}
                setStatus={setStatus}
                onStart={() => {
                  sttCtxRef.current = {
                    blockId: getActiveBlockId(),
                    question: questionRef.current,
                  };
                }}
                onStop={() => {}}
                buttonLabel="Parler (navigateur)"
              />
            )}
            <span className="text-xs text-gray-500">
              {blkIdReady
                ? "Parle, je t’affiche en jaune. À l’arrêt, j’envoie après correction."
                : "Choisis un bloc ou active le parcours guidé."}
            </span>
          </div>
        )}

        {mode === "text" && (
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded p-2 text-sm"
              placeholder="Écris ta réponse…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  commitAnswer(text, {
                    blockId: getActiveBlockId(),
                    question: questionRef.current,
                  });
                  setDraft("");
                }
              }}
            />
            <button
              onClick={() => {
                const text = draft.trim();
                if (!text) return;
                commitAnswer(text, {
                  blockId: getActiveBlockId(),
                  question: questionRef.current,
                });
                setDraft("");
              }}
              className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
            >
              Envoyer
            </button>
          </div>
        )}
      </section>

      {/* Transcription */}
      <section className="space-y-2 border rounded-xl p-4 bg-white">
        <div className="text-xs uppercase tracking-wide text-gray-500">Transcription récente</div>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="border rounded p-3 bg-gray-50">
            <div className="text-xs text-gray-500 mb-1">En direct</div>
            <div className="whitespace-pre-wrap min-h-[2.5rem]">
              {livePartial || <em className="text-gray-400">— silence —</em>}
            </div>
          </div>
          <div className="border rounded p-3 bg-gray-50">
            <div className="text-xs text-gray-500 mb-1">Dernière finale (brute)</div>
            <div className="whitespace-pre-wrap min-h-[2.5rem]">
              {lastFinalRaw || <em className="text-gray-400">—</em>}
            </div>
          </div>
          <div className="border rounded p-3 bg-gray-50">
            <div className="text-xs text-gray-500 mb-1">Enregistré (corrigé)</div>
            <div className="whitespace-pre-wrap min-h-[2.5rem]">
              {lastSavedText || <em className="text-gray-400">—</em>}
            </div>
          </div>
        </div>
      </section>

      {/* Mémoire narrative */}
      {activeBlock && (
        <section className="space-y-2 border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Mémoire — {activeBlock.title}
          </div>
          <div className="whitespace-pre-wrap text-sm bg-gray-50 border rounded p-3 min-h-[120px]">
            {(activeBlock.content ?? "").trim() || <em className="text-gray-400">— vide —</em>}
          </div>
        </section>
      )}

      {/* Historique Q/R (héritage — optionnel) */}
      {activeBlock && activeBlock.entries.length > 0 && (
        <section className="space-y-2 border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Anciennes entrées — {activeBlock.title}
          </div>
          <ul className="space-y-2">
            {activeBlock.entries
              .slice()
              .reverse()
              .slice(0, 5)
              .map((e: Entry, i: number) => {
                if (e.type === "texte" || e.type === "audio") {
                  return (
                    <li key={i} className="border rounded p-3 bg-white">
                      <div className="text-sm">
                        <span className="font-medium">Q:&nbsp;</span>
                        {e.q}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">A:&nbsp;</span>
                        {e.a}
                      </div>
                      {e.type === "audio" && (e as any).audioUrl && (
                        <div className="mt-2">
                          <audio controls src={(e as any).audioUrl} />
                        </div>
                      )}
                    </li>
                  );
                }
                if (e.type === "photo") {
                  return (
                    <li key={i} className="border rounded p-3 bg-white">
                      <div className="text-sm mb-2">
                        <span className="font-medium">Photo:&nbsp;</span>
                        {e.caption || "(sans légende)"}
                      </div>
                      <img
                        src={e.url}
                        alt={e.caption || "photo"}
                        className="max-h-48 rounded border"
                      />
                    </li>
                  );
                }
                return null;
              })}
          </ul>
        </section>
      )}
    </main>
  );
}
