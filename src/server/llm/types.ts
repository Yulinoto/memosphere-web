// src/server/llm/types.ts
import type { Entry, ResolvedValue } from "@/data/blocks";

export type RephraseInput = {
  text: string;
  blockId?: string;
  lang?: "fr" | "en";
  maxSentences?: number;
  style?: "sobre" | "journal" | "narratif";
  removeFillers?: boolean;
};

export type RephraseOutput = { text: string };

export type ProbeInput = {
  lastText: string;
  blockId?: string;
  lang?: "fr" | "en";
};
export type ProbeOutput = { question: string };

export type VariantsInput = {
  question: string;
  blockId?: string;
  lang?: "fr" | "en";
};
export type VariantsOutput = { altQuestion: string };

export interface LLM {
  rephrase(input: RephraseInput): Promise<RephraseOutput>;
  probe?(input: ProbeInput): Promise<ProbeOutput>;
  variants?(input: VariantsInput): Promise<VariantsOutput>;
  extractResolvedFromEntries?(params: {
    entries: Entry[];
    lang?: "fr" | "en";
  }): Promise<Record<string, ResolvedValue>>;
}
