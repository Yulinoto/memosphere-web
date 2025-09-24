import { NextResponse } from "next/server";
import { getLLM } from "@/server/llm";
import type { VariantsInput } from "@/server/llm/types";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as VariantsInput;
    if (!body?.question) {
      return NextResponse.json({ error: "Missing 'question'" }, { status: 400 });
    }
    const llm = getLLM();
    const out = await (llm.variants
      ? llm.variants({ question: body.question, blockId: body.blockId, lang: body.lang ?? "fr" })
      : Promise.resolve({ altQuestion: body.question }));

    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "LLM error" }, { status: 500 });
  }
}
