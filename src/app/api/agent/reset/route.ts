import { NextRequest, NextResponse } from "next/server";
import { resetAgentSession } from "@/server/llm/providers/agentsdk";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json().catch(() => ({}));
    resetAgentSession(typeof sessionId === "string" ? sessionId : undefined);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "reset error" }, { status: 500 });
  }
}
