// src/app/api/llm/commit/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, fields_to_update = {}, locks_update = {} } = body || {};

    // TODO: remplace par ta vraie persistence
    // Exemple pseudo:
    // await db.profile.update(sessionId, fields_to_update);
    // await db.profile.updateLocks(sessionId, locks_update);

    return NextResponse.json({ ok: true, applied: { fields_to_update, locks_update } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Commit error" }, { status: 500 });
  }
}
