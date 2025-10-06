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

const AGENT_OWNS = String(process.env.NEXT_PUBLIC_AGENT_OWNS_VALIDATION || "").toLowerCase() === "true";

export function useCompleteness() {
  const cacheRef = useRef<Map<string, GapResult>>(new Map());

  const getLocalScore = useCallback((block: Block | null | undefined) => {
    if (AGENT_OWNS) return 0; // neutralisé si l'agent gère
    if (!block) return 0;
    const spec: any = (schema as any)[block.id];
    if (!spec) return Math.min(100, Math.round((block.entries.length / 6) * 100));
    const must: string[] = spec.must_have || [];
    const good: string[] = spec.good_to_have || [];

    const text = block.entries
      .map((e) => (("a" in e ? (e as any).a : "") + " " + ("q" in e ? (e as any).q : "")))
      .join("\n")
      .toLowerCase();

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

    if (AGENT_OWNS) {
      // On passe par /api/llm/gaps qui délègue à l'agent
      try {
        const res = await fetch("/api/llm/gaps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blockId,
            entries: entries.map((e) => ({ q: (e as any).q || "", a: (e as any).a || "" })),
            lastAnswer: lastAnswer || ""
          })
        });
        const json = await res.json().catch(() => ({}));
        const out: GapResult = {
          ok: !!json?.ok,
          score: typeof json?.score === "number" ? json.score : 0,
          missing: Array.isArray(json?.missing) ? json.missing : [],
          follow_up: typeof json?.follow_up === "string" ? json.follow_up : "",
          error: json?.error
        };
        cacheRef.current.set(key, out);
        return out;
      } catch (e: any) {
        const out: GapResult = { ok: false, error: e?.message || "Erreur réseau gaps" };
        cacheRef.current.set(key, out);
        return out;
      }
    }

    // Chemin legacy (si jamais tu veux tester sans agent)
    try {
      const res = await fetch("/api/llm/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          entries: entries.map((e) => ({ q: (e as any).q || "", a: (e as any).a || "" })),
          lastAnswer: lastAnswer || ""
        })
      });
      const json = await res.json().catch(() => ({}));
      const out: GapResult = {
        ok: !!json?.ok,
        score: typeof json?.score === "number" ? json.score : 0,
        missing: Array.isArray(json?.missing) ? json.missing : [],
        follow_up: typeof json?.follow_up === "string" ? json.follow_up : "",
        error: json?.error
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
