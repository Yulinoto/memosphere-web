// src/app/blocks/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBlocks } from "@/hooks/useBlocks";
import type { Block, Entry } from "@/data/blocks";
import { summarizeBlockLLM } from "@/lib/summarize";
import schemaJson from "@/data/interviewSchema.json";

/** Petit gestionnaire d'historique local (undo/redo + coalescing) */
function useUndoManager(initial = "", coalesceMs = 400) {
  const [value, setValue] = useState(initial);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushTs = useRef<number>(0);

  // snapshot courant “version enregistrée” (externe)
  const savedSnapshotRef = useRef<string>(initial);

  // reset complet (ex: changement de bloc)
  const reset = (next: string) => {
    undoStack.current = [];
    redoStack.current = [];
    lastPushTs.current = 0;
    savedSnapshotRef.current = next;
    setValue(next);
  };

  // quand l’extérieur enregistre réellement (persistance OK)
  const markSaved = (currentPersisted: string) => {
    savedSnapshotRef.current = currentPersisted;
  };

  const canUndo = () => undoStack.current.length > 0;
  const canRedo = () => redoStack.current.length > 0;

  const push = (next: string) => {
    const now = Date.now();
    const since = now - lastPushTs.current;
    // coalesce: si modifs très rapprochées, on écrase le sommet
    if (since > coalesceMs || undoStack.current.length === 0) {
      undoStack.current.push(value);
    } else {
      undoStack.current[undoStack.current.length - 1] = value;
    }
    lastPushTs.current = now;
    // tape une nouvelle valeur → vide redo
    redoStack.current = [];
    setValue(next);
  };

  const onChange = (next: string) => {
    push(next);
  };

  const undo = () => {
    if (!canUndo()) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push(value);
    setValue(prev);
  };

  const redo = () => {
    if (!canRedo()) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(value);
    setValue(next);
  };

  const revertToSaved = () => {
    const saved = savedSnapshotRef.current ?? "";
    if (saved === value) return;
    // on empile la valeur actuelle dans undo, comme une “étape”
    undoStack.current.push(value);
    redoStack.current = [];
    setValue(saved);
  };

  return {
    value, setValue, onChange,
    reset, markSaved,
    undo, redo, revertToSaved,
    canUndo, canRedo,
    getSaved: () => savedSnapshotRef.current,
  };
}

/** util — mini slugify stable pour id de slot */
function slotIdFromLabel(label: string) {
  return String(label || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Pastilles d'objectifs locales (dérive slots depuis must_have si besoin) */
function ChecklistChipsLocal({
  blockId,
  checklist,
}: {
  blockId: string;
  checklist: Record<string, any> | undefined;
}) {
  const raw = (schemaJson as any)?.[blockId];
  if (!raw) {
    return (
      <div className="text-xs text-gray-500 mt-2">
        Aucun schéma d’objectifs pour ce bloc.
      </div>
    );
  }

  // 1) si le schéma a déjà des slots, on les utilise
  let slots: Array<{ id: string; label: string }> = Array.isArray(raw.slots)
    ? raw.slots
    : [];

  // 2) sinon on dérive des "must_have"
  if (!slots.length && Array.isArray(raw.must_have)) {
    slots = raw.must_have.map((label: string) => ({
      id: slotIdFromLabel(label),
      label,
    }));
  }

  if (!slots.length) {
    return (
      <div className="text-xs text-gray-500 mt-2">
        Aucun objectif exploitable dans ce schéma.
      </div>
    );
  }

  const cl = checklist || {};
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {slots.map((slot) => {
        const st = cl[slot.id]?.status || "missing";
        const cls =
          st === "present"
            ? "bg-green-100 text-green-800 border-green-200"
            : st === "partial"
            ? "bg-amber-100 text-amber-800 border-amber-200"
            : st === "conflict"
            ? "bg-rose-100 text-rose-800 border-rose-200"
            : "bg-gray-100 text-gray-700 border-gray-200";

        return (
          <span
            key={slot.id}
            className={`text-xs px-2 py-1 rounded border ${cls}`}
            title={slot.id}
          >
            {slot.label}
            {st === "present"
              ? " ✓"
              : st === "partial"
              ? " ~"
              : st === "conflict"
              ? " !"
              : " ✗"}
          </span>
        );
      })}
    </div>
  );
}

// --- Helpers jauge (ne remplace rien) ---
function deriveSlotsForBlock(blockId: string) {
  const raw: any = (schemaJson as any)?.[blockId];
  if (!raw) return [];
  if (Array.isArray(raw.slots) && raw.slots.length) return raw.slots;
  if (Array.isArray(raw.must_have)) {
    const slug = (s: string) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);
    return raw.must_have.map((label: string) => ({ id: slug(label), label }));
  }
  return [];
}

function computeProgressLocal(blockId: string, checklist?: Record<string, any>) {
  const slots = deriveSlotsForBlock(blockId);
  if (!slots.length || !checklist) return { pct: 0, present: 0, total: slots.length };
  let score = 0; // present=1, partial=0.5
  for (const s of slots) {
    const st = checklist[s.id]?.status;
    if (st === "present") score += 1;
    else if (st === "partial") score += 0.5;
  }
  const pct = slots.length ? Math.round((score / slots.length) * 100) : 0;
  return { pct, present: Math.round(score), total: slots.length };
}

/* ============================================================
   Cache locale d'analyse (stale-while-revalidate)
   ============================================================ */
type CachedAnalysis = {
  checklist: Record<string, any>;
  progress: number;
  relances: any[];
  hash: string;           // empreinte des données
  updatedAt: number;      // ts ms
};

function hash32(s: string) {
  let h = 2166136261 >>> 0; // FNV-1a-ish simple
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function makeBlockHash(b: any) {
  // Empreinte légère des données qui importent pour l’analyse
  const entriesLite = Array.isArray(b?.entries)
    ? b.entries.map((e: any) => ({ q: e?.q || "", a: e?.a || "" }))
    : [];
  const content = b?.content || "";
  return hash32(JSON.stringify({ entriesLite, content }));
}

function loadCachedAnalysis(blockId: string): CachedAnalysis | null {
  try {
    const raw = localStorage.getItem(`gaps_cache_${blockId}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj as CachedAnalysis;
  } catch {
    return null;
  }
}

function saveCachedAnalysis(blockId: string, data: CachedAnalysis) {
  try {
    localStorage.setItem(`gaps_cache_${blockId}`, JSON.stringify(data));
  } catch {}
}

/* ============================================================
   IMPORT / EXPORT JSON
   ============================================================ */
function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function yyyymmdd_hhmm(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export default function BlocksPage() {
  const router = useRouter();
  const {
    loading,
    blocks,
    setSummary,
    setContent,
    renameBlock,
    clearAll,
    importBlocks,              // ⟵ on l’expose ici
  } = useBlocks();
  const list = useMemo(() => (blocks ? Object.values(blocks) : []), [blocks]);

  const [activeId, setActiveId] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyReset, setBusyReset] = useState(false);

  const active = useMemo<Block | null>(
    () => (activeId && blocks ? (blocks as any)[activeId] ?? null : list[0] ?? null),
    [activeId, blocks, list]
  );

  // -----------------------------------------
  // Sélecteur de bloc (simple)
  // -----------------------------------------
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    setTitleDraft(active?.title ?? "");
  }, [active?.id]); // on reset le draft quand on change de bloc

  // -----------------------------------------
  // Éditeur principal “Mémoire (brut)” — avec historique + autosave
  // -----------------------------------------
  const contentMgr = useUndoManager("", 400);
  const [contentSaveState, setContentSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const contentTimerRef = useRef<number | null>(null);

  // hydrate contenu quand on change de bloc
  useEffect(() => {
    const initial = (active as any)?.content ?? "";
    contentMgr.reset(initial);
    setContentSaveState("idle");
    if (contentTimerRef.current) {
      window.clearTimeout(contentTimerRef.current);
      contentTimerRef.current = null;
    }
  }, [active?.id]);

  // autosave contenu (debounce)
  useEffect(() => {
    if (!active) return;
    const current = contentMgr.value;
    if (current === ((active as any).content ?? "")) return;
    setContentSaveState("saving");
    if (contentTimerRef.current) window.clearTimeout(contentTimerRef.current);
    contentTimerRef.current = window.setTimeout(async () => {
      try {
        await setContent((active as any).id, current);
        setContentSaveState("saved");
        contentMgr.markSaved(current); // aligne le snapshot “enregistré”
        window.setTimeout(() => setContentSaveState("idle"), 800);
      } catch {
        setContentSaveState("idle");
      }
    }, 600) as unknown as number;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentMgr.value, active?.id]);

  // ----- Résumé IA — avec historique -----
  const summaryMgr = useUndoManager("", 400);
  const [summarySaveState, setSummarySaveState] = useState<"idle" | "saving" | "saved">("idle");
  const summaryTimerRef = useRef<number | null>(null);

  // hydrate résumé quand on change de bloc
  useEffect(() => {
    const initial = active?.summary ?? "";
    summaryMgr.reset(initial);
    setSummarySaveState("idle");
    if (summaryTimerRef.current) {
      window.clearTimeout(summaryTimerRef.current);
      summaryTimerRef.current = null;
    }
  }, [active?.id]);

  // autosave résumé (debounce)
  useEffect(() => {
    if (!active) return;
    const current = summaryMgr.value;
    if (current === (active.summary ?? "")) return;
    setSummarySaveState("saving");
    if (summaryTimerRef.current) window.clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = window.setTimeout(async () => {
      try {
        await setSummary(active.id, current);
        setSummarySaveState("saved");
        summaryMgr.markSaved(current);
        window.setTimeout(() => setSummarySaveState("idle"), 800);
      } catch {
        setSummarySaveState("idle");
      }
    }, 600) as unknown as number;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryMgr.value, active?.id]);

  // -----------------------------------------
  // Agent de complétude — local à la page
  // -----------------------------------------
  // on garde une table des checklists par bloc, pour ne pas dépendre du hook
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [relances, setRelances] = useState<Record<string, any[]>>({}); // relances par bloc (optionnel)
  const [lastAnalysisAt, setLastAnalysisAt] = useState<number | null>(null);

  // Hydrate affichage depuis cache quand on change de bloc
  useEffect(() => {
    const b = active as any;
    if (!b?.id) return;

    const cached = loadCachedAnalysis(b.id);
    if (!cached) {
      setChecklists((prev) => ({ ...prev, [b.id]: undefined }));
      setRelances((prev) => ({ ...prev, [b.id]: [] }));
      setLastAnalysisAt(null);
      return;
    }

    const currentHash = makeBlockHash(b);
    if (cached.hash === currentHash) {
      setChecklists((prev) => ({ ...prev, [b.id]: cached.checklist || {} }));
      setRelances((prev) => ({ ...prev, [b.id]: cached.relances || [] }));
      setLastAnalysisAt(cached.updatedAt || null);
    } else {
      // hash différent → invalide la vue pour déclencher auto-analyse
      setChecklists((prev) => ({ ...prev, [b.id]: undefined }));
      setRelances((prev) => ({ ...prev, [b.id]: [] }));
      setLastAnalysisAt(null);
    }
  }, [active?.id]);

  // ⚡ Auto-analyse à l’ouverture/au changement de bloc si pas de cache valide
  useEffect(() => {
    const b = active as any;
    if (!b?.id) return;
    const toAnalyze = checklists[b.id] === undefined; // undefined = pas de cache valide
    if (toAnalyze && !analyzing) {
      analyzeActiveNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, checklists, analyzing]);

  async function analyzeActiveNow() {
    const b = active as any;
    if (!b) return;
    const raw = (schemaJson as any)?.[b.id];
    if (!raw) return;

    // Derive slots ici (mêmes ids que l’UI)
    const slots = Array.isArray(raw.slots) && raw.slots.length
      ? raw.slots
      : Array.isArray(raw.must_have)
        ? raw.must_have.map((label: string) => ({
            id: String(label || "")
              .toLowerCase()
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 64),
            label,
          }))
        : [];

    try {
      setAnalyzing(true);
      const res = await fetch("/api/llm/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: b.id,
          entries: b.entries || [],
          content: b.content || "",       // <— on envoie le récit brut
          schema: raw,
          slots,                          // <— on envoie les slots alignés
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) {
        setChecklists((prev) => ({ ...prev, [b.id]: json.checklist || {} }));
        if (Array.isArray(json.relances)) {
          setRelances((prev) => ({ ...prev, [b.id]: json.relances }));
        }
        // ★ Sauvegarde cache
        const payload = {
          checklist: json.checklist || {},
          progress: typeof json.progress === "number" ? json.progress : 0,
          relances: Array.isArray(json.relances) ? json.relances : [],
          hash: makeBlockHash(b),
          updatedAt: Date.now(),
        } as CachedAnalysis;
        saveCachedAnalysis(b.id, payload);
        setLastAnalysisAt(payload.updatedAt);
      }
    } catch {
      // no-op UI
    } finally {
      setAnalyzing(false);
    }
  }

  const activeChecklist = active ? checklists[(active as any).id] : undefined;
  const activeRelances = active ? relances[(active as any).id] : undefined;

  // ★ Jauge locale (ne remplace rien)
  const progressView = active
    ? computeProgressLocal((active as any).id, activeChecklist)
    : { pct: 0, present: 0, total: 0 };

  // ===== Import / Export =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = () => {
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: blocks || {},
      };
      downloadText(`memosphere-${yyyymmdd_hhmm()}.json`, JSON.stringify(payload, null, 2));
    } catch (e) {
      console.error("[export] error:", e);
      alert("Export impossible.");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset pour permettre ré-import du même fichier
    if (!file) return;
    try {
      const text = await file.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        alert("Fichier invalide (JSON mal formé).");
        return;
      }
      const data = json?.data || json; // tolère export brut
      if (!data || typeof data !== "object") {
        alert("Fichier invalide (pas de champ data).");
        return;
      }
      await importBlocks(data); // remplace les blocs + persiste
      // Invalide le cache d’analyse local (pour toutes les ids présentes)
      try {
        Object.keys(data).forEach((id) => {
          localStorage.removeItem(`gaps_cache_${id}`);
        });
      } catch {}
      alert("Import terminé ✅");
      // force une “réouverture” logique du bloc actif pour ré-hydrater
      setActiveId((prev) => (prev ? "" : prev));
      setTimeout(() => setActiveId((active as any)?.id ?? ""), 0);
    } catch (err) {
      console.error("[import] error:", err);
      alert("Import impossible.");
    }
  };

  if (loading) return <div className="p-6">Chargement…</div>;
  if (!list.length) return <div className="p-6">Aucun bloc.</div>;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/interview")}
            className="text-sm border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
            title="Retourner à l’interview"
          >
            ← Revenir à l’interview
          </button>

          {/* Import / Export */}
          <button
            type="button"
            onClick={handleExport}
            className="text-sm border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
            title="Exporter tous les blocs en JSON"
          >
            Exporter JSON
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            className="text-sm border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
            title="Importer des blocs depuis un JSON"
          >
            Importer JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />

          <h1 className="text-2xl font-semibold ml-2">Blocs</h1>
        </div>

        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="text-sm border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
          title="Réinitialiser tous les blocs"
        >
          Réinitialiser
        </button>
      </header>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-title"
          className="fixed inset-0 bg-black/40 grid place-items-center z-50"
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirmOpen(false); }}
        >
          <div className="bg-white rounded-xl p-5 w-[min(520px,92vw)] shadow-xl">
            <h2 id="reset-title" className="text-lg font-semibold">Réinitialiser tous les blocs ?</h2>
            <p className="text-sm text-gray-600 mt-2">
              Cette action efface les contenus saisis et les brouillons locaux. Elle est <strong>irréversible</strong>.
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={busyReset}
                className="text-sm border rounded-lg px-3 py-2 bg-white hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={async () => {
                  setBusyReset(true);
                  try {
                    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}
                    await clearAll();
                    // vide caches d’analyse
                    try {
                      if (blocks) {
                        Object.keys(blocks).forEach((id) => {
                          localStorage.removeItem(`gaps_cache_${id}`);
                        });
                      }
                    } catch {}
                    setChecklists({});
                    setRelances({});
                    setLastAnalysisAt(null);
                    setConfirmOpen(false);
                  } finally {
                    setBusyReset(false);
                  }
                }}
                disabled={busyReset}
                className="text-sm rounded-lg px-3 py-2 bg-red-600 text-white hover:bg-red-700"
              >
                {busyReset ? 'Réinitialisation…' : 'Oui, tout effacer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sélecteur de bloc */}
      <section className="
        border rounded-xl p-4 bg-white
        flex items-center gap-3
      ">
        <div className="text-xs uppercase tracking-wide text-gray-500">Sélection</div>
        <select
          className="border rounded p-2 text-sm"
          value={(active as any)?.id ?? ""}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {list.map((b: Block) => (
            <option key={(b as any).id} value={(b as any).id}>
              {(b as any).title}
            </option>
          ))}
        </select>
      </section>

      {active && (
        <>
          {/* En-tête : titre éditable */}
          <section className="space-y-2 border rounded-xl p-4 bg-white">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Titre du bloc
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded p-2 text-sm"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
              />
              <button
                className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
                onClick={async () => {
                  const t = (titleDraft || "").trim();
                  if (!t || t === active.title) return;
                  await renameBlock((active as any).id, t);
                }}
              >
                Renommer
              </button>
            </div>
          </section>

          {/* Objectifs du bloc (Agent de complétude) */}
          <section className="space-y-2 border rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Objectifs du bloc
              </div>
              <div className="flex items-center gap-4">
                {lastAnalysisAt && (
                  <div className="text-[11px] text-gray-400">
                    analysé le {new Date(lastAnalysisAt).toLocaleString()}
                  </div>
                )}
                <button
                  className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
                  onClick={analyzeActiveNow}
                  disabled={analyzing}
                >
                  {analyzing ? "Analyse en cours…" : "Analyser maintenant"}
                </button>
                {/* ★ Jauge de complétude */}
                <div className="hidden sm:flex flex-col items-end gap-1 min-w-[160px]">
                  <div className="text-xs text-gray-500">
                    Complétude&nbsp;: <span className="font-medium">{progressView.pct}%</span>
                    {progressView.total > 0 && (
                      <span className="text-gray-400"> &nbsp;({progressView.present}/{progressView.total})</span>
                    )}
                  </div>
                  <div className="w-full h-2 rounded bg-gray-100 overflow-hidden border border-gray-200">
                    <div
                      className="h-2 rounded bg-indigo-500 transition-[width] duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, progressView.pct))}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <ChecklistChipsLocal blockId={(active as any).id} checklist={activeChecklist} />

            {Array.isArray(activeRelances) && activeRelances.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Relances suggérées</div>
                <ul className="mt-1 list-disc list-inside text-sm text-gray-700">
                  {activeRelances.map((r: any, i: number) => (
                    <li key={i}>
                      <span className="font-medium">{r?.question || "…"} </span>
                      <span className="text-xs text-gray-500">
                        {r?.slotId ? `(${r.slotId})` : ""} {typeof r?.priority === "number" ? `• prio ${r.priority}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Résumé (IA) */}
          <section className="space-y-2 border rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Résumé (IA)
              </div>
              <div className="flex items-center gap-2">
                {/* Annuler / Rétablir / Revenir à la version enregistrée */}
                <button
                  className="px-2 py-2 border rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                  onClick={summaryMgr.undo}
                  disabled={!summaryMgr.canUndo()}
                  title="Annuler la dernière modification"
                >
                  ⟲ Annuler
                </button>
                <button
                  className="px-2 py-2 border rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                  onClick={summaryMgr.redo}
                  disabled={!summaryMgr.canRedo()}
                  title="Rétablir"
                >
                  ⟳ Rétablir
                </button>
                <button
                  className="px-2 py-2 border rounded text-sm hover:bg-gray-50"
                  onClick={summaryMgr.revertToSaved}
                  title="Revenir à la dernière version enregistrée"
                >
                  ⏮ Revenir à la version enregistrée
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Génère un résumé court du bloc actif.
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
                  onClick={async () => {
                    try {
                      const txt = await summarizeBlockLLM(active);
                      if (typeof txt === "string") {
                        summaryMgr.reset(txt);
                        await setSummary((active as any).id, txt);
                      }
                    } catch {}
                  }}
                >
                  Résumer via IA
                </button>
                <div className="text-xs">
                  {summarySaveState === "saving" && <span className="text-gray-500">Enregistrement…</span>}
                  {summarySaveState === "saved" && <span className="text-green-600">Enregistré ✓</span>}
                  {summarySaveState === "idle" && <span className="text-gray-400">—</span>}
                </div>
              </div>
            </div>

            <textarea
              className="w-full border rounded p-3 text-sm bg-gray-50"
              rows={6}
              placeholder="Un petit résumé propre, factuel, 3–5 phrases…"
              value={summaryMgr.value}
              onChange={(e) => summaryMgr.onChange(e.target.value)}
            />
          </section>

          {/* Mémoire (brut) */}
          <section className="space-y-2 border rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Mémoire (brut)
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 border rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                  onClick={contentMgr.undo}
                  disabled={!contentMgr.canUndo()}
                  title="Annuler la dernière modification"
                >
                  ⟲ Annuler
                </button>
                <button
                  className="px-2 py-1 border rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                  onClick={contentMgr.redo}
                  disabled={!contentMgr.canRedo()}
                  title="Rétablir"
                >
                  ⟳ Rétablir
                </button>
                <button
                  className="px-2 py-1 border rounded text-xs hover:bg-gray-50"
                  onClick={contentMgr.revertToSaved}
                  title="Revenir à la dernière version enregistrée"
                >
                  ⏮ Version enregistrée
                </button>
                <div className="text-xs ml-2">
                  {contentSaveState === "saving" && <span className="text-gray-500">Enregistrement…</span>}
                  {contentSaveState === "saved" && <span className="text-green-600">Enregistré ✓</span>}
                  {contentSaveState === "idle" && <span className="text-gray-400">—</span>}
                </div>
              </div>
            </div>

            <textarea
              className="w-full border rounded p-3 text-sm bg-gray-50"
              rows={12}
              placeholder="Édite librement le récit du bloc…"
              value={contentMgr.value}
              onChange={(e) => contentMgr.onChange(e.target.value)}
            />
          </section>

          {/* Historique Q/R (compat) */}
          <section className="space-y-2 border rounded-xl p-4 bg-white">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Historique (Q/R)
            </div>
            {!active.entries?.length ? (
              <p className="text-sm text-gray-500">Aucune entrée.</p>
            ) : (
              <ul className="space-y-2">
                {active.entries.map((e: Entry, idx: number) => (
                  <li key={idx} className="bg-gray-50 border rounded p-2">
                    {e.type === "texte" && (
                      <div className="text-xs text-gray-700">
                        <div><span className="font-medium">Q:&nbsp;</span>{(e as any).q}</div>
                        <div><span className="font-medium">A:&nbsp;</span>{(e as any).a}</div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
