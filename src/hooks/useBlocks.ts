// src/hooks/useBlocks.ts
"use client";

import { useEffect, useState, useCallback } from "react";
import type { BlocksState, Entry, Block } from "@/data/blocks";
import { loadBlocks, saveBlocks, resetBlocks } from "@/lib/storage";

/** Heuristique simple pour le % d'avancement */
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

  const content =
    typeof raw?.content === "string" ? raw.content : undefined;

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

const EVT = "blocks:changed";

export function useBlocks() {
  const [blocks, setBlocks] = useState<BlocksState | null>(null);
  const [loading, setLoading] = useState(true);

  // Init
  useEffect(() => {
    (async () => {
      const b = await loadBlocks();
      setBlocks(b);
      setLoading(false);
    })();

    // 🔔 écoute les mises à jour cross-pages
    const onRefresh = async () => {
      const fresh = await loadBlocks();
      setBlocks(fresh);
    };
    window.addEventListener(EVT, onRefresh);
    window.addEventListener("storage", onRefresh);
    return () => {
      window.removeEventListener(EVT, onRefresh);
      window.removeEventListener("storage", onRefresh);
    };
  }, []);

  // Persistance + broadcast
  const persist = useCallback(
    async (updater: (prev: BlocksState) => BlocksState) => {
      if (!blocks) return;
      const next = updater(blocks);
      setBlocks(next);
      await saveBlocks(next);
      // 🔔 notifie les autres hooks ouverts
      window.dispatchEvent(new Event(EVT));
    },
    [blocks]
  );

  /** Nouveau : ajoute du texte reformulé dans le champ narratif du bloc */
  const appendNarrative = useCallback(
  async (blockId: string, text: string, opts?: { q?: string }) => {
    await persist((prev) => {
      const b = { ...prev };
      const block = b[blockId];
      if (!block) return prev;

      const clean = String(text ?? "").trim();
      if (!clean) return prev;

      // 1) Mémoire narrative (content)
      const sep = block.content && block.content.trim().length ? "\n\n" : "";
      const content = (block.content ?? "") + sep + clean;

      // 2) Compat historique: on pousse aussi une entrée Q/R synthétique
      //    (pour la page Blocks et le progress basé sur entries.length)
      const q = (opts?.q ?? "").trim();
      const compatEntry: Entry = {
        type: "texte",
        q: q || "Réponse",
        a: clean,
        ts: Date.now(),
      };
      const entries = [...(block.entries ?? []), compatEntry];

      const progress = Math.min(100, Math.round((entries.length / 6) * 100)); // même heuristique

      b[blockId] = {
        ...block,
        content,
        entries,
        progress,
      };
      return b;
    });
  },
  [persist]
);


  /** Compat Q/R — conserve l’historique et pousse aussi dans content */
  const addTextEntry = useCallback(
    async (blockId: string, q: string, a: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;

        const entry: Entry = { type: "texte", q, a, ts: Date.now() };
        const entries = [...(block.entries ?? []), entry];
        const progress = recomputeProgress(entries.length);

        const sep = block.content && block.content.trim().length ? "\n\n" : "";
        const content = (block.content ?? "") + (a?.trim() ? sep + a.trim() : "");

        b[blockId] = { ...block, entries, progress, content };
        return b;
      });
    },
    [persist]
  );

  const setSummary = useCallback(
    async (blockId: string, summary: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;
        b[blockId] = { ...block, summary };
        return b;
      });
    },
    [persist]
  );

  const clearAll = useCallback(async () => {
    const fresh = await resetBlocks();
    setBlocks(fresh);
    window.dispatchEvent(new Event(EVT));
  }, []);

  const importBlocks = useCallback(async (raw: unknown) => {
    const next = sanitizeState(raw);
    setBlocks(next);
    await saveBlocks(next);
    window.dispatchEvent(new Event(EVT));
  }, []);

  return {
    loading,
    blocks,
    appendNarrative,
    addTextEntry,
    setSummary,
    clearAll,
    importBlocks,
  };
}
