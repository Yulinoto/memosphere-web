// src/app/api/llm/gaps/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";

import { validateAndPropose } from "@/server/llm/providers/interviewValidator";

type Entry = { q?: string; a?: string; ts?: number };

function pickLastAnswer(entries: Entry[], fallback?: string) {
  if (typeof fallback === "string" && fallback.trim()) return fallback;
  for (let i = entries.length - 1; i >= 0; i--) {
    const a = entries[i]?.a;
    if (typeof a === "string" && a.trim()) return a;
  }
  return "";
}

/**
 * INPUT body:
 *   { blockId: string, entries?: Entry[], lastAnswer?: string, canonical?: object, locks?: object }
 *
 * OUTPUT (stable pour le front):
 *   { ok: true, score?: number, missing?: string[], follow_up?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const blockId: string = body.blockId;
    const entries: Entry[] = Array.isArray(body.entries) ? body.entries : [];
    const lastAnswer: string = pickLastAnswer(entries, body.lastAnswer);
    const canonical = (typeof body.canonical === "object" && body.canonical) ? body.canonical : {};
    const locks = (typeof body.locks === "object" && body.locks) ? body.locks : {};

    if (!blockId) {
      return NextResponse.json({ ok: false, error: "Missing blockId" }, { status: 400 });
    }

    // → Appel unique à l'agent (source de vérité)
    const r = await validateAndPropose({
      canonical,
      locks,
      section: blockId,
      lastAnswer
    });

    // Score minimaliste pour compat: 100 si rien manque/conflict, sinon 60 (juste indicatif)
    const hasIssues = (r.missing?.length ?? 0) > 0 || (r.conflicts?.length ?? 0) > 0;
    const score = hasIssues ? 60 : 100;

    return NextResponse.json({
      ok: true,
      score,
      missing: Array.isArray(r.missing) ? r.missing : [],
      follow_up: typeof r.followup === "string" ? r.followup : ""
    });
  } catch (e: any) {
    // Fallback safe: pas d'explosion côté UI
    return NextResponse.json({ ok: true, score: 0, missing: [], follow_up: "" });
  }
}
