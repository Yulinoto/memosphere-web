// src/app/blocks/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useBlocks } from "@/hooks/useBlocks";
import type { Block, Entry } from "@/data/blocks";
import { clearDraftStorage } from "@/lib/draftStorage";
import LiveSTT from "@/app/interview/LiveSTT";
import VoiceChatControls from "@/components/VoiceChatControls";
import { PageNavButtons } from "@/components/ui/PageNavButtons";

type BlockWithOrder = Block & { order?: number };

// Ordre fixe de secours (garde Identité en tête)
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

type BlocksMap = Record<string, Block>;

type ReconcileItem = {
  field: string;
  old?: string | null;
  new: string;
  reason?: string;
  confidence?: number;
};
type ReconcileState = Record<string, { loading: boolean; items: ReconcileItem[] }>;
type CanonViewState = Record<string, boolean>; // toggle par bloc

function ensureAgentSessionId(): string {
  if (typeof window === "undefined") return "ms-server";
  let sid = localStorage.getItem("agent_session_id");
  if (!sid) {
    sid = `ms-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    localStorage.setItem("agent_session_id", sid);
  }
  return sid;
}

function downloadJson(filename: string, data: unknown) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {}
}

export default function BlocksPage() {
  const _api = useBlocks() as any;

  const loading: boolean = _api.loading;
  const blocks: BlocksMap | null = _api.blocks ?? null;

  const clearAll: () => Promise<void> = _api.clearAll;
  const setSummary: (blockId: string, summary: string) => Promise<void> = _api.setSummary;
  const setResolved: (
    blockId: string,
    patch: Record<string, { value: string; source?: string }>
  ) => Promise<void> = _api.setResolved;

  const unsetResolved: (blockId: string, key: string) => Promise<void> = _api.unsetResolved;
  const cleanupConflictsFor: (blockId: string, slotId: string) => Promise<void> =
    _api.cleanupConflictsFor;
  const importBlocks: (raw: unknown) => Promise<void> = _api.importBlocks;
  const addTextEntry: (blockId: string, q: string, a: string) => Promise<void> = _api.addTextEntry;

  const [agentNote, setAgentNote] = useState<Record<string, string>>({});
  const [sessionId, setSessionId] = useState<string>("");

  // Résumé: autosave (debounce)
  const saveTimers = useRef<Record<string, any>>({});
  const [draftSummaries, setDraftSummaries] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "idle" | "saving" | "saved">>({});

  // Reconcile
  const [reconcile, setReconcile] = useState<ReconcileState>({});
  function setRecon(blockId: string, payload: Partial<{ loading: boolean; items: ReconcileItem[] }>) {
    setReconcile((m) => {
      const prev = m[blockId] ?? { loading: false, items: [] as ReconcileItem[] };
      const next = { ...prev, ...payload };
      return { ...m, [blockId]: next };
    });
  }

  // Affichage du profil canonique + export
  const [showCanon, setShowCanon] = useState<CanonViewState>({});
  function toggleCanon(blockId: string) {
    setShowCanon((m) => ({ ...m, [blockId]: !m[blockId] }));
  }

  // === Export/Import GLOBAL ===
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Chat par bloc (transient UI state)
  type ChatMsg = { role: "user" | "assistant"; text: string; ts: number };
  const [chat, setChat] = useState<Record<string, ChatMsg[]>>({});
  const [openChat, setOpenChat] = useState<Record<string, boolean>>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatSending, setChatSending] = useState<Record<string, boolean>>({});
  const [sttStatus, setSttStatus] = useState<Record<string, string>>({});
  const [chatMode, setChatMode] = useState<Record<string, "text" | "voice">>({});

  function yyyymmddHHMM() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes())
    );
  }

  function handleExportAll() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessionId,
      blocks: blocks ?? {},
    };
    downloadJson(`memosphere-export-${yyyymmddHHMM()}.json`, payload);
  }

  async function handleImportAllFromFile(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      // validation légère
      const rawBlocks =
        (json && typeof json === "object" && json.blocks && typeof json.blocks === "object"
          ? json.blocks
          : json) ?? {};

      await importBlocks(rawBlocks);
      alert("Import réussi. Les blocs ont été remplacés.");
    } catch (e: any) {
      alert(`Échec d’import: ${e?.message || "fichier invalide"}`);
    }
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  useEffect(() => {
    try {
      const sid = ensureAgentSessionId();
      setSessionId(sid);
    } catch {
      setSessionId("ms-server");
    }
  }, []);

  const items = useMemo(
    () => (blocks ? (Object.values(blocks) as BlockWithOrder[]) : []),
    [blocks]
  );

  const sorted = useMemo(() => {
    return items.slice().sort((a, b) => {
      const oa = a.order ?? ORDER[a.id] ?? 0;
      const ob = b.order ?? ORDER[b.id] ?? 0;
      if (oa !== ob) return oa - ob;
      return (a.progress ?? 0) - (b.progress ?? 0);
    });
  }, [items]);

  async function verifyWithAgent(blockId: string) {
    try {
      const b = blocks?.[blockId] as (BlockWithOrder & any) | undefined;
      const lastAnswer =
        (b?.entries?.length ? (b!.entries[b!.entries.length - 1] as any).a : "") || "";

      // aplatit le profil canonique { field: {value,source} } -> { field: value }
      const canonical = Object.fromEntries(
        Object.entries(b?.resolved ?? {}).map(([k, v]: any) => [k, (v?.value ?? "").toString()])
      );

      const locks = b?.locks ?? {};

      const res = await fetch("/api/llm/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          section: blockId,
          canonical,
          locks,
          lastAnswer,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json) {
        setAgentNote((m) => ({ ...m, [blockId]: "Agent indisponible (validate)." }));
        return;
      }

      const follow =
        typeof json.followup === "string" && json.followup.trim()
          ? json.followup.trim()
          : "(pas de follow-up proposé)";
      const missing =
        Array.isArray(json.missing) && json.missing.length
          ? `Champs manquants: ${json.missing.join(", ")}`
          : "Aucun champ manquant détecté";

      setAgentNote((m) => ({
        ...m,
        [blockId]: `${follow}\n${missing}`,
      }));
    } catch (e: any) {
      setAgentNote((m) => ({ ...m, [blockId]: `Erreur: ${e?.message || "réseau"}` }));
    }
  }

  // Chat libre: profil aplati pour l'agent et envoi d'un tour
  function currentProfileFor(blockId: string): Record<string, string> {
    const b = blocks?.[blockId];
    const resolved = (b?.resolved ?? {}) as Record<string, { value?: string }>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(resolved)) {
      const val = String((v as any)?.value ?? "").trim();
      if (val) out[k] = val;
    }
    return out;
  }

  async function sendChat(blockId: string) {
    const text = (chatDrafts[blockId] ?? "").trim();
    if (!text) return;
    setChat((m) => ({
      ...m,
      [blockId]: [...(m[blockId] || []), { role: "user", text, ts: Date.now() }],
    }));
    setChatSending((m) => ({ ...m, [blockId]: true }));
    setChatDrafts((m) => ({ ...m, [blockId]: "" }));
    try {
      await addTextEntry(blockId, "Chat", text);
    } catch {}
    try {
      // Isoler la session par bloc pour éviter les fuites de contexte
      const chatSessionId = `${sessionId || "ms"}::${blockId}`;
      console.log("🧠 Chat libre →", { sessionId: chatSessionId, mode: "free", text });
      const res = await fetch("/api/agent/chat", {       

        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sectionId: blockId,
          sessionId: chatSessionId,
          profile: {},
          depthBudget: 2,
          mode: "free",
          avoidSchema: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      let say = typeof json?.say === "string" ? String(json.say).trim() : "";
      if (!say) {
        // Fallback libre local pour éviter tout guidage schema
        const teaser = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        say = `Tu mentionnes « ${teaser} ». Peux-tu développer librement, avec un exemple concret, un moment précis, et ce que tu as ressenti ?`;
      }
      if (say) {
        setChat((m) => ({
          ...m,
          [blockId]: [...(m[blockId] || []), { role: "assistant", text: say, ts: Date.now() }],
        }));
      }
      const patchRaw =
        json?.patch && typeof json.patch === "object" ? (json.patch as Record<string, any>) : null;
      if (patchRaw) {
        const payload: Record<string, { value: string; source?: string }> = {};
        for (const [k, v] of Object.entries(patchRaw)) {
          let val = "";
          if (typeof v === "string") val = v;
          else if (typeof v === "number" || typeof v === "boolean") val = String(v);
          else if (Array.isArray(v))
            val = v
              .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
              .join(" ");
          else if (v && typeof v === "object") {
            if (typeof (v as any).value === "string") val = (v as any).value;
            else if (typeof (v as any).text === "string") val = (v as any).text;
            else if (typeof (v as any).label === "string") val = (v as any).label;
            else {
              try {
                val = JSON.stringify(v);
              } catch {
                val = String(v);
              }
            }
          } else {
            val = String(v ?? "");
          }
          payload[String(k)] = { value: val, source: "agent_chat" };
        }
        if (Object.keys(payload).length) {
          try {
            await setResolved(blockId, payload);
            for (const key of Object.keys(payload)) {
              try {
                await cleanupConflictsFor(blockId, key);
              } catch {}
            }
          } catch {}
        }
      }
    } catch {}
    finally {
      setChatSending((m) => ({ ...m, [blockId]: false }));
    }
  }

  async function handleResetAll() {
    const ok = confirm(
      "Tout réinitialiser ? Cela efface les blocs locaux ET remet à zéro la mémoire de l’agent."
    );
    if (!ok) return;

    try {
      await clearAll();
      clearDraftStorage();
      try {
        await fetch("/api/agent/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch {}
      const newSid = `ms-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      localStorage.setItem("agent_session_id", newSid);
      setSessionId(newSid);
    } finally {
      location.reload();
    }
  }

  function setDraft(blockId: string, text: string) {
    setDraftSummaries((m) => ({ ...m, [blockId]: text }));
    setSaveState((m) => ({ ...m, [blockId]: "saving" }));

    // debounce 600ms
    if (saveTimers.current[blockId]) {
      clearTimeout(saveTimers.current[blockId]);
    }
    saveTimers.current[blockId] = setTimeout(async () => {
      try {
        await setSummary(blockId, text.trim());
        setSaveState((m) => ({ ...m, [blockId]: "saved" }));
      } catch {
        setSaveState((m) => ({ ...m, [blockId]: "idle" }));
      }
    }, 600);
  }

  async function generateSummary(blockId: string) {
    const b = blocks?.[blockId];
    // Inclut les entrées textuelles ET les faits canoniques (resolved)
    const entries: { q: string; a: string }[] = [
      // Entrées Q/A
      ...((b?.entries || [])
        .filter((e: Entry) => e.type === "texte")
        .map((e: any) => ({ q: String(e?.q || ""), a: String(e?.a || "") }))
      ),
      // Faits canoniques (ex: "nom_prenom" -> "Nom prenom")
      ...Object.entries((b as any)?.resolved || {})
        .map(([k, v]: any) => ({
          q: String(k || "").replace(/_/g, " ").trim(),
          a: String((v?.value ?? "")).trim(),
        }))
        .filter((p) => p.a.length > 0),
    ];

    setSaveState((m) => ({ ...m, [blockId]: "saving" }));
    try {
      const res = await fetch("/api/llm/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, lang: "fr", style: "biographique" }),
      });
      const json = await res.json().catch(() => ({}));
      const text = json?.ok && typeof json.text === "string" ? json.text : "";
      setDraftSummaries((m) => ({ ...m, [blockId]: text }));
      await setSummary(blockId, text);
      setSaveState((m) => ({ ...m, [blockId]: "saved" }));
    } catch {
      setSaveState((m) => ({ ...m, [blockId]: "idle" }));
      alert("Échec de génération du résumé.");
    }
  }

  async function proposeCorrections(blockId: string) {
    const b = blocks?.[blockId];
    if (!b) return;

    const summaryText = (draftSummaries[blockId] ?? "").trim();
    if (!summaryText) {
      alert("Le résumé est vide.");
      return;
    }

    // ⚠️ Aplatir le profil canonique -> { field: "value" }
    const currentResolved = (b as any).resolved || {};
    const currentFlat: Record<string, string> = Object.fromEntries(
      Object.entries(currentResolved).map(([k, v]: any) => [
        k,
        (v && typeof v === "object" && "value" in v && v.value != null) ? String(v.value) : String(v ?? ""),
      ])
    );

    setRecon(blockId, { loading: true });
    try {
      const res = await fetch("/api/llm/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          summaryText,
          current: currentFlat,
        }),
      });

      const json = await res.json().catch(() => ({}));
      const items = Array.isArray(json?.proposals) ? (json.proposals as ReconcileItem[]) : [];

      setRecon(blockId, { loading: false, items });
      if (!items.length) {
        const reason =
          typeof json?.reason === "string" && json.reason ? `\nRaison: ${json.reason}` : "";
        alert("Aucune correction détectée." + reason);
      }
    } catch (e) {
      setRecon(blockId, { loading: false, items: [] });
      alert("Échec des propositions de correction.");
    }
  }

  async function applyCorrections(blockId: string) {
    const data = reconcile[blockId];
    if (!data || !data.items?.length) return;

    const patch: Record<string, { value: string; source?: string }> = {};
    for (const it of data.items) {
      if (!it?.field || typeof it.new !== "string") continue;
      patch[it.field] = { value: it.new, source: "summary_reconcile" };
    }

    try {
      await setResolved(blockId, patch);
      for (const key of Object.keys(patch)) {
        await cleanupConflictsFor(blockId, key);
      }
      setRecon(blockId, { items: [] });
      alert("Corrections appliquées au profil.");
    } catch (e) {
      console.warn("applyCorrections:", e);
      alert("Échec lors de l’application des corrections.");
    }
  }

  useEffect(() => {
    // initialise les drafts depuis l’état des blocs
    if (!blocks) return;
    const next: Record<string, string> = {};
    for (const id of Object.keys(blocks)) {
      next[id] = (blocks[id].summary || "").toString();
    }
    setDraftSummaries(next);
  }, [blocks]);

  if (loading) return <div className="p-6">Chargement…</div>;
  if (!blocks) {
    return (
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {/* ✅ Boutons de navigation en haut */}
        <PageNavButtons show={["home", "interview", "draft"]} />

        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Blocs</h1>
        </header>

        {/* ✅ Section Import/Export + Reset */}
        <section className="border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3">
          <div className="text-xs text-gray-500 mr-auto">
            Session agent :{" "}
            <code className="px-1 py-0.5 bg-gray-100 rounded">{sessionId || "…"}</code>
          </div>

          <button
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
            onClick={handleExportAll}
            title="Télécharge un JSON contenant tous les blocs"
          >
            Exporter tout (JSON)
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                handleImportAllFromFile(f).finally(() => {
                  if (fileInputRef.current) fileInputRef.current.value = "";
                });
              }
            }}
          />
          <button
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
            onClick={triggerImport}
            title="Remplace les données locales par un JSON exporté"
          >
            Importer JSON…
          </button>

          {/* 🧨 Réinitialiser déplacé ici */}
          <button
            className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50 hover:text-red-700 transition-colors"
            onClick={handleResetAll}
            title="Réinitialise les blocs ET la mémoire de l’agent"
          >
            Réinitialiser
          </button>
        </section>

        <div className="p-6 border rounded-xl bg-white text-sm text-gray-500">
          Aucun bloc trouvé.
        </div>
      </main>
    );
  }

  const sortedList = sorted;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      {/* ✅ Boutons de navigation en haut */}
      <PageNavButtons show={["home", "interview", "draft"]} />

      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Blocs</h1>
      </header>

      {/* ✅ BARRE EXPORT / IMPORT GLOBALE + Reset */}
      <section className="border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3">
        <div className="text-xs text-gray-500 mr-auto">
          Session agent :{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded">{sessionId || "…"}</code>
        </div>

        <button
          className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          onClick={handleExportAll}
          title="Télécharge un JSON contenant tous les blocs"
        >
          Exporter tout (JSON)
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              handleImportAllFromFile(f).finally(() => {
                if (fileInputRef.current) fileInputRef.current.value = "";
              });
            }
          }}
        />
        <button
          className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          onClick={triggerImport}
          title="Remplace les données locales par un JSON exporté"
        >
          Importer JSON…
        </button>

        {/* 🧨 Réinitialiser ici (plus dans le header) */}
        <button
          className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50 hover:text-red-700 transition-colors"
          onClick={handleResetAll}
          title="Réinitialise les blocs ET la mémoire de l’agent"
        >
          Réinitialiser
        </button>
      </section>

      {/* ===== Liste des blocs ===== */}
      <section>
        <div className="grid grid-cols-12 gap-0 px-4 py-3 text-xs font-medium text-gray-500 bg-gray-50">
          <div className="col-span-3">Bloc</div>
          <div className="col-span-2">Progression</div>
          <div className="col-span-1">Entrées</div>
          <div className="col-span-6 text-right">Actions</div>
        </div>

        <ul className="space-y-6">
          {sortedList.map((b) => (
            <li key={b.id} className="p-4 border-2 rounded-lg bg-white shadow-sm">
              <div className="grid grid-cols-12 items-start gap-4">
                {/* Titre du bloc */}
                <div className="col-span-3 flex flex-col justify-start">
                  <h2 className="text-xl font-bold text-gray-800 leading-tight">{b.title}</h2>
                  <div className="h-[3px] w-2/3 bg-gradient-to-r from-[#6BA5C8] to-[#9DC8A5] rounded-full shadow-sm"></div>
                </div>

                {/* Barre de progression */}
                <div className="col-span-2">
                  <div className="relative w-full bg-gray-100 rounded h-2 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-2 transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, b.progress ?? 0))}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-600 mt-1 pl-2">{b.progress ?? 0}%</div>
                </div>

                <div className="col-span-1 text-xs text-gray-700 pt-1">
                  {b.entries?.length ?? 0}
                </div>

                <div className="col-span-6 flex items-center justify-end gap-2">
                  <Link
                    href={`/interview?block=${encodeURIComponent(b.id)}&sessionId=${encodeURIComponent(
                      sessionId
                    )}`}
                    className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                  >
                    Ouvrir l’interview
                  </Link>

                  <Link
                    href={`/blocks/${encodeURIComponent(b.id)}`}
                    className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                    title="Éditer le bloc"
                  >
                    Éditer
                  </Link>

                  <button
                    onClick={() => verifyWithAgent(b.id)}
                    className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                    title="Aperçu agent (follow-up + champs manquants)"
                  >
                    Vérifier avec l’agent
                  </button>
                </div>
              </div>

              {/* Résumé éditable + générer + reconcile + profil + export */}
              <div className="mt-3 grid grid-cols-12 gap-3">
                <div className="col-span-12">
                  {/* Chat libre */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium">Chat libre</div>
                    <div className="text-xs text-gray-500">
                      {chatSending[b.id] ? "Envoi..." : sttStatus[b.id] || ""}
                    </div>
                  </div>

                  {(openChat[b.id] ?? true) && (
                    <div className="space-y-2 mb-2">
                      <div className="max-h-48 overflow-auto border rounded p-2 bg-white/50">
                        {chat[b.id]?.length ? (
                          (chat[b.id] || []).map((m, idx) => (
                            <div
                              key={idx}
                              className={`flex ${
                                m.role === "assistant" ? "justify-start" : "justify-end"
                              } mb-1`}
                            >
                              <div
                                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow ${
                                  m.role === "assistant"
                                    ? "bg-indigo-50 text-indigo-900"
                                    : "bg-gray-100 text-gray-900"
                                }`}
                              >
                                {m.text}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-gray-500">
                            Lance un sujet pour ce bloc.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 w-full">
                        <div className="flex items-center justify-start gap-2 mb-1">
                          <span className="text-xs text-gray-600 font-medium">Mode :</span>
                          <button
                            onClick={() => setChatMode((m) => ({ ...m, [b.id]: "text" }))}
                            className={`text-xs px-2 py-1 border rounded ${
                              (chatMode[b.id] ?? "text") === "text" ? "bg-gray-100" : ""
                            }`}
                          >
                            Texte
                          </button>
                          <button
                            onClick={() => setChatMode((m) => ({ ...m, [b.id]: "voice" }))}
                            className={`text-xs px-2 py-1 border rounded ${
                              chatMode[b.id] === "voice" ? "bg-gray-100" : ""
                            }`}
                          >
                            Voix
                          </button>
                        </div>

                        {(chatMode[b.id] ?? "text") === "text" ? (
                          <div className="flex items-center flex-wrap gap-2">
                            <input
                              className="flex-1 border rounded p-2 text-sm"
                              placeholder="Lancer un sujet ou répondre..."
                              value={chatDrafts[b.id] ?? ""}
                              onChange={(e) =>
                                setChatDrafts((m) => ({ ...m, [b.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  sendChat(b.id);
                                }
                              }}
                            />
                            <button
                              className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                              onClick={() => sendChat(b.id)}
                              disabled={!chatDrafts[b.id]?.trim() || !!chatSending[b.id]}
                              title="Envoyer au chat"
                            >
                              Envoyer
                            </button>
                          </div>
                        ) : (
                          <VoiceChatControls
                            value={chatDrafts[b.id] ?? ""}
                            onChange={(t) => setChatDrafts((m) => ({ ...m, [b.id]: t }))}
                            onValidate={() => sendChat(b.id)}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium">Résumé</div>
                    <div className="text-xs text-gray-500">
                      {saveState[b.id] === "saving"
                        ? "Enregistrement…"
                        : saveState[b.id] === "saved"
                        ? "Enregistré"
                        : "—"}
                    </div>
                  </div>

                  <textarea
                    className="w-full border rounded p-3 text-sm bg-white"
                    rows={4}
                    placeholder="Résumé éditable du bloc…"
                    value={draftSummaries[b.id] ?? ""}
                    onChange={(e) => setDraft(b.id, e.target.value)}
                  />

                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    <button
                      className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                      onClick={() => generateSummary(b.id)}
                      title="Génère (ou régénère) le résumé à partir des entrées du bloc"
                    >
                      Générer
                    </button>

                    <button
                      className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                      onClick={() => proposeCorrections(b.id)}
                      disabled={!draftSummaries[b.id]?.trim()}
                      title="Analyse le résumé pour repérer des corrections crédibles"
                    >
                      Proposer corrections
                    </button>

                    <button
                      className="px-3 py-1.5 border rounded text-sm hover:bg-green-50"
                      onClick={() => applyCorrections(b.id)}
                      disabled={!(reconcile[b.id]?.items?.length)}
                      title="Applique les corrections au profil canonique"
                    >
                      Appliquer au profil
                    </button>

                    <button
                      className="px-2 py-1.5 border rounded text-xs hover:bg-gray-50"
                      onClick={() => toggleCanon(b.id)}
                      title="Afficher/Masquer le profil canonique du bloc"
                    >
                      {showCanon[b.id] ? "Masquer profil" : "Voir profil"}
                    </button>

                    <button
                      className="px-2 py-1.5 border rounded text-xs hover:bg-gray-50"
                      onClick={() => downloadJson(`${b.id}.json`, b)}
                      title="Exporter le bloc en JSON"
                    >
                      Exporter JSON
                    </button>

                    {reconcile[b.id]?.loading && (
                      <span className="text-xs text-gray-500">Analyse en cours…</span>
                    )}

                    {agentNote[b.id] && (
                      <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-1 rounded">
                        {agentNote[b.id]}
                      </span>
                    )}
                  </div>

                  {/* Liste des propositions */}
                  {reconcile[b.id]?.items?.length > 0 && (
                    <div className="mt-2 text-sm border rounded p-2 bg-indigo-50 text-indigo-900">
                      <div className="font-medium mb-1">Propositions détectées :</div>
                      <ul className="list-disc pl-5 space-y-1">
                        {reconcile[b.id].items.map((it, idx) => (
                          <li key={idx}>
                            <code>{it.field}</code>: <s>{it.old ?? "-"}</s>
                            {" -> "}
                            <b>{it.new}</b>
                            {typeof it.confidence === "number" && (
                              <span className="ml-2 text-xs opacity-80">
                                ({Math.round(it.confidence * 100)}%)
                              </span>
                            )}
                            {it.reason && (
                              <span className="ml-2 text-xs opacity-80">— {it.reason}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Profil canonique du bloc */}
                  {showCanon[b.id] && (
                    <div className="mt-3 text-sm border rounded p-3 bg-gray-50">
                      <div className="font-medium mb-2">
                        Profil canonique (valeurs consolidées)
                      </div>
                      {Object.keys((b as any).resolved || {}).length === 0 ? (
                        <div className="text-xs text-gray-500">
                          Aucune valeur canonique enregistrée pour ce bloc.
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {Object.entries(b.resolved || {}).map(([k, v]) => (
                            <li
                              key={k}
                              className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm"
                            >
                              <label className="text-xs w-48 font-medium text-gray-600">{k}</label>
                              <input
                                defaultValue={v?.value ?? ""}
                                className="flex-1 border rounded p-2 text-sm"
                                onBlur={async (e) => {
                                  const newVal = e.target.value.trim();
                                  if (newVal && newVal !== v?.value) {
                                    try {
                                      await setResolved(b.id, {
                                        [k]: { value: newVal, source: "user_edit" },
                                      });
                                    } catch (err) {
                                      console.error("Erreur update resolved:", err);
                                    }
                                  }
                                }}
                              />
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-gray-400">
                                  {v?.source ?? "-"}{" "}
                                  {v?.at ? `- ${new Date(v.at).toLocaleString()}` : ""}
                                </div>
                                <button
                                  className="px-2 py-1 border rounded text-xs hover:bg-red-50 hover:text-red-700"
                                  title="Supprimer cette valeur canonique"
                                  onClick={async () => {
                                    try {
                                      await unsetResolved(b.id, k);
                                    } catch (err) {
                                      console.error("unsetResolved error:", err);
                                    }
                                  }}
                                >
                                  Supprimer
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
