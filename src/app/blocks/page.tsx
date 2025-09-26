// src/app/blocks/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocks } from "@/hooks/useBlocks";
import type { Block, Entry } from "@/data/blocks";
import { summarizeBlockLLM } from "@/lib/summarize";

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

export default function BlocksPage() {
  const { loading, blocks, setSummary, setContent, renameBlock, clearAll } = useBlocks();
  const list = useMemo(() => (blocks ? Object.values(blocks) : []), [blocks]);

  const [activeId, setActiveId] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyReset, setBusyReset] = useState(false);

  const active = useMemo<Block | null>(
    () => (activeId && blocks ? blocks[activeId] ?? null : list[0] ?? null),
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
    const initial = active?.content ?? "";
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
    if (current === (active.content ?? "")) return;
    setContentSaveState("saving");
    if (contentTimerRef.current) window.clearTimeout(contentTimerRef.current);
    contentTimerRef.current = window.setTimeout(async () => {
      try {
        await setContent(active.id, current);
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

  if (loading) return <div className="p-6">Chargement…</div>;
  if (!list.length) return <div className="p-6">Aucun bloc.</div>;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Blocs</h1>
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
          value={active?.id ?? ""}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {list.map((b: Block) => (
            <option key={b.id} value={b.id}>
              {b.title}
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
                  await renameBlock(active.id, t);
                }}
              >
                Renommer
              </button>
            </div>
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
                        await setSummary(active.id, txt);
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
