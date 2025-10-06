// src/app/api/llm/validate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validateAndPropose } from "@/server/llm/providers/interviewValidator";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { canonical = {}, lastAnswer = "", section = "identite", locks = {} } = body || {};
    const result = await validateAndPropose({ canonical, lastAnswer, section, locks });

    return NextResponse.json(result, {
      headers: { "x-handler": "validate-via-interviewValidator" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Agent error" },
      { status: 500 },
    );
  }
}
