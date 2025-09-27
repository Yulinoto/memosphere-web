// src/hooks/useBlocks.ts
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { BlocksState, Entry, Block } from "@/data/blocks";
import { loadBlocks, saveBlocks, resetBlocks } from "@/lib/storage";
import schemaJson from "@/data/interviewSchema.json";

/** Pondération simple */
function cov(status: "present" | "partial" | "missing" | "conflict") {
  if (status === "present") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

/** Recalc progress basé sur la checklist si dispo; sinon fallback nb entrées */
function recomputeProgress(block: Block): number {
  if ((block as any).checklist && Object.keys((block as any).checklist).length) {
    const blkSchema: any = (schemaJson as any)[block.id];
    if (!blkSchema || !Array.isArray(blkSchema.slots)) return 0;
    let wsum = 0, got = 0;
    for (const s of blkSchema.slots) {
      const w = Number(s.weight) || 1;
      wsum += w;
      const st = (block as any).checklist?.[s.id]?.status ?? "missing";
      got += w * cov(st);
    }
    if (!wsum) return 0;
    return Math.max(0, Math.min(100, Math.round((got / wsum) * 100)));
  }
  return Math.min(100, Math.round((block.entries.length / 6) * 100));
}

/** Sanitize block */
function sanitizeBlock(raw: any): Block {
  const id = String(raw?.id ?? "");
  const title = String((raw?.title ?? id) || "Sans titre");
  const entries: Entry[] = Array.isArray(raw?.entries) ? raw.entries : [];
  const summary = typeof raw?.summary === "string" || raw?.summary === null ? raw.summary : null;
  const pinnedQuestions = Array.isArray(raw?.pinnedQuestions)
    ? raw.pinnedQuestions.map((x: any) => String(x))
    : undefined;
  const content = typeof raw?.content === "string" ? raw.content : "";
  const checklist = raw?.checklist && typeof raw.checklist === "object" ? raw.checklist : undefined;

  const draft: Block = { id, title, progress: 0, entries, summary, pinnedQuestions } as any;
  (draft as any).content = content;
  (draft as any).checklist = checklist;
  draft.progress = recomputeProgress(draft);
  return draft;
}

/** Sanitize state */
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
  const blocksRef = useRef<BlocksState | null>(null);

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

  useEffect(() => {
    (async () => {
      const b = await loadBlocks();
      const fixed: BlocksState = {};
      for (const id of Object.keys(b)) fixed[id] = sanitizeBlock(b[id]);
      setBlocks(fixed);
      blocksRef.current = fixed;
      setLoading(false);
    })();
  }, []);

  /** persist — race-safe */
  const persist = useCallback(
    async (updater: (prev: BlocksState) => BlocksState) => {
      setBlocks(prev => {
        const base = (prev ?? {}) as BlocksState;
        const next = updater(base);
        blocksRef.current = next;
        saveBlocks(next).catch(() => {});
        return next;
      });
    },
    []
  );

  const addTextEntry = useCallback(
    async (blockId: string, q: string, a: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;
        const entry: Entry = { type: "texte", q, a, ts: Date.now() };
        const entries = [...block.entries, entry];
        const tmp: Block = { ...block, entries };
        tmp.progress = recomputeProgress(tmp);
        b[blockId] = tmp;
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

  const setContent = useCallback(
    async (blockId: string, content: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block: any = b[blockId];
        if (!block) return prev;
        const next: any = { ...block, content };
        next.progress = recomputeProgress(next as Block);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );

  const renameBlock = useCallback(
    async (blockId: string, title: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;
        b[blockId] = { ...block, title };
        return b;
      });
    },
    [persist]
  );

  const clearAll = useCallback(async () => {
    const fresh = await resetBlocks();
    const fixed: BlocksState = {};
    for (const id of Object.keys(fresh)) fixed[id] = sanitizeBlock(fresh[id]);
    setBlocks(fixed);
    blocksRef.current = fixed;
  }, []);

  const importBlocks = useCallback(async (raw: unknown) => {
    const next = sanitizeState(raw);
    setBlocks(next);
    blocksRef.current = next;
    await saveBlocks(next);
  }, []);

  const updateChecklist = useCallback(
    async (blockId: string, checklist: Record<string, { status: "present" | "partial" | "missing" | "conflict"; confidence: number; evidenceEntryIdx?: number[] }>) => {
      await persist((prev) => {
        const b = { ...prev };
        const block: any = b[blockId];
        if (!block) return prev;
        const next: any = { ...block, checklist };
        next.progress = recomputeProgress(next as Block);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );

  const analyzeNow = useCallback(async (blockId: string) => {
    const snap = blocksRef.current;
    if (!snap) return;
    const block = snap[blockId];
    if (!block) return;
    const blkSchema: any = (schemaJson as any)[block.id];
    if (!blkSchema) return;

    try {
      const res = await fetch("/api/llm/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: block.id,
          entries: block.entries,
          schema: blkSchema,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) return;
      await updateChecklist(block.id, json.checklist || {});
    } catch (e) {
      console.warn("gaps analyze failed:", e);
    }
  }, [updateChecklist]);

  return {
    loading,
    blocks,
    addTextEntry,
    setSummary,
    setContent,
    renameBlock,
    clearAll,
    importBlocks,
    updateChecklist,
    analyzeNow,
  };
}
