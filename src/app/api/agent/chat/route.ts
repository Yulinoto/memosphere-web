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

// 🔧 Nouveau : wrapper qui enrichit le prompt avec profil + contexte
async function contextualRunInterviewTurn(
  message: string,
  sid: string,
  sec: string,
  context: string,
  profile: Record<string, string>,
  options: { depthBudget?: number }
) {
  // On construit un prompt système avec profil et contexte
  const sysPrompt = `
Tu es un agent d'interview biographique.
Voici les données déjà connues de l'utilisateur (profil structuré) :
${JSON.stringify(profile, null, 2)}

Voici ce qu’il a déjà raconté :
${context}

Pose une **nouvelle question**, utile, sans répéter ce qui a déjà été abordé.
Si tout semble complet, invite à approfondir ou partager une anecdote.
`.trim();

  // runInterviewTurn peut prendre directement message ou sysPrompt comme entrée
  // Ici on injecte sysPrompt seulement si message vide
  const firstMsg = message && message.trim().length > 0 ? message : sysPrompt;
  return await (runInterviewTurn as any)(firstMsg, sid, sec, options);
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

    // 🔧 nouveau : récupérer profil + contexte envoyés par le client
    const profile = body?.profile ?? {};
    const context = body?.context ?? "";

    console.log("[AGENT IN]", {
      sid,
      sec,
      message: String(message).slice(0, 200),
      depthBudget,
      profileKeys: Object.keys(profile || {}),
      contextPreview: String(context).slice(0, 100) + "...",
    });

    // --- Appel principal avec contexte enrichi
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
    let phase = sectionPhase(sid, sec); // "must" | "good" | "done"
    let done = phase === "done";

    // “question guarantee” — on redemande si la première sortie n’est pas une question
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
