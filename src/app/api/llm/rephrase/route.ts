// src/app/api/llm/rephrase/route.ts
import { NextResponse } from "next/server";
import { getLLM } from "@/server/llm";
import type { RephraseInput } from "@/server/llm/types";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RephraseInput;
    if (!body?.text || typeof body.text !== "string") {
      return NextResponse.json({ ok: false, error: "Missing 'text'" }, { status: 400 });
    }

    const llm = getLLM();
    const out = await llm.rephrase({
      text: body.text,
      blockId: body.blockId,
      lang: body.lang ?? "fr",
      maxSentences: Math.min(Math.max(body.maxSentences ?? 3, 1), 3),
      style: body.style ?? "sobre",
      removeFillers: body.removeFillers ?? true,
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "LLM error" }, { status: 500 });
  }
}
