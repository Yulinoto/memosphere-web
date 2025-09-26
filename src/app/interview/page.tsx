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
  const [gIndex, setGIndex] = useState(0);
  const [qIndex, setQIndex] = useState(0);

  // ===== Bloc actif =====
  const guidedBlockId = guided ? scriptOrder[gIndex] : null;
  const activeBlock = useMemo(() => {
    if (guided) return guidedBlockId ? blocks?.[guidedBlockId] ?? null : null;
    if (!selectedId || !blocks) return null;
    return blocks[selectedId] ?? null;
  }, [guided, guidedBlockId, selectedId, blocks]);

  // ===== Mode (Voix / Texte) =====
  const [mode, setMode] = useState<Mode>("voice");

  // ===== TTS (OpenAI) =====
  const [voice, setVoice] = useState("alloy");
  const { speak: betterSpeak, stop: stopTTS } = useBetterTTS(voice);
  const [ttsOn, setTtsOn] = useState(true);

  useEffect(() => {
    const v = localStorage.getItem("tts_on");
    if (v === "0") setTtsOn(false);
    const storedVoice = localStorage.getItem("tts_voice");
    if (storedVoice) setVoice(storedVoice);
  }, []);
  useEffect(() => {
    localStorage.setItem("tts_on", ttsOn ? "1" : "0");
    if (!ttsOn) stopTTS();
  }, [ttsOn, stopTTS]);
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

  // ===== STT mains libres (navigateur) =====
  const [autoSTT, setAutoSTT] = useState(false);
  useEffect(() => {
    const v = localStorage.getItem("auto_stt");
    if (v === "1") setAutoSTT(true);
  }, []);
  useEffect(() => {
    localStorage.setItem("auto_stt", autoSTT ? "1" : "0");
  }, [autoSTT]);

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

  // pré-sélection du 1er bloc si rien en session
  useEffect(() => {
    if (!loading && !guided && !selectedId && items.length) {
      setSelectedId(items[0].id);
    }
  }, [loading, guided, selectedId, items]);

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

  // ===== Mémoire session =====
  useEffect(() => {
    if (loading || !blocks) return;
    const raw = localStorage.getItem("ms_session");
    if (!raw) return;

    try {
      const s = JSON.parse(raw);
      const validSelected = s?.selectedId && blocks[s.selectedId] ? s.selectedId : "";
      const validGuided = !!s?.guided;

      setMode(s?.mode === "text" ? "text" : "voice");
      setGuided(validGuided);

      if (validGuided) {
        const order = DEFAULT_ORDER.filter((id) => !!blocks[id]);
        setScriptOrder(order);
        setGIndex(Math.max(0, Math.min(Number(s?.gIndex ?? 0), order.length - 1)));
        setQIndex(Math.max(0, Number(s?.qIndex ?? 0)));
        setSelectedId("");
      } else {
        setSelectedId(validSelected || Object.values(blocks)[0]?.id || "");
      }
    } catch {}
  }, [loading, blocks]);

  useEffect(() => {
    const snapshot = { mode, guided, selectedId, gIndex, qIndex, ts: Date.now() };
    localStorage.setItem("ms_session", JSON.stringify(snapshot));
  }, [mode, guided, selectedId, gIndex, qIndex]);

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

  // ---- Injection questions ----
  const readyForQuestion = Boolean(activeBlock && nextQuestion);
  const lastQuestionRef = useRef<string>("");

  // 1) MODE GUIDÉ : injecte pinned question à chaque changement
  useEffect(() => {
    if (!readyForQuestion || !guided) return;

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.text === nextQuestion) return prev;
      return [...prev, { role: "assistant", text: nextQuestion, ts: Date.now() }];
    });
    if (ttsOn) betterSpeak(nextQuestion);
    lastQuestionRef.current = nextQuestion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyForQuestion, guided, activeBlock?.id, nextQuestion, ttsOn, betterSpeak]);

  // 2) MODE LIBRE : seed 1re question GPT
  useEffect(() => {
    if (!readyForQuestion || guided) return;
    if (messages.some((m) => m.role === "assistant")) return;

    (async () => {
      try {
        const blkId = getActiveBlockId();
        const res = await fetch("/api/llm/nextQuestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blockId: blkId, lastAnswer: "" }),
        });
        let q = nextQuestion;
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          const json = ct.includes("application/json") ? await res.json() : {};
          q = json?.question || nextQuestion;
        }
        setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
        if (ttsOn) betterSpeak(q);
        lastQuestionRef.current = q;
      } catch (e) {
        console.error("seed nextQuestion error:", e);
        const q = nextQuestion;
        setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
        if (ttsOn) betterSpeak(q);
        lastQuestionRef.current = q;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyForQuestion, guided, selectedId, activeBlock?.id]);

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
      if (!res.ok) return clean;
      const ct = res.headers.get("content-type") || "";
      const json = ct.includes("application/json") ? await res.json() : {};
      if (json?.ok && typeof json.text === "string") {
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

  // Si finale avant que le bloc soit prêt → rejoue
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

  // ===== Envoi =====
  async function commitAnswer(raw: string, ctx?: { blockId?: string; question?: string }) {
    const base = raw.trim();
    if (!base) return;

    const blkId = ctx?.blockId || blockIdRef.current;
    const qRaw = ctx?.question || questionRef.current;

    if (!blkId || !blocksRef.current?.[blkId]) {
      setPendingAnswer({ text: base, blockId: blkId, question: qRaw });
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: base, ts: Date.now() }]);
    setLastFinalRaw(base);

    const corrected = await reformulate(base, blkId);
    setLastSavedText(corrected);

    try {
      await appendNarrative(blkId, corrected, { q: qRaw });
    } catch (e) {
      console.error("Échec appendNarrative:", e);
    }

    // === GPT: prochaine question
    try {
      const res = await fetch("/api/llm/nextQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: blkId, lastAnswer: corrected }),
      });

      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        const json = ct.includes("application/json") ? await res.json() : {};
        if (json?.ok && json.question) {
          questionRef.current = json.question;
          setMessages((prev) => [...prev, { role: "assistant", text: json.question, ts: Date.now() }]);
          if (ttsOn) betterSpeak(json.question);
          lastQuestionRef.current = json.question;
          return;
        }
      }
    } catch (e) {
      console.error("Erreur nextQuestion:", e);
    }

    // === Fallback: pinned / progression guidée / libre
    if (guidedRef.current) {
      const b = blocksRef.current?.[blkId];
      const p = b?.pinnedQuestions ?? [];
      const pqLen = Math.max(1, p.length || 1);
      const nextQi = qIndex + 1;
      if (nextQi < pqLen) {
        setQIndex(nextQi);
      } else if (gIndexRef.current + 1 < scriptOrder.length) {
        setGIndex(gIndexRef.current + 1);
        setQIndex(0);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Merci, l’interview est terminée ✅", ts: Date.now() },
        ]);
        setGuided(false);
      }
    } else {
      const p = (blocksRef.current?.[blkId]?.pinnedQuestions ?? []);
      if (p.length) {
        setFreeQIndexByBlock((prev) => {
          const cur = prev[blkId] ?? 0;
          const nxt = (cur + 1) % p.length;
          return { ...prev, [blkId]: nxt };
        });
        const q = p[(freeQIndexByBlock[blkId] ?? 0 + 1) % p.length];
        questionRef.current = q;
        setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
        if (ttsOn) betterSpeak(q);
        lastQuestionRef.current = q;
      }
    }
  }

  // ===== Draft clavier =====
  const [draft, setDraft] = useState("");

  // ===== STT UI status =====
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
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-600 flex items-center gap-2">
                  <input type="checkbox" checked={usePro} onChange={(e) => setUsePro(e.target.checked)} />
                  STT Deepgram (pro)
                </label>

                {!usePro && (
                  <label className="text-xs text-gray-600 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={autoSTT}
                      onChange={(e) => setAutoSTT(e.target.checked)}
                      title="Relance auto, mains libres"
                    />
                    Mains libres (auto)
                  </label>
                )}
              </div>
            )}
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
                setStatus={(s) => setStatus(s)}
                onStart={() => {
                  // capture le contexte
                  sttCtxRef.current = { blockId: getActiveBlockId(), question: questionRef.current };
                }}
                onStop={() => {}}
                buttonLabel="Parler (Deepgram)"
              />
            ) : (
              <LiveSTT
                onPartial={handlePartial}
                onFinal={handleFinal}
                setStatus={(s) => setStatus(s)}
                onStart={() => {
                  sttCtxRef.current = { blockId: getActiveBlockId(), question: questionRef.current };
                }}
                onStop={() => {}}
                buttonLabel="Parler (navigateur)"
                auto={autoSTT}
                lang="fr-FR"
                autoRestartDelayMs={250}
              />
            )}
            <span className="text-xs text-gray-500">{status || "—"}</span>
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
                  commitAnswer(text, { blockId: getActiveBlockId(), question: questionRef.current });
                  setDraft("");
                }
              }}
            />
            <button
              onClick={() => {
                const text = draft.trim();
                if (!text) return;
                commitAnswer(text, { blockId: getActiveBlockId(), question: questionRef.current });
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
      Résumé (IA) — {activeBlock.title}
    </div>
    <div className="whitespace-pre-wrap text-sm bg-indigo-50/40 border rounded p-3 min-h-[80px]">
      {(activeBlock.summary ?? "").trim() || <em className="text-gray-400">— encore aucun résumé —</em>}
    </div>
  </section>
)}

      {/* Historique Q/R (optionnel) */}
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
                        {(e as any).q}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">A:&nbsp;</span>
                        {(e as any).a}
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
                        {(e as any).caption || "(sans légende)"}
                      </div>
                      <img
                        src={(e as any).url}
                        alt={(e as any).caption || "photo"}
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
