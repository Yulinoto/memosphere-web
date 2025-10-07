import { NextRequest, NextResponse } from "next/server";
import {
  runInterviewTurn,
  consumeLastPatch,
  sectionPhase, // "must" | "good" | "done"
} from "@/server/llm/providers/agentsdk";

export const runtime = "nodejs";

function looksLikeQuestion(s: string) {
  const t = (s || "").trim();
  return !!t && /\?\s*$/.test(t);
}

export async function POST(req: NextRequest) {
  let sid = "unknown";
  let sec = "unknown";
  try {
    const body = await req.json().catch(() => ({}));
    const { message = "", sessionId, sectionId, depthBudget } = body || {};

    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "Missing sessionId (string)" }, { status: 400 });
    }
    if (typeof sectionId !== "string" || !sectionId) {
      return NextResponse.json({ error: "Missing sectionId (string)" }, { status: 400 });
    }

    sid = String(sessionId);
    sec = String(sectionId);

    console.log("[AGENT IN]", {
      sid,
      sec,
      message: String(message).slice(0, 200),
      depthBudget,
    });

    // --- Appel principal (on passe depthBudget SANS casser la signature existante)
    // Si runInterviewTurn supporte un 4e argument, il sera utilisé ; sinon il sera ignoré.
    const firstTurn: any = await (runInterviewTurn as any)(message, sid, sec, { depthBudget });
    let say: string = firstTurn?.say ?? "";
    let patch = consumeLastPatch(sid, sec);
    let phase = sectionPhase(sid, sec); // "must" | "good" | "done"
    let done = phase === "done";

    // “question guarantee”
    let safety = 2;
    while (!done && !looksLikeQuestion(say) && safety > 0) {
      const again: any = await (runInterviewTurn as any)("", sid, sec, { depthBudget });
      say = again?.say ?? "";

      const extraPatch = consumeLastPatch(sid, sec);
      if (extraPatch && typeof extraPatch === "object") {
        patch = { ...(patch || {}), ...extraPatch };
      }

      phase = sectionPhase(sid, sec);
      done = phase === "done";
      safety--;
    }

    // NOTE: si plus tard ton agent renvoie des follow-ups additionnels,
    // tu pourras les mettre dans 'extra'. Pour l’instant on renvoie un tableau vide.
    const extra: string[] = Array.isArray(firstTurn?.extra)
      ? (firstTurn.extra as string[]).slice(0, 2)
      : [];

    console.log("[AGENT OUT]", {
      sid,
      sec,
      phase,
      say: String(say).slice(0, 200),
      done,
      patchKeys: patch ? Object.keys(patch) : [],
    });

    return NextResponse.json(
      { say, done, phase, patch },
      {
        headers: {
          "x-agent-session": sid,
          "x-agent-section": sec,
        },
      }
    );
  } catch (e: any) {
    console.error("AGENT ERR", { sid, sec, err: e?.message, stack: e?.stack });
    return NextResponse.json(
      { error: e?.message || "Erreur Agent SDK", stack: e?.stack || "" },
      { status: 500 }
    );
  }
}
