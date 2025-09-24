// src/server/llm/types.ts
export type RephraseInput = {
  text: string;
  blockId?: string;
  lang?: "fr" | "en";
  maxSentences?: number; // 1..3 par défaut
  style?: "sobre" | "journal" | "narratif"; // TON souhaité
  removeFillers?: boolean;                  // Vider "euh/ben/bah..." etc.
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
}
