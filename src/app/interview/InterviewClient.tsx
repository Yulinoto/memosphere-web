"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBlocks } from "@/hooks/useBlocks";
import type { Entry, Block } from "@/data/blocks";
import DeepgramSTT from "./DeepgramSTT";
import LiveSTT from "./LiveSTT";
import schemaJson from "@/data/interviewSchema.json";
import { useBetterTTS } from "@/hooks/useBetterTTS";

type BlockWithOrder = { id: string; progress?: number; order?: number } & any;

const ORDER: Record<string, number> = {
  identite: 0,
  enfance: 10,
  adolescence: 20,
  debuts_adultes: 30,
  metier: 40,
  valeurs: 50,
  anecdotes: 60,
  lieux: 70,
  theme_central: 80,
  heritage: 90,
};

type Mode = "voice" | "text";
type MsgRole = "assistant" | "user" | "draft";
type Message = { role: MsgRole; text: string; ts: number; key?: string };
type PendingPayload = { text: string; blockId?: string; question?: string };
type BlocksMap = Record<string, Block>;

// ===== Feature flag (agent SDK pilote) =====
const AGENT_MODE = true;

export default function InterviewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- hooks blocs
  const _api = useBlocks() as any;
  const loading: boolean = _api.loading;
  const blocks: BlocksMap | null = _api.blocks ?? null;
  const addTextEntry: (blockId: string, q: string, a: string) => Promise<void> = _api.addTextEntry;
  const setResolved:
    | undefined
    | ((blockId: string, payload: Record<string, { value: string; source?: string }>) => Promise<void>) =
    _api.setResolved;

  // ===== Liste blocs / sélection (mode libre) =====
  const items = useMemo(() => (blocks ? (Object.values(blocks) as any[]) : []), [blocks]);

  // --- Tri fixe pour garder Identité en tête + ordre stable
  const itemsSorted = useMemo(() => {
    return items.slice().sort((a: BlockWithOrder, b: BlockWithOrder) => {
      const oa = (a?.order ?? ORDER[a?.id] ?? 0);
      const ob = (b?.order ?? ORDER[b?.id] ?? 0);
      if (oa !== ob) return oa - ob;
      return (a?.progress ?? 0) - (b?.progress ?? 0);
    });
  }, [items]);

  const [selectedId, setSelectedId] = useState<string>("");
// --- contrôles "première question" ---
const [firstQuestion, setFirstQuestion] = useState<string>(""); // texte à poser en 1er
const firstQPrimedRef = useRef(false);                          // indique si on doit poser firstQuestion
const firstQuestionSlotRef = useRef<string | null>(null);

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
  const [qIndex, setQIndex] = useState(0); // index pinned

  // Pré-sélection 1er bloc (mode libre)
  useEffect(() => {
    if (!loading && itemsSorted.length && !selectedId && !guided) {
      setSelectedId(itemsSorted[0].id);
    }
  }, [loading, itemsSorted, selectedId, guided]);

  // Bloc actif
  const guidedBlockId = guided ? scriptOrder[gIndex] : null;
  const activeBlock = useMemo(() => {
    if (guided) {
      if (!guidedBlockId) return null;
      return blocks?.[guidedBlockId] ?? null;
    }
    if (!selectedId || !blocks) return null;
    return blocks[selectedId] ?? null;
  }, [guided, guidedBlockId, selectedId, blocks]);

  // ===== Mode (Voix / Texte) =====
  const [mode, setMode] = useState<Mode>("voice");

  // ===== TTS =====
  const [ttsOn, setTtsOn] = useState(true);
  const [ttsVoice, setTtsVoice] = useState<string>(() => {
    if (typeof window === "undefined") return "alloy";
    return localStorage.getItem("tts_voice") || "alloy";
  });
  const { speak: speakTTS, stop: stopTTS, loading: ttsLoading } = useBetterTTS("alloy");

  useEffect(() => {
    const v = localStorage.getItem("tts_on");
    if (v === "0") setTtsOn(false);
  }, []);
  useEffect(() => {
    localStorage.setItem("tts_on", ttsOn ? "1" : "0");
    if (!ttsOn) stopTTS();
  }, [ttsOn, stopTTS]);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("tts_voice", ttsVoice);
  }, [ttsVoice]);

  // ===== STT choix =====
  const [usePro, setUsePro] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("stt_mode");
    if (saved === "browser") setUsePro(false);
  }, []);
  useEffect(() => {
    localStorage.setItem("stt_mode", usePro ? "pro" : "browser");
  }, [usePro]);

  // ===== Correction IA (scribe) =====
  const [aiOptIn, setAiOptIn] = useState(true);
  useEffect(() => {
    const v = localStorage.getItem("ai_optin");
    setAiOptIn(v !== "0");
  }, []);
  useEffect(() => {
    localStorage.setItem("ai_optin", aiOptIn ? "1" : "0");
  }, [aiOptIn]);

  // ===== blockId courant =====
  function getActiveBlockId(): string {
    if (guided) {
      const id = guidedBlockId ?? scriptOrder[gIndex];
      return id || "";
    }
    return selectedId || "";
  }

  const blkIdReady = Boolean(activeBlock && getActiveBlockId());

  // ===== Fallback pinned question =====
  const nextQuestion = useMemo(() => {
    const p = activeBlock?.pinnedQuestions ?? [];
    if (!p.length) return "Raconte-moi un souvenir lié à ce thème.";
    const idx = guided ? (qIndex % p.length) : ((activeBlock?.entries.length ?? 0) % p.length);
    return p[idx];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlock?.id, guided, qIndex, activeBlock?.entries.length]);

  // ===== Refs =====
  const blocksRef = useRef<BlocksMap | null>(null);
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
  const firstIAAskedRef = useRef(false);

  // ===== Mode "chat libre" une fois la section finie =====
  const [freeFlowBlocks, setFreeFlowBlocks] = useState<Record<string, boolean>>({});
  const isFreeFlow = useMemo(() => {
    const id = getActiveBlockId();
    return !!(id && freeFlowBlocks[id]);
  }, [freeFlowBlocks, guided, selectedId, activeBlock?.id]);
  const enableFreeFlow = (blockId: string) => {
    if (!blockId) return;
    setFreeFlowBlocks((m) => ({ ...m, [blockId]: true }));
  };

  async function getFreeChatQuestion(blockId: string, lastAnswer?: string): Promise<string> {
    try {
      const res = await fetch("/api/llm/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastText: (lastAnswer || "").trim() || "", blockId, lang: "fr" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && typeof json.question === "string") {
        return String(json.question).trim();
      }
    } catch {}
    // Fallback: question plus ouverte
    return "On a couvert l'essentiel ici. Un souvenir ou un point que tu voudrais approfondir ?";
  }

// === Mémoire des slots déjà demandés (session + persistance) ===
const ASKED_SLOTS_KEY = "memosphere:askedSlots:v1";
// structure: { [blockId]: Set<slotId> }
const askedSlotsRef = useRef<Record<string, Set<string>>>({});

useEffect(() => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(ASKED_SLOTS_KEY) : null;
    if (raw) {
      const parsed: Record<string, string[]> = JSON.parse(raw);
      const shaped: Record<string, Set<string>> = {};
      for (const [k, arr] of Object.entries(parsed || {})) {
        shaped[k] = new Set(arr || []);
      }
      askedSlotsRef.current = shaped;
    }
  } catch {
    askedSlotsRef.current = {};
  }
}, []);

function persistAskedSlots() {
  try {
    const plain: Record<string, string[]> = {};
    for (const [k, s] of Object.entries(askedSlotsRef.current || {})) {
      plain[k] = Array.from(s || []);
    }
    localStorage.setItem(ASKED_SLOTS_KEY, JSON.stringify(plain));
  } catch {}
}

function markAsked(blockId: string | undefined, slotId: string | null | undefined) {
  if (!blockId || !slotId) return;
  if (!askedSlotsRef.current[blockId]) askedSlotsRef.current[blockId] = new Set();
  askedSlotsRef.current[blockId].add(slotId);
  persistAskedSlots();
}

function wasAsked(blockId: string | undefined, slotId: string | null | undefined) {
  if (!blockId || !slotId) return false;
  return !!askedSlotsRef.current[blockId]?.has(slotId);
}

function isSlotFilled(blockId: string | undefined, slotId: string) {
  const b = blocksRef.current?.[blockId || ""];
  const val = (b?.resolved?.[slotId]?.value ?? "") as string;
  return String(val || "").trim().length > 0;
}

function missingSlotsFor(blockId: string | undefined): string[] {
  if (!blockId) return [];
  const b = blocksRef.current?.[blockId];
  const resolved = (b?.resolved ?? {}) as Record<string, any>;
  return Object.keys(resolved).filter((k) => !String(resolved[k]?.value ?? "").trim());
}

function nextMissingNotAsked(blockId: string | undefined): string | null {
  const missing = missingSlotsFor(blockId);
  for (const s of missing) {
    if (!wasAsked(blockId, s)) return s;
  }
  return null;
}

 // ===== Lire ?block=... & ?slot=... =====
useEffect(() => {
  const wantedBlock = searchParams?.get("block") || null;
  const wantedSlot  = searchParams?.get("slot")  || null;

  if (!wantedBlock || !blocks) return;
  if (!blocks[wantedBlock]) return;

  // reset propre
  setSelectedId(wantedBlock);
  setMessages([]);
  firstIAAskedRef.current = false;

  // prépare la 1ère question si slot présent
  if (wantedSlot) {
    setFirstQuestion(`Parlons du champ « ${wantedSlot} ». Peux-tu le préciser ou le compléter ?`);
    firstQPrimedRef.current = true;
    firstQuestionSlotRef.current = wantedSlot;
  } else {
    setFirstQuestion("");
    firstQPrimedRef.current = false;
    firstQuestionSlotRef.current = null;
  }
}, [searchParams, blocks]);



  // ===== IA Questions naturelles =====
  const [aiQ, setAiQ] = useState<string>("");
  const [aiEnabled, setAiEnabled] = useState(true);

  // ===== STT =====
  const [livePartial, setLivePartial] = useState("");
  const [lastFinalRaw, setLastFinalRaw] = useState("");
  const [lastSavedText, setLastSavedText] = useState("");
  const sttCtxRef = useRef<{ blockId?: string; question?: string } | null>(null);

  // ===== Pending si bloc pas prêt =====
  const [pendingAnswer, setPendingAnswer] = useState<PendingPayload | null>(null);
  useEffect(() => {
    const blkId = getActiveBlockId();
    if (pendingAnswer && (pendingAnswer.blockId || blkId) && (pendingAnswer.question || questionRef.current)) {
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
  }, [activeBlock?.id, guided, selectedId, gIndex, qIndex]);

  // ===== Utils =====
  function isDuplicateAssistant(text: string): boolean {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.text.trim() === text.trim();
  }
  function uniquifyQuestionForBlock(blockId: string, baseQ: string): string {
    const b = blocksRef.current?.[blockId];
    const entries = (b?.entries ?? []) as any[];
    const same = entries.filter((e) => (e?.q ?? "") === baseQ);
    if (same.length === 0) return baseQ;
    return `${baseQ} (${same.length + 1})`;
  }

  // ===== Agent SDK helper (retourne say/patch/done) =====
  function currentProfileFor(blockId: string): Record<string, string> {
    const b = blocksRef.current?.[blockId];
    const resolved = (b?.resolved ?? {}) as Record<string, { value?: string }>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(resolved)) {
      const val = String((v as any)?.value ?? "").trim();
      if (val) out[k] = val;
    }
    return out;
  }
  async function askAgent(message: string, sessionId: string, sectionId: string) {
  try {
    const userHint = {
      message,              // texte utilisateur
      sectionId,            // bloc courant
      sessionId,
      depthBudget: 3        // budget d’approfondissement max (un peu plus de relance)
    };

    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...userHint, profile: currentProfileFor(sectionId) }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json && typeof json.say === "string") {
      return { say: String(json.say).trim(), patch: json.patch || null, done: !!json.done };
    }
  } catch {}
  return { say: "", patch: null, done: false };
}


  // ===== Agent heuristique legacy (conservé en fallback) =====
  async function fetchNextQuestionFor(blockId: string, lastAnswer?: string) {
    if (!aiEnabled || !blockId) return "";
    try {
      const entries = (blocksRef.current?.[blockId]?.entries ?? []).map((e: any) => ({
        q: e?.q || "",
        a: e?.a || "",
      }));
      const res = await fetch("/api/llm/nextQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId, lastAnswer: lastAnswer || "", entries }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && typeof json.question === "string") {
        return String(json.question).trim();
      }
      return "";
    } catch {
      return "";
    }
  }

  // ===== Première question IA à l’arrivée sur un bloc =====
useEffect(() => {
  if (!activeBlock) return;
  if (firstIAAskedRef.current) return;

  // 1) Si on a une firstQuestion (venant de ?slot=...), on la pose et on s'arrête.
  if (firstQPrimedRef.current && firstQuestion.trim()) {
    const q = firstQuestion.trim();
    setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
    // marque le slot demandé comme posé pour éviter la redite
    markAsked(getActiveBlockId() || activeBlock?.id, firstQuestionSlotRef.current);
    if (ttsOn) { try { speakTTS(q, ttsVoice); } catch {} }
    firstIAAskedRef.current = true;
    return; // ✅ surtout ne pas appeler l'agent derrière
  }

  // 2) Sinon, on demande UNE question à l’agent
  (async () => {
    const blkId = activeBlock.id;
    const { say: agentQ, done } = await askAgent("", blkId, blkId);
    if (done) {
      enableFreeFlow(blkId);
      const qDone = (agentQ && /\?\s*$/.test(agentQ)) ? agentQ : await getFreeChatQuestion(blkId);
      if (qDone) {
        setMessages((prev) => [...prev, { role: "assistant", text: qDone, ts: Date.now() }]);
        if (ttsOn) { try { await speakTTS(qDone, ttsVoice); } catch {} }
      }
      firstIAAskedRef.current = true;
      return;
    }
    const q =
      (agentQ && agentQ.trim()) ||
      `Sur « ${activeBlock.title ?? blkId} », qu’aimerais-tu préciser ?`;

    setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
    if (ttsOn) { try { await speakTTS(q, ttsVoice); } catch {} }
    firstIAAskedRef.current = true;
  })();
  // ❗ Dépendances FIXES : pas de variable conditionnelle qui change la taille
}, [activeBlock?.id, ttsOn, ttsVoice]);




  // ===== Scribe (reformulation) =====
  async function reformulate(text: string, blockId?: string) {
    const clean = text.trim();
    if (!clean) return "";
    if (!aiOptIn) return clean;
    if (clean.replace(/\s+/g, " ").length < 10) return clean;

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 2500);
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
        signal: controller.signal,
      });
      clearTimeout(to);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && typeof json.text === "string") {
        const out = String(json.text).trim();
        return out || clean;
      }
      return clean;
    } catch {
      clearTimeout(to);
      return clean;
    }
  }

  // ===== Commit (save) =====
  async function commitAnswer(raw: string, ctx?: { blockId?: string; question?: string }) {
    const base = raw.trim();
    if (!base) return;

    const blkId = ctx?.blockId || blockIdRef.current;
    const qRaw  = ctx?.question || questionRef.current;

    if (!blkId || !blocksRef.current?.[blkId]) {
      setPendingAnswer({ text: base, blockId: blkId, question: qRaw });
      return;
    }

    // Bulle utilisateur brute
    setMessages((prev) => [...prev, { role: "user", text: base, ts: Date.now() }]);
    setLastFinalRaw(base);

    // Correction IA locale
    const corrected = await reformulate(base, blkId);
    setLastSavedText(corrected);

    // Q stockée (unique)
    const questionToStore = uniquifyQuestionForBlock(blkId, qRaw || "Question");

    // Save bloc (ton stockage existant)
    try { await addTextEntry(blkId, questionToStore, corrected); } catch (e) { console.error("addTextEntry:", e); }

    // Avancement guidé (pinned)
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
    }

    // ===== Cycle suivant =====
    try {
      const blkForSession = blkId; // 1 thread par bloc
      let finalQ = "";

      if (AGENT_MODE && !freeFlowBlocks[blkForSession]) {
        const { say: agentQ, patch, done } = await askAgent(corrected, blkForSession, blkForSession);

        // Applique les champs écrits par l'agent AU BON BLOC
        if (patch && typeof setResolved === "function") {
          const toText = (val: any): string => {
            if (val == null) return "";
            if (typeof val === "string") return val;
            if (typeof val === "number" || typeof val === "boolean") return String(val);
            if (Array.isArray(val)) return val.map(toText).join(" ");
            if (typeof val === "object") {
              if (typeof (val as any).value === "string") return (val as any).value;
              if (typeof (val as any).text === "string") return (val as any).text;
              if (typeof (val as any).label === "string") return (val as any).label;
              try { return JSON.stringify(val); } catch { return String(val); }
            }
            return String(val);
          };

          const payload: Record<string, { value: string; source?: string }> = {};
          for (const [k, v] of Object.entries(patch)) {
            payload[k] = { value: toText(v), source: "agent_sdk" };
          }
          await setResolved(blkId, payload);

          const pretty = Object.entries(patch).map(([k, v]) => `${k} = ${toText(v)}`).join(", ");
          if (pretty) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `Noté : ${pretty}.`, ts: Date.now() },
            ]);
          }
        }
        if (done) {
          enableFreeFlow(blkForSession);
          finalQ = (agentQ && /\?\s*$/.test(agentQ)) ? agentQ : await getFreeChatQuestion(blkForSession, corrected);
        } else {
          // Si l'agent ne propose pas une question claire, tente une relance contextuelle avant le fallback pinned
          if (!agentQ || !/\?\s*$/.test(agentQ)) {
            const probeQ = await getFreeChatQuestion(blkForSession, corrected);
            finalQ = probeQ || nextQuestion;
          } else {
            finalQ = agentQ;
          }
        }
      } else {
        // Si la section est marquée "chat libre", bypass legacy et pose une relance souple
        if (freeFlowBlocks[blkForSession]) {
          const q = await getFreeChatQuestion(blkForSession, corrected);
          finalQ = q || nextQuestion;
        } else {
          // ---- Legacy validate/commit/nextQuestion (conservé en fallback) ----
          const validateRes = await fetch("/api/llm/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blockId: blkId,
              canonical: {},
              locks: {},
              lastAnswer: corrected,
              section: blkId
            }),
          });
          const validateJson = await validateRes.json().catch(() => ({}));

          if (validateRes.ok && validateJson) {
            const toUpdate = validateJson.fields_to_update || {};
            const locksUpdate = validateJson.locks_update || {};
            if ((Object.keys(toUpdate).length || Object.keys(locksUpdate).length)) {
              await fetch("/api/llm/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId: "local",
                  fields_to_update: toUpdate,
                  locks_update: locksUpdate,
                }),
              });
              const pretty = Object.entries(toUpdate).map(([k, v]) => `${k} = ${String(v)}`).join(", ");
              if (pretty) {
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", text: `Merci. J’ai noté ${pretty}.`, ts: Date.now() },
                ]);
              }
              if (typeof setResolved === "function") {
                const payload: Record<string, { value: string; source?: string }> = {};
                for (const [k, v] of Object.entries(toUpdate)) {
                  payload[k] = { value: String(v), source: "agent_auto" };
                }
                await setResolved(blkId, payload);
              }
            }

            finalQ =
              (typeof validateJson.followup === "string" && validateJson.followup.trim())
                ? validateJson.followup.trim()
                : "";
            if (!finalQ) finalQ = await fetchNextQuestionFor(blkId, corrected) || nextQuestion;
          } else {
            finalQ = await fetchNextQuestionFor(blkId, corrected) || nextQuestion;
          }
        }
      }

      // priorité aux slots manquants non encore posés
      {
        const nm = nextMissingNotAsked(blkForSession);
        if (nm) {
          finalQ = `Peux-tu me renseigner « ${nm} » ?`;
          markAsked(blkForSession, nm);
        }
      }
      // priorité aux slots manquants non encore posés
      {
        const nm = nextMissingNotAsked(blkId);
        if (nm) {
          finalQ = `Peux-tu me renseigner « ${nm} » ?`;
          markAsked(blkId, nm);
        }
      }
      setAiQ(finalQ);
      if (!isDuplicateAssistant(finalQ)) {
        setMessages((prev) => [...prev, { role: "assistant", text: finalQ, ts: Date.now() }]);
        if (ttsOn) { try { await speakTTS(finalQ, ttsVoice); } catch {} }
      }
    } catch {
      let finalQ = await fetchNextQuestionFor(blkId, corrected);
      if (!finalQ) finalQ = nextQuestion;
      // priorité aux slots manquants non encore posés
      {
        const blkIdNext = (typeof getActiveBlockId === "function" ? getActiveBlockId() : undefined) || activeBlock?.id || selectedId || undefined;
        const nm = nextMissingNotAsked(blkIdNext);
        if (nm) {
          finalQ = `Peux-tu me renseigner « ${nm} » ?`;
          markAsked(blkIdNext, nm);
        }
      }
      setAiQ(finalQ);
      if (!isDuplicateAssistant(finalQ)) {
        setMessages((prev) => [...prev, { role: "assistant", text: finalQ, ts: Date.now() }]);
        if (ttsOn) { try { await speakTTS(finalQ, ttsVoice); } catch {} }
      }
    }
  }

  // ===== Saisie / STT =====
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");

  function upsertDraft(text: string) {
    const key = "draft-singleton";
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.key === key);
      const msg: Message = { role: "draft", text, ts: Date.now(), key };
      if (idx === -1) return [...prev, msg];
      const newArr = prev.slice();
      newArr[idx] = msg;
      return newArr;
    });
  }
  function clearDraft() {
    const key = "draft-singleton";
    setMessages((prev) => prev.filter((m) => m.key !== key));
  }
// ===== Latence/endpointing côté client (debounce de silence) =====
const SILENCE_DEBOUNCE_MS = 1400; // ajuste 1000–2000ms selon ton débit
const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const queuedTextRef = useRef<string>("");

function scheduleFinalize(text: string, ctx?: { blockId?: string; question?: string }) {
  const clean = (text || "").trim();
  if (!clean) return;
  queuedTextRef.current = clean;

  if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
  finalizeTimerRef.current = setTimeout(async () => {
    const payload = (queuedTextRef.current || "").trim();
    queuedTextRef.current = "";
    finalizeTimerRef.current = null;

    const effectiveCtx = ctx || sttCtxRef.current || { blockId: getActiveBlockId(), question: aiQ || questionRef.current };
    await commitAnswer(payload, effectiveCtx);
  }, SILENCE_DEBOUNCE_MS);
}

  const handlePartial = (t: string) => {
    const clean = t.trim();
    setLivePartial(clean);
    if (!clean) return;
    upsertDraft(clean);
  };

  const handleFinal = async (t: string) => {
    clearDraft();
    const clean = t.trim();
    if (!clean) {
      setLivePartial("");
      return;
    }
    const ctx = sttCtxRef.current || undefined;
    if (!(ctx?.blockId || blockIdRef.current)) {
      setLastFinalRaw(clean);
      setPendingAnswer({ text: clean, blockId: ctx?.blockId, question: ctx?.question });
      setLivePartial("");
      return;
    }
    await commitAnswer(clean, ctx);
    setLivePartial("");
  };

  // ===== (IMPORTANT) Pas de double question automatique en mode agent =====
  useEffect(() => {
    if (AGENT_MODE) return; // pas de deuxième question auto
    if (!blkIdReady) return;

    const last = messages[messages.length - 1];
    const lastIsAssistant = last?.role === "assistant";
    const lastText = (last?.text || "").trim();
    const fallbackQ = nextQuestion.trim();

    if (lastIsAssistant && (lastText === fallbackQ || lastText === aiQ.trim())) return;

    (async () => {
      const q = aiQ || fallbackQ;
      if (!isDuplicateAssistant(q)) {
        setMessages((prev) => [...prev, { role: "assistant", text: q, ts: Date.now() }]);
        if (ttsOn) { try { speakTTS(q, ttsVoice); } catch {} }
      }
      if (!aiQ) setAiQ(q);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blkIdReady, activeBlock?.id, nextQuestion, ttsOn, ttsVoice]);

  if (loading || !blocks) return <div className="p-6">Chargement…</div>;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Interview</h1>
        <button className="text-sm text-gray-500" onClick={() => router.push("/blocks")}>
          ← Voir les blocs
        </button>
      </header>

      {/* Contrôles principaux */}
      <section className="space-y-2 border rounded-xl p-4 bg-white">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {/* Mode */}
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-2 border rounded text-sm ${mode === "voice" ? "bg-gray-100" : "hover:bg-gray-50"}`}
                onClick={() => setMode("voice")}
              >
                Voix
              </button>
              <button
                className={`px-3 py-2 border rounded text-sm ${mode === "text" ? "bg-gray-100" : "hover:bg-gray-50"}`}
                onClick={() => setMode("text")}
              >
                Texte
              </button>
            </div>

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
                    firstIAAskedRef.current = false;
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

          {/* TTS + IA + Voix */}
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ttsOn} onChange={(e) => setTtsOn(e.target.checked)} />
              Lecture vocale des questions
            </label>

            <div className="flex items-center gap-2">
              <span className="text-gray-600">Voix</span>
              <select
                className="border rounded p-1 text-xs"
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                disabled={!ttsOn || ttsLoading}
                title="Sélection de la voix TTS OpenAI"
              >
                <option value="alloy">alloy</option>
                <option value="verve">verve</option>
                <option value="ember">ember</option>
                <option value="sage">sage</option>
                <option value="verse">verse</option>
              </select>
              <button
                className="px-2 py-1 border rounded text-xs hover:bg-gray-50"
                onClick={() => speakTTS("D'accord, je te lis les questions avec cette voix.", ttsVoice)}
                disabled={!ttsOn || ttsLoading}
                title="Tester la voix"
              >
                Tester
              </button>
            </div>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={aiOptIn} onChange={(e) => setAiOptIn(e.target.checked)} />
              Correction automatique (IA)
            </label>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
              Questions naturelles (LLM)
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
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setMessages([]);
                  firstIAAskedRef.current = false;
                }}
              >
                {itemsSorted.map((b) => (
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
                m.role === "assistant"
                  ? "bg-indigo-50 text-indigo-900"
                  : m.role === "draft"
                  ? "bg-yellow-50 text-yellow-900"
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
        {/* Voix */}
        {mode === "voice" && (
          <div className="flex items-center gap-2">
            {usePro ? (
              <DeepgramSTT
  onPartial={(t) => {
    const clean = t.trim();
    setLivePartial(clean);
    if (clean) {
      upsertDraft(clean);
      scheduleFinalize(clean, sttCtxRef.current || { blockId: getActiveBlockId(), question: aiQ || questionRef.current });
    }
  }}
  onFinal={(t) => {
    clearDraft();
    const clean = t.trim();
    if (!clean) { setLivePartial(""); return; }
    // ❗ au lieu de commit immédiat → on passe par le debounce
    scheduleFinalize(clean, sttCtxRef.current || { blockId: getActiveBlockId(), question: aiQ || questionRef.current });
    setLivePartial("");
  }}
  setStatus={setStatus}
  onStart={() => {
    sttCtxRef.current = { blockId: getActiveBlockId(), question: aiQ || questionRef.current };
  }}
  onStop={() => {}}
  buttonLabel="Parler (Deepgram)"
/>

            ) : (
              <LiveSTT
  onPartial={(t) => {
    const clean = t.trim();
    setLivePartial(clean);
    if (clean) {
      upsertDraft(clean);
      scheduleFinalize(clean, sttCtxRef.current || { blockId: getActiveBlockId(), question: aiQ || questionRef.current });
    }
  }}
  onFinal={(t) => {
    clearDraft();
    const clean = t.trim();
    if (!clean) { setLivePartial(""); return; }
    // ❗ pas de commit direct, on attend SILENCE_DEBOUNCE_MS
    scheduleFinalize(clean, sttCtxRef.current || { blockId: getActiveBlockId(), question: aiQ || questionRef.current });
    setLivePartial("");
  }}
  setStatus={setStatus}
  onStart={() => {
    sttCtxRef.current = { blockId: getActiveBlockId(), question: aiQ || questionRef.current };
  }}
  onStop={() => {}}
  buttonLabel="Parler (navigateur)"
/>

            )}
            <span className="text-xs text-gray-500">
              {blkIdReady
                ? "Parle, j’affiche en jaune. À l’arrêt, j’enregistre (corrigé) et je relance."
                : "Choisis un bloc ou active le parcours guidé."}
            </span>
          </div>
        )}

        {/* Texte */}
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
                  if (!blkIdReady) return;
                  const text = draft.trim();
                  if (text) {
                    commitAnswer(text, { blockId: getActiveBlockId(), question: aiQ || questionRef.current });
                    setDraft("");
                  }
                }
              }}
            />
            <button
              className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
              disabled={!blkIdReady}
              onClick={() => {
                const text = draft.trim();
                if (text) {
                  commitAnswer(text, { blockId: getActiveBlockId(), question: aiQ || questionRef.current });
                  setDraft("");
                }
              }}
            >
              Envoyer
            </button>
          </div>
        )}
      </section>

      {/* Transcription récente */}
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

      {/* Historique récent */}
      {activeBlock && activeBlock.entries.length > 0 && (
        <section className="space-y-2 border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Dernières entrées — {activeBlock.title}
          </div>
          <ul className="space-y-2">
            {activeBlock.entries
              .slice()
              .reverse()
              .slice(0, 5)
              .map((e: Entry, i: number) => (
                <li key={i} className="border rounded p-3 bg-white">
                  {"q" in e && (
                    <div className="text-sm">
                      <span className="font-medium">Q:</span> {(e as any).q}
                    </div>
                  )}
                  {"a" in e && (
                    <div className="text-sm">
                      <span className="font-medium">A:</span> {(e as any).a}
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}
    </main>
  );
}
