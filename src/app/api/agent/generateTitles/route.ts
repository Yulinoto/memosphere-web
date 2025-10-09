import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function stripCodeFences(s: string) {
  return String(s || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { type, payload } = await req.json();

    if (!type) {
      return NextResponse.json({ error: "Missing type" }, { status: 400 });
    }

    // ====== BOOK / SUBTITLE ======
    if (type === "book" || type === "subtitle") {
      const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
      const summaries = blocks
        .filter((b: any) => String(b?.summary || "").trim())
        .map((b: any) => ({ id: String(b.id), summary: String(b.summary) }));

      const system =
        "Tu es un éditeur francophone spécialisé en autobiographies. Retourne UNIQUEMENT du JSON valide, sans markdown.";

      const user =
        type === "book"
          ? `À partir de ces résumés, propose:
- "bookTitle": un titre (≤ 6 mots), sans guillemets superflus
- "subtitle": un sous-titre (≤ 12 mots)
- "blocks": une liste [{"id": string, "title": string}] avec un titre (≤ 6 mots) pour chaque bloc fourni

Réponds UNIQUEMENT en JSON. Données:
${JSON.stringify({ summaries }, null, 2)}`
          : `À partir de ces résumés, propose un {"subtitle": "..."} (≤ 12 mots).
Réponds UNIQUEMENT en JSON. Données:
${JSON.stringify({ summaries }, null, 2)}`;

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });

      let out = completion.choices[0]?.message?.content ?? "";
      try {
        return NextResponse.json(JSON.parse(out));
      } catch {
        out = stripCodeFences(out);
        try {
          return NextResponse.json(JSON.parse(out));
        } catch {
          // Fallback minimal pour ne pas planter l’UI
          if (type === "subtitle") {
            return NextResponse.json({ subtitle: out || "" });
          }
          return NextResponse.json({
            bookTitle: out.split("\n")[0] || "",
            subtitle: "",
            blocks: [],
          });
        }
      }
    }

    // ====== BLOCK TITLE ======
    if (type === "blockTitle") {
      const summary = String(payload?.block?.summary || "").trim();
      if (!summary) {
        // logique "ne rien générer si pas de données"
        return NextResponse.json({ title: "" });
      }

      const system =
        "Tu es un éditeur francophone. Réponds UNIQUEMENT en JSON, sans markdown.";
      const user = `Propose {"title": "..."} pour ce contenu autobiographique (≤ 6 mots, sans guillemets superflus).
Données:
${summary}`;

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });

      let out = completion.choices[0]?.message?.content ?? "";
      try {
        return NextResponse.json(JSON.parse(out));
      } catch {
        out = stripCodeFences(out);
        try {
          return NextResponse.json(JSON.parse(out));
        } catch {
          return NextResponse.json({ title: out || "" });
        }
      }
    }

    return NextResponse.json({ error: "Unknown generation type" }, { status: 400 });
  } catch (e: any) {
    console.error("generateTitles error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
