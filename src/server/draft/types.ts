// src/server/draft/types.ts
export type EvidenceRef = { block: string; entry: number };

export type OutlineBeat = {
  idea: string;
  evidence: EvidenceRef[];
};

export type OutlineSection = {
  title: string;
  beats: OutlineBeat[];
};

export type OutlineChapter = {
  title: string;
  summary: string;
  sections: OutlineSection[];
};

export type BookOutline = {
  mode: "Timeline";
  title: string;
  chapters: OutlineChapter[];
  coverage: { must_uncovered: string[] };
};

// -------- Contexte fourni au LLM --------
export type IdentityContext = Record<string, string>;

export type BlockContext = {
  id: string;
  progress: number;
  must_covered?: string[];
  good_covered?: string[];
  highlights: { entry: number; text: string }[];
  resolved?: Record<string, { value: string }>;
};

export type StyleContext = {
  tone: "warm" | "neutral" | "formal";
  person: "je" | "il" | "elle";
  tense: "past" | "present";
  language?: "fr";
};

export type ContextPack = {
  identity: IdentityContext;
  blocks: BlockContext[];
  style: StyleContext;
  constraints: {
    maxChapters?: number;
    maxSectionsPerChapter?: number;
  };
  target?: { workingTitle?: string };
};

// ====== NOUVEAU : rédaction par section ======
export type EvidenceItem = { block: string; entry: number; text: string };

export type EvidenceBeatInput = {
  idea: string;
  evidence: EvidenceItem[];     // mêmes refs mais avec le texte source
};

export type EvidenceBundle = {
  identity: IdentityContext;
  beats: EvidenceBeatInput[];
  style: StyleContext;
  rules: {
    length?: { min?: number; max?: number }; // mots
    citations?: "anchors";                   // exige [B:xxx E:n]
    grounding?: "strict";                    // strict = pas de faits hors sources
    gaps?: "mark";                           // mark = écrire (à compléter) si manque
    avoid_repeating?: string[];              // phrases à éviter
    focus_intro?: string;                // thème central à mentionner en intro
  };
};

export type SectionDraft = {
  title: string;
  markdown: string;            // texte avec ancres [B:<block> E:<entry>]
  used_evidence: EvidenceRef[]; 
};
