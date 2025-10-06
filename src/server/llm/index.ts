// src/server/llm/index.ts
import type { LLM } from "./types";
import { openaiAdapter } from "./providers/openai";
import { agentAdapter } from "./providers/interviewValidator"; // ← AJOUT

// futurs adapters : mistralAdapter, anthropicAdapter, localAdapter...
// import { mistralAdapter } from "./providers/mistral";
// import { anthropicAdapter } from "./providers/anthropic";

export function getLLM(): LLM {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();

  switch (provider) {
    case "agent":
      return agentAdapter;            // ← AJOUT
    case "openai":
      return openaiAdapter;
    // case "mistral":
    //   return mistralAdapter;
    // case "anthropic":
    //   return anthropicAdapter;
    // case "local":
    //   return localAdapter;
    default:
      return openaiAdapter;
  }
}
