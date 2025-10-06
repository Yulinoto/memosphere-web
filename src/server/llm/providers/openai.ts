// src/server/llm/providers/openai.ts


import OpenAI from "openai";
import type {
  LLM,
  RephraseInput, RephraseOutput,
  ProbeInput, ProbeOutput,
  VariantsInput, VariantsOutput,
} from "../types";
import type { Entry, ResolvedValue } from "@/data/blocks";
import type { ChatCompletionMessageParam } from "openai/resources/index.mjs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_FAST = process.env.OPENAI_FAST_MODEL || "gpt-4o-mini";

function langName(lang?: "fr" | "en") {
  return lang === "en" ? "English" : "French";
}
function styleHint(s?: "sobre" | "journal" | "narratif") {
  switch (s) {
    case "journal": return "Tone: intimate journal, calm, first person.";
    case "narratif": return "Tone: light narrative, fluid transitions, still concise.";
    default: return "Tone: neutral and concise.";
  }
}

function isTexteEntry(entry: Entry): entry is Extract<Entry, { type: "texte"; q: string; a: string }> {
  return entry.type === "texte";
}

export const openaiAdapter: LLM = {
  async rephrase({
    text,
    blockId,
    lang = "fr",
    maxSentences = 3,
    style = "sobre",
    removeFillers = true,
  }: RephraseInput): Promise<RephraseOutput> {
    const sys = `You are a faithful ${langName(lang)} editor.
Goals:
- ${removeFillers
      ? 'Remove speech disfluencies: "euh", "heu", "ben", "bah", "tu vois", "genre", "enfin", "quoi", "du coup", "voilà", "bref", repeated words, false starts.'
      : "Do not remove any content beyond light polish."}
- Merge fragments, fix punctuation and casing, keep a natural oral tone.
- Prefer concise, elegant phrasing; micro-rewrite allowed if meaning is unchanged.
- Keep meaning strictly intact; do not invent or omit facts, names, dates, places. Preserve first person.
- Output ${Math.min(Math.max(maxSentences, 1), 3)} sentence(s) maximum. No preface or commentary. Text only.
${styleHint(style)}`;

    const usr = `Raw text:\n"""${text}"""\nContext block: ${blockId ?? "unknown"}\nReturn only the cleaned text.`;

    const r = await client.chat.completions.create({
      model: MODEL_FAST,
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });

    const out = r.choices[0]?.message?.content?.trim() || text;
    return { text: out };
  },

  async probe({ lastText, blockId, lang = "fr" }: ProbeInput): Promise<ProbeOutput> {
    const sys = `You are a gentle interviewer in ${langName(lang)}.
Ask ONE short follow-up question (<= 20 words) to get a concrete detail (who/when/where/why/how).
No preamble, question only.`;
    const usr = `Last answer:\n"""${lastText}"""\nBlock: ${blockId ?? "unknown"}`;

    const r = await client.chat.completions.create({
      model: MODEL_FAST,
      temperature: 0.4,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });

    const q = r.choices[0]?.message?.content?.trim() || "Peux-tu préciser un détail ?";
    return { question: q.replace(/^\p{P}+/u, "").trim() };
  },

  async variants({ question, blockId, lang = "fr" }: VariantsInput): Promise<VariantsOutput> {
    const sys = `You propose ONE alternative question in ${langName(lang)}.
Keep the same angle, simpler wording, <= 20 words. Return only the question.`;
    const usr = `Original question: "${question}"\nBlock: ${blockId ?? "unknown"}`;

    const r = await client.chat.completions.create({
      model: MODEL_FAST,
      temperature: 0.5,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });

    const alt = r.choices[0]?.message?.content?.trim() || question;
    return { altQuestion: alt.replace(/^\p{P}+/u, "").trim() };
  },

  async extractResolvedFromEntries({
    entries,
    lang = "fr"
  }: {
    entries: Entry[];
    lang?: "fr" | "en";
  }): Promise<Record<string, ResolvedValue>> {
    const content = entries
      .filter(isTexteEntry)
      .map((e) => `Q: ${e.q}\nA: ${e.a}`)
      .join("\n\n");

    const prompt = `Tu es un scribe intelligent qui analyse les questions et réponses d'un utilisateur.\n` +
      `Tu dois extraire les informations importantes et structurées.\n` +
      `Retourne uniquement un objet JSON de la forme suivante :\n` +
      `{ slotId: { value: string, source: 'scribe', at: timestamp } }\n` +
      `N'inclus que des infos claires, sans incertitude. Pas de phrase incomplète ou bruit. Langue: ${lang}.`;

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: prompt },
      { role: "user", content },
    ];

    try {
      const chat = await client.chat.completions.create({
        model: MODEL_FAST,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" }
      });

      const raw = chat.choices?.[0]?.message?.content;
      const now = Date.now();
      const parsed = JSON.parse(raw || "{}") as Record<string, any>;

      const result: Record<string, ResolvedValue> = {};
      for (const [slot, val] of Object.entries(parsed)) {
        if (typeof val?.value === "string") {
          result[slot] = {
            value: val.value.trim(),
            source: "scribe",
            at: now
          };
        }
      }

      return result;
    } catch (err) {
      console.error("Erreur extractResolvedFromEntries:", err);
      return {};
    }
  }
};
