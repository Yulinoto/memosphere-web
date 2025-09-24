import type { LLM } from "./types";
import { openaiAdapter } from "./providers/openai";

// futurs adapters : mistralAdapter, anthropicAdapter, localAdapter...
// import { mistralAdapter } from "./providers/mistral";
// import { anthropicAdapter } from "./providers/anthropic";

export function getLLM(): LLM {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();

  switch (provider) {
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
