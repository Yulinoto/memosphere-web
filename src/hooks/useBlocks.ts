// src/hooks/useBlocks.ts
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { BlocksState, Entry, Block } from "@/data/blocks";
import { loadBlocks, saveBlocks, resetBlocks } from "@/lib/storage";

/** Heuristique simple pour le % d'avancement (améliorable plus tard) */
function recomputeProgress(entriesLen: number) {
  return Math.min(100, Math.round((entriesLen / 6) * 100));
}

/** Normalise un bloc importé pour éviter les surprises */
function sanitizeBlock(raw: any): Block {
  const id = String(raw?.id ?? "");
  const title = String((raw?.title ?? id) || "Sans titre");

  const entries: Entry[] = Array.isArray(raw?.entries) ? raw.entries : [];
  const progress =
    typeof raw?.progress === "number" ? raw.progress : recomputeProgress(entries.length);

  const summary =
    typeof raw?.summary === "string" || raw?.summary === null ? raw.summary : null;

  const pinnedQuestions = Array.isArray(raw?.pinnedQuestions)
    ? raw.pinnedQuestions.map((x: any) => String(x))
    : undefined;

  // Important : content doit toujours être une string
  const content =
    typeof raw?.content === "string" ? raw.content : "";

  return { id, title, progress, entries, summary, pinnedQuestions, content };
}

/** Normalise tout l'état importé */
function sanitizeState(raw: any): BlocksState {
  const out: BlocksState = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(raw)) {
    const sb = sanitizeBlock(raw[key]);
    if (sb.id) out[sb.id] = sb;
  }
  return out;
}

export function useBlocks() {
  const [blocks, setBlocks] = useState<BlocksState | null>(null);
  const [loading, setLoading] = useState(true);

  /** Chaîne de sauvegarde pour sérialiser les writes (évite les collisions IndexedDB) */
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  /** Programme une sauvegarde (sérialisée) */
  const scheduleSave = useCallback((stateToSave: BlocksState) => {
    saveChainRef.current = saveChainRef.current
      .then(() => saveBlocks(stateToSave))
      .catch((e) => {
        console.error("[storage] save error:", e);
      });
  }, []);

  // Init
  useEffect(() => {
    (async () => {
      const loaded = await loadBlocks();
      const sane = sanitizeState(loaded); // migration
      setBlocks(sane);
      scheduleSave(sane); // re-persist propre
      setLoading(false);
    })();
  }, [scheduleSave]);

  // --- Actions publiques ---

  /** Q/R classique (compat) */
  const addTextEntry = useCallback(
    async (blockId: string, q: string, a: string) => {
      setBlocks((prev) => {
        if (!prev) return prev;
        const block = prev[blockId];
        if (!block) return prev;

        const entry: Entry = { type: "texte", q, a, ts: Date.now() };
        const entries = [...block.entries, entry];
        const progress = recomputeProgress(entries.length);

        const next: BlocksState = {
          ...prev,
          [blockId]: { ...block, entries, progress },
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  /** Append narratif + (optionnel) log Q/R */
  const appendNarrative = useCallback(
    async (blockId: string, text: string, meta?: { q?: string }) => {
      const trimmed = (text ?? "").trim();
      if (!trimmed) return;

      setBlocks((prev) => {
        if (!prev) return prev;
        const block = prev[blockId];
        if (!block) return prev;

        const oldContent = typeof block.content === "string" ? block.content : "";
        const sep = oldContent.trim() ? "\n\n" : "";
        const content = oldContent + sep + trimmed;

        let entries = block.entries;
        if (meta?.q) {
          const entry: Entry = { type: "texte", q: meta.q, a: trimmed, ts: Date.now() };
          entries = [...entries, entry];
        }

        const progress = recomputeProgress(entries.length);

        const next: BlocksState = {
          ...prev,
          [blockId]: { ...block, content, entries, progress },
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  /** Écrase entièrement le contenu narratif du bloc (éditeur texte) */
  const setContent = useCallback(
    async (blockId: string, content: string) => {
      setBlocks((prev) => {
        if (!prev) return prev;
        const block = prev[blockId];
        if (!block) return prev;

        const next: BlocksState = {
          ...prev,
          [blockId]: { ...block, content: String(content ?? "") },
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  /** Résumé IA */
  const setSummary = useCallback(
    async (blockId: string, summary: string) => {
      setBlocks((prev) => {
        if (!prev) return prev;
        const block = prev[blockId];
        if (!block) return prev;
        const next: BlocksState = {
          ...prev,
          [blockId]: { ...block, summary },
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  /** Renommer un bloc */
  const renameBlock = useCallback(
    async (blockId: string, title: string) => {
      setBlocks((prev) => {
        if (!prev) return prev;
        const block = prev[blockId];
        if (!block) return prev;

        const next: BlocksState = {
          ...prev,
          [blockId]: { ...block, title: String(title || block.title) },
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  /** Réinitialisation complète */
  const clearAll = useCallback(async () => {
    const fresh = await resetBlocks();
    const sane = sanitizeState(fresh);
    setBlocks(sane);
    scheduleSave(sane);
  }, [scheduleSave]);

  /** Import JSON → remplace tout l'état + persiste */
  const importBlocks = useCallback(async (raw: unknown) => {
    const next = sanitizeState(raw);
    setBlocks(next);
    scheduleSave(next);
  }, [scheduleSave]);

  return {
    loading,
    blocks,            // Record<string, Block>
    addTextEntry,      // (blockId, q, a)
    appendNarrative,   // (blockId, text, {q?})
    setContent,        // (blockId, content)  <-- NOUVEAU
    setSummary,        // (blockId, summary)
    renameBlock,       // (blockId, title)
    clearAll,          // reset vers DEFAULT_BLOCKS
    importBlocks,      // import JSON (remplacement complet)
  };
}
