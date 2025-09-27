// src/hooks/useCompleteness.ts
"use client";

import { useCallback, useRef } from "react";
import type { Block, Entry } from "@/data/blocks";
import schema from "@/data/interviewSchema.json";

type GapResult = {
  ok: boolean;
  score?: number;
  missing?: string[];
  follow_up?: string;
  error?: string;
};

export function useCompleteness() {
  const cacheRef = useRef<Map<string, GapResult>>(new Map());

  const getLocalScore = useCallback((block: Block | null | undefined) => {
    if (!block) return 0;
    const spec: any = (schema as any)[block.id];
    if (!spec) return Math.min(100, Math.round((block.entries.length / 6) * 100));
    const must: string[] = spec.must_have || [];
    const good: string[] = spec.good_to_have || [];

    const text = block.entries
      .map((e) => (("a" in e ? (e as any).a : "") + " " + ("q" in e ? (e as any).q : "")))
      .join("\n")
      .toLowerCase();

    // Heuristique bête: matching naïf par mots-clés (à améliorer si tu veux)
    const hit = (label: string) => {
      const k = label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      return k.length ? k.some((w) => text.includes(w)) : false;
    };

    const mustHits = must.filter(hit).length;
    const goodHits = good.filter(hit).length;

    const mustScore = must.length ? (mustHits / must.length) : 1;
    const goodScore = good.length ? (goodHits / Math.max(1, good.length)) : 0;

    const score = Math.round((mustScore * 0.8 + goodScore * 0.2) * 100);
    return Math.max(0, Math.min(100, score));
  }, []);

  const analyzeGaps = useCallback(async (blockId: string, entries: Entry[], lastAnswer?: string): Promise<GapResult> => {
    const key = `${blockId}::${entries.length}`;
    if (cacheRef.current.has(key)) {
      return cacheRef.current.get(key)!;
    }

    const payload = {
      blockId,
      entries: entries
        .map((e) => ({
          q: "q" in e ? (e as any).q : "",
          a: "a" in e ? (e as any).a : ""
        })),
      lastAnswer: lastAnswer || ""
    };

    try {
      const res = await fetch("/api/llm/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const out: GapResult = { ok: false, error: json?.error || "Erreur gaps" };
        cacheRef.current.set(key, out);
        return out;
      }
      const out: GapResult = {
        ok: true,
        score: json.score ?? 0,
        missing: Array.isArray(json.missing) ? json.missing : [],
        follow_up: typeof json.follow_up === "string" ? json.follow_up : ""
      };
      cacheRef.current.set(key, out);
      return out;
    } catch (e: any) {
      const out: GapResult = { ok: false, error: e?.message || "Erreur réseau gaps" };
      cacheRef.current.set(key, out);
      return out;
    }
  }, []);

  return { getLocalScore, analyzeGaps };
}
