// src/app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs"; // on reste côté Node

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY manquant côté serveur" },
        { status: 500 }
      );
    }

    const { text, voice } = await req.json();
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ ok: false, error: "Texte manquant" }, { status: 400 });
    }

    const speech = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      input: text,
      voice: typeof voice === "string" && voice ? voice : "alloy",
      response_format: "mp3", // <-- la bonne clé
    });

    const buf = Buffer.from(await speech.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[/api/tts] Error:", e?.response?.data || e?.message || e);
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Erreur interne TTS";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
