import { NextResponse } from "next/server";
import { getLLM } from "@/server/llm";
import type { ProbeInput } from "@/server/llm/types";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProbeInput;
    if (!body?.lastText) {
      return NextResponse.json({ error: "Missing 'lastText'" }, { status: 400 });
    }
    const llm = getLLM();
    const out = await (llm.probe
      ? llm.probe({ lastText: body.lastText, blockId: body.blockId, lang: body.lang ?? "fr" })
      : Promise.resolve({ question: "Peux-tu préciser un détail important ?" }));

    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "LLM error" }, { status: 500 });
  }
}
