// src/app/api/llm/nextQuestion/route.ts
import { NextRequest, NextResponse } from "next/server";
import { BLOCK_GUIDES } from "@/data/BLOCK_GUIDES";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { blockId, lastAnswer } = await req.json();

    const guide = BLOCK_GUIDES[blockId];
    if (!guide) {
      return NextResponse.json({ ok: false, error: "Bloc inconnu" }, { status: 400 });
    }

    const prompt = `
Tu es un interviewer bienveillant.
Bloc actuel : ${blockId.toUpperCase()}.

Objectifs du bloc :
${guide.objectives.map((o) => "- " + o).join("\n")}

Relances possibles :
${guide.relances.map((r) => "- " + r).join("\n")}

Dernière réponse utilisateur : "${lastAnswer || "(aucune encore)"}"

Tâche :
- Pose UNE SEULE question naturelle, orale, simple, encourageante.
- Inspire-toi des relances, mais adapte à ce qui vient d’être dit.
- Ne donne pas de réponse toi-même.
- Pas plus de 25 mots.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu es un interviewer qui guide une interview de mémoire personnelle." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 80,
    });

    const text = completion.choices[0]?.message?.content?.trim();

    return NextResponse.json({ ok: true, question: text });
  } catch (e: any) {
    console.error("Erreur GPT:", e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
