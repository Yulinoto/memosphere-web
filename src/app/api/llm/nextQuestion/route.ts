import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import schemaJson from "@/data/interviewSchema.json";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/**
 * body: { blockId: string, lastAnswer?: string, progress?: number }
 * return: { ok: true, question: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { blockId, lastAnswer, progress } = await req.json();
    const schema: any = (schemaJson as any)[blockId];
    if (!schema) {
      return NextResponse.json({ ok: false, error: "unknown blockId" }, { status: 400 });
    }

    const sys =
      "Tu es un intervieweur francophone. Pose UNE SEULE question, courte, naturelle, pour faire progresser la collecte d'infos du bloc indiqué. " +
      "Ne donne JAMAIS de réponse à la place de l'utilisateur. Style oral, bienveillant, simple.";

    const user = {
      blockId,
      objectifs: schema.objectives || [],
      relances: schema.relances || [],
      consignes: schema.guidelines || [],
      dernierExtrait: (lastAnswer || "").slice(0, 800),
      progress: typeof progress === "number" ? progress : undefined,
    };

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 120,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(user) },
      ],
    });

    const text = (resp.choices?.[0]?.message?.content || "").trim();
    // Sécurité: on enlève les guillemets éventuels
    const q = text.replace(/^["“]|["”]$/g, "").trim();
    return NextResponse.json({ ok: true, question: q || "Tu veux bien me raconter un souvenir sur ce thème ?" });
  } catch (e: any) {
    console.error("/api/llm/nextQuestion error", e?.message || e);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
