// src/app/api/llm/summarize/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export async function POST(req: NextRequest) {
  try {
    const { entries = [], lang = "fr", style = "biographique" } = await req.json();

    // entries attend un tableau d’objets { q?: string, a?: string } (comme dans tes blocs)
    const pairs = Array.isArray(entries) ? entries : [];
    const corpus = pairs
      .map((e: any) => {
        const q = typeof e?.q === "string" ? e.q.trim() : "";
        const a = typeof e?.a === "string" ? e.a.trim() : "";
        if (q && a) return `Q: ${q}\nA: ${a}`;
        if (a) return `Témoignage: ${a}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

    if (!corpus) {
      return NextResponse.json(
        { ok: true, text: "" }, // rien à résumer
        { headers: { "x-handler": "summarize" } }
      );
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const system = (lang === "en"
      ? "You are a careful biographical summarizer."
      : "Tu es un scribe biographique rigoureux."
    ) + ` Style: ${style}.`;

    const prompt =
      (lang === "en"
        ? `Summarize the following interview excerpts into a concise, well-structured paragraph (5–8 sentences). Use neutral tone, merge duplicates, keep concrete facts (names, dates, places) if present. Avoid inventing.`
        : `Résume les extraits suivants en un paragraphe clair et structuré (5–8 phrases). Ton neutre, fusionne les doublons, conserve les faits concrets (noms, dates, lieux) si présents. N’invente rien.`
      ) + `\n\n---\n${corpus}\n---\n`;

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });

    const text = r.choices?.[0]?.message?.content?.trim() || "";

    return NextResponse.json(
      { ok: true, text },
      { headers: { "x-handler": "summarize" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "LLM summarize error" },
      { status: 500 }
    );
  }
}
