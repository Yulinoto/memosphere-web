import { NextRequest, NextResponse } from "next/server";
import {
  runInterviewTurn,
  consumeLastPatch,
  sectionPhase, // "must" | "good" | "done"
  getSectionProfile,
} from "@/server/llm/providers/agentsdk";

export const runtime = "nodejs";

function looksLikeQuestion(s: string) {
  const t = (s || "").trim();
  return !!t && /\?\s*$/.test(t);
}

// 🔧 wrapper contextualisé pour le mode interview guidé
async function contextualRunInterviewTurn(
  message: string,
  sid: string,
  sec: string,
  context: string,
  profile: Record<string, string>,
  options: { depthBudget?: number }
) {
  const sysPrompt = `
Tu es un agent d'interview biographique.
Voici les données déjà connues de l'utilisateur :
${JSON.stringify(profile, null, 2)}

Voici ce qu’il a déjà raconté :
${context}

Pose une **nouvelle question utile**, sans répétition.
Si tout semble complet, invite à approfondir ou partager une anecdote.
`.trim();

  const firstMsg = message && message.trim().length > 0 ? message : sysPrompt;
  return await (runInterviewTurn as any)(firstMsg, sid, sec, options);
}

export async function POST(req: NextRequest) {
  let sid = "unknown";
  let sec = "unknown";

  try {
    const body = await req.json().catch(() => ({}));
    const { message = "", sessionId, sectionId, depthBudget, profile = {}, mode, avoidSchema } =
      body || {};

    if (!sessionId || typeof sessionId !== "string")
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    if (!sectionId || typeof sectionId !== "string")
      return NextResponse.json({ error: "Missing sectionId" }, { status: 400 });

    sid = sessionId;
    sec = sectionId;

    // --- 1️⃣ Mode libre : si demandé par le client
    const isFree =
      req.headers.get("x-free-mode") === "1" ||
      mode === "free" ||
      avoidSchema === true;

    if (isFree) {
  console.log("[AGENT MODE] Free chat detected for", sec);
  const secFree = `${sec}::free`;

  // 🔥 Ajout d’un prompt système pour le ton narratif
  const sysPrompt = `
Tu n'es pas en mode interview.
Tu es un compagnon d'écriture biographique.
Réponds de manière naturelle, empathique, humaine, sans évoquer de "champs" ni de "sections".
Si l'utilisateur partage une idée, approfondis-la en posant une question douce ou en reformulant pour l'encourager à raconter un souvenir précis.
Évite tout vocabulaire technique ou administratif.
  `.trim();

  const enrichedMessage = message
    ? `${sysPrompt}\n\nL'utilisateur vient de dire : ${message}`
    : sysPrompt;

  const firstTurn: any = await (runInterviewTurn as any)(enrichedMessage, sid, secFree, {
    depthBudget,
    mode: "free",
    avoidSchema: true,
    noTemplates: true,
    nudge: "deepen",
  });

  const say: string = String(firstTurn?.say ?? "").trim();

  return NextResponse.json(
    { say, done: false, phase: "free", patch: null },
    { headers: { "x-agent-session": sid, "x-agent-section": secFree } }
  );
}


    // --- 2️⃣ Mode guidé avec profil et contexte enrichi
    const context = body?.context ?? "";

    console.log("[AGENT IN]", {
      sid,
      sec,
      message: String(message).slice(0, 200),
      depthBudget,
      profileKeys: Object.keys(profile || {}),
      contextPreview: String(context).slice(0, 80) + "...",
    });

    // stocker les infos profil côté agent
    if (profile && typeof profile === "object") {
      try {
        const store = getSectionProfile(sid, sec);
        Object.assign(store, profile);
      } catch {}
    }

    const firstTurn: any = await contextualRunInterviewTurn(
      message,
      sid,
      sec,
      context,
      profile,
      { depthBudget }
    );

    let say: string = firstTurn?.say ?? "";
    let patch = consumeLastPatch(sid, sec);
    let phase = sectionPhase(sid, sec);
    let done = phase === "done";

    let safety = 2;
    while (!done && !looksLikeQuestion(say) && safety > 0) {
      const again: any = await contextualRunInterviewTurn("", sid, sec, context, profile, {
        depthBudget,
      });
      say = again?.say ?? "";

      const extraPatch = consumeLastPatch(sid, sec);
      if (extraPatch && typeof extraPatch === "object") {
        patch = { ...(patch || {}), ...extraPatch };
      }

      phase = sectionPhase(sid, sec);
      done = phase === "done";
      safety--;
    }

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
