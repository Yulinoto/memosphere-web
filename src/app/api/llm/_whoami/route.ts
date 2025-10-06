// src/app/api/llm/_whoami/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ou "edge", les 2 passent

export async function GET() {
  return NextResponse.json({
    providerEnv: process.env.LLM_PROVIDER || "(not set)",
    agentModeClient: process.env.NEXT_PUBLIC_AGENT_OWNS_VALIDATION || "(not set)",
    nodeEnv: process.env.NODE_ENV,
  });
}
