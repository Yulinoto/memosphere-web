// src/app/api/llm/conflicts/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";

import { validateAndPropose } from "@/server/llm/providers/interviewValidator";

type Strictness = "strict" | "normal" | "lenient";

type Conflict = {
  id: string;
  type: "fact_conflict" | "temporal_conflict" | "soft_conflict";
  slotId?: string;
  severity: "low" | "med" | "high";
  explanation: string;
  relances: string[];
  evidenceEntryIdx: number[];
  createdAt: number;
  confidence?: number;
};

function mapAgentConflicts(agentConflicts: Array<{ field: string; old: string; new: string; reason: string }> | undefined): Conflict[] {
  if (!Array.isArray(agentConflicts)) return [];
  return agentConflicts.map((c) => ({
    id: `${c.field}:${c.old ?? ""}->${c.new ?? ""}`.slice(0, 120),
    type: "fact_conflict",
    slotId: c.field || undefined,
    severity: "med",
    explanation: c.reason || "Conflit détecté",
    relances: [],               // l’UI saura demander via follow_up si besoin
    evidenceEntryIdx: [],       // non déterminé ici
    createdAt: Date.now(),
    confidence: 0.8,
  }));
}

function clampByStrictness(conflicts: Conflict[], strictness: Strictness) {
  const cfg = strictness === "strict"
    ? { minConf: 0.7, max: 3 }
    : strictness === "lenient"
      ? { minConf: 0.5, max: 8 }
      : { minConf: 0.6, max: 5 };
  const filtered = conflicts.filter(c => (c.confidence ?? 1) >= cfg.minConf);
  return filtered.slice(0, cfg.max);
}

/**
 * INPUT body:
 *   { blockId: string, lastAnswer?: string, canonical?: object, locks?: object, strictness?: "strict"|"normal"|"lenient" }
 *
 * OUTPUT:
 *   { ok: true, blockId, strictness, conflicts: Conflict[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const blockId: string = body.blockId;
    const strictness: Strictness = ["strict","normal","lenient"].includes(body.strictness) ? body.strictness : "normal";

    if (!blockId) {
      return NextResponse.json({ ok: false, error: "Missing blockId" }, { status: 400 });
    }

    const canonical = (typeof body.canonical === "object" && body.canonical) ? body.canonical : {};
    const locks = (typeof body.locks === "object" && body.locks) ? body.locks : {};
    const lastAnswer = typeof body.lastAnswer === "string" ? body.lastAnswer : "";

    // → L’agent détecte déjà les conflits dans sa sortie
    const r = await validateAndPropose({
      canonical,
      locks,
      section: blockId,
      lastAnswer
    });

    let conflicts = mapAgentConflicts(r.conflicts);
    conflicts = clampByStrictness(conflicts, strictness);

    return NextResponse.json({ ok: true, blockId, strictness, conflicts }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: true, blockId: "", strictness: "normal", conflicts: [] }, { status: 200 });
  }
}
