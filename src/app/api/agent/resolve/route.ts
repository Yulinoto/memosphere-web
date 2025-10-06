// src/app/api/agent/resolve/route.ts

import { NextResponse } from "next/server";
import { openaiAdapter } from "@/server/llm/providers/openai";
import type { Entry } from "@/data/blocks";

export async function POST(req: Request) {
  try {
    const { entries } = await req.json();

    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: "Invalid or missing 'entries' array" }, { status: 400 });
    }

    if (!openaiAdapter.extractResolvedFromEntries) {
      return NextResponse.json({ error: "LLM adapter missing extractResolvedFromEntries method" }, { status: 500 });
    }

    const resolved = await openaiAdapter.extractResolvedFromEntries({ entries });
    return NextResponse.json(resolved);

  } catch (err) {
    console.error("[agent/resolve] API error:", err);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
