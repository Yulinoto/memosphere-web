import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { BLOCK_BRIEFS } from "@/lib/blockBrief";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

type QA = { q: string; a: string; ts?: number };

function buildCorpus(payload: {
  blockId: string;
  title: string;
  content?: string;
  entries?: QA[];
}) {
  const lines: string[] = [];

  // 1) Q/R chronologiques (si dispo)
  const list = (payload.entries || []).filter(e => e?.q && e?.a);
  if (list.length) {
    lines.push("### Questions/Réponses (chronologique)");
    for (const e of list) {
      lines.push(`- Q: ${e.q}`);
      lines.push(`  A: ${e.a}`);
    }
  }

  // 2) Mémoire narrative cumulée
  const mem = (payload.content || "").trim();
  if (mem) {
    lines.push("\n### Mémoire narrative (concat des réponses reformulées)");
    lines.push(mem);
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY manquant" }, { status: 500 });
    }

    const body = await req.json();
    const { blockId, title, content, entries } = body || {};
    if (typeof blockId !== "string" || !blockId) {
      return NextResponse.json({ ok: false, error: "blockId manquant" }, { status: 400 });
    }

    const brief = BLOCK_BRIEFS[blockId] || {
      goal: `Produire un résumé narratif cohérent du bloc "${title || blockId}".`,
      mustHave: [],
      style: "récit clair, fluide, non redondant."
    };

    const corpus = buildCorpus({ blockId, title: title || blockId, content, entries });

    const system = [
       "Tu es un rédacteur fantôme qui produit une synthèse narrative courte, fluide et cohérente.",
  "Tu écris en français.",
  "Tu écris TOUJOURS à la première personne du singulier (je, moi, mon, ma, mes).",
  "Tu n'inventes rien: uniquement ce qui apparaît dans les notes (Q/R + mémoire).",
  "Tu supprimes les redites, tu relies les idées avec de courtes transitions.",
  "Tu écris 2 à 5 paragraphes maximum.",
    ].join(" ");

    const user = [
      `Bloc: ${title || blockId}`,
      `Objectif: ${brief.goal}`,
      brief.mustHave.length ? `Points à couvrir si présents: ${brief.mustHave.join("; ")}.` : "",
      `Style: ${brief.style}`,
      "",
      "=== NOTES À RÉSUMER ===",
      corpus || "(aucune note)"
    ].join("\n");

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    if (!text) {
      return NextResponse.json({ ok: false, error: "Résumé vide" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, summary: text });
  } catch (e: any) {
    console.error("[/api/llm/summarize] error:", e?.response?.data || e?.message || e);
    const msg = e?.response?.data?.error?.message || e?.message || "Erreur interne";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
