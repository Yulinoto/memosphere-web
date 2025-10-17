// /src/app/api/book/rephrase/route.ts
import { NextRequest, NextResponse } from "next/server";
import { text } from "stream/consumers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { text = "", style = "narratif", pointOfView = "first" } = await req.json();

    const styleText =
      style === "poetique"
        ? "poétique, sensoriel et évocateur"
        : style === "journalistique"
        ? "clair, factuel et fluide"
        : "naturel, sincère et humain";

    const pov =
      pointOfView === "first"
        ? "à la première personne (utilise 'je')"
        : "à la troisième personne (utilise 'il' ou 'elle')";

    const prompt = `
Reformule la phrase suivante ${pov}, dans un style ${styleText}, sans ajouter d'informations non présentes :

"${text}"
`.trim();

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Tu es un éditeur biographique exigeant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
      }),
    });

    const json = await res.json();
    const out = json?.choices?.[0]?.message?.content?.trim() || text;
    return NextResponse.json({ text: out });
  } catch (e: any) {
    return NextResponse.json({ text }, { status: 200 });
  }
}
