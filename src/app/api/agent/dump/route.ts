import { NextRequest, NextResponse } from "next/server";
import {
  // expose seulement des getters sans casser ton encapsulation
  getSectionProfile,
  sectionPhase,
} from "@/server/llm/providers/agentsdk";

export const runtime = "nodejs";

/**
 * GET /api/agent/dump?sessionId=...&sectionId=...
 * -> retourne { phase, profile }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId") || "";
    const sectionId = searchParams.get("sectionId") || "";
    if (!sessionId || !sectionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId or sectionId" },
        { status: 400 }
      );
    }

    const phase = sectionPhase(sessionId, sectionId);            // "must" | "good" | "done"
    const profile = getSectionProfile(sessionId, sectionId) || {}; // données agent pour cette section

    return NextResponse.json({ ok: true, phase, profile });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "dump error" }, { status: 500 });
  }
}
