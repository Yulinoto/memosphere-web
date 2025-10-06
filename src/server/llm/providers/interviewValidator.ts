// src/server/llm/providers/agent.ts
import "server-only";
import OpenAI from "openai";
import type {
  LLM,
  RephraseInput, RephraseOutput,
  ProbeInput, ProbeOutput,
  VariantsInput, VariantsOutput,
  // Si tu as d'autres signatures (gaps/conflicts/nextQuestion...), importe-les ici:
  // GapsInput, GapsOutput, ConflictsInput, ConflictsOutput, NextQuestionInput, NextQuestionOutput,
} from "../types";
import { openaiAdapter } from "./openai";
import schemaJson from "@/data/interviewSchema.json";

export function extractNomPrenom(fullName: string): { prenom?: string; nom?: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return {};

  const prenom = parts[0];
  const nom = parts.slice(1).join(" ");
  return { prenom, nom };
}


// ---------- ENV & OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MAX_EDIT_DISTANCE = Number(process.env.MAX_EDIT_DISTANCE ?? 2);
const LOCK_AFTER_CONFIRMS = Number(process.env.LOCK_AFTER_CONFIRMS ?? 2);
const MAX_FOLLOWUPS_PER_FIELD = Number(process.env.MAX_FOLLOWUPS_PER_FIELD ?? 2);

// ---------- Types internes ----------
type Canonical = Record<string, any>;
type Locks = Record<string, boolean>;
type Rules = {
  maxEditDistance: number;
  lockAfterConfirms: number;
  maxFollowupsPerField: number;
};
type SchemaSlot = { id: string; label: string; weight?: number; hints?: string[] };
type SchemaSection = {
  goal?: string;
  must_have?: string[];
  good_to_have?: string[];
  style?: string;
  slots?: SchemaSlot[];
};
type ValidationResult = {
  status: "ok" | "needs_followup" | "auto_corrected";
  missing: string[];
  conflicts: { field: string; old: string; new: string; reason: string }[];
  followup?: string; // UNE relance courte (<= 20 mots)
  fields_to_update?: Record<string, any>;
  locks_update?: Record<string, boolean>;
};

// ---------- Utilitaires ----------
function editDistance(a: string, b: string): number {
  const s = (a ?? "").toString();
  const t = (b ?? "").toString();
  const m = s.length, n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function isMicroVariant(oldVal?: string, newVal?: string, maxDist = MAX_EDIT_DISTANCE): boolean {
  if (!oldVal || !newVal) return false;
  const norm = (v: string) => v
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const a = norm(oldVal);
  const b = norm(newVal);
  if (!a || !b) return false;
  // même nombre de mots → réduit les faux positifs sur noms composés
  if (a.split(" ").length !== b.split(" ").length) return false;
  return editDistance(a, b) <= maxDist;
}

// ---------- Prompt agent (rôle + règles) ----------
const SYSTEM_PROMPT = `
Tu es l'Intervieweur-Validateur Memosphere.
Objectif: maintenir un profil "canonique" fiable en comparant la DERNIERE_REPONSE de l'utilisateur
avec les données existantes et le SCHEMA d'interview (champs attendus).
- Ne jamais inventer.
- Si divergence mineure (typo/normalisation) et champ non verrouillé: auto-corriger (status "auto_corrected").
- Si divergence majeure ou champ verrouillé: proposer UNE relance courte (<= 20 mots), status "needs_followup".
- Quand tout est cohérent et complet pour la section en cours: status "ok".
- Réponds STRICTEMENT en JSON. Pas de texte hors JSON.

Tu dois retourner un objet:
{
  "status": "ok" | "needs_followup" | "auto_corrected",
  "missing": string[],
  "conflicts": [{"field":"...", "old":"...", "new":"...", "reason":"..."}],
  "followup": string?,                // <= 20 mots, concret, une seule
  "fields_to_update": { ... }?,       // corrections sûres à appliquer "en dur"
  "locks_update": { "champ": true }?  // champs à marquer verrouillés si stables
}
`;

// ---------- Fonction cœur : validation + proposition ----------
export async function validateAndPropose(params: {
  canonical: Canonical;
  lastAnswer: string;
  section?: string;             // ex. "identite", "enfance", ...
  locks?: Locks;                // { nom: true } etc.
  rules?: Partial<Rules>;
}): Promise<ValidationResult> {
  const { canonical, lastAnswer, section = "identite", locks = {}, rules = {} } = params;

  const effRules: Rules = {
    maxEditDistance: rules.maxEditDistance ?? MAX_EDIT_DISTANCE,
    lockAfterConfirms: rules.lockAfterConfirms ?? LOCK_AFTER_CONFIRMS,
    maxFollowupsPerField: rules.maxFollowupsPerField ?? MAX_FOLLOWUPS_PER_FIELD,
  };

  const INTERVIEW_SCHEMA: Record<string, SchemaSection> = schemaJson as Record<string, SchemaSection>;
  const sectionDef = INTERVIEW_SCHEMA[section] ?? {};
const mustHave = Array.isArray(sectionDef.must_have) ? sectionDef.must_have : [];

  const userPrompt = `
SECTION: ${section}
SCHEMA_SECTION_MUST_HAVE: ${JSON.stringify(mustHave)}
CANONICAL (profil courant):
${JSON.stringify(canonical, null, 2)}

LOCKS (champs verrouillés true/false):
${JSON.stringify(locks, null, 2)}

RULES:
- maxEditDistance = ${effRules.maxEditDistance}
- lockAfterConfirms = ${effRules.lockAfterConfirms}
- maxFollowupsPerField = ${effRules.maxFollowupsPerField}

DERNIERE_REPONSE_UTILISATEUR (texte brut):
"""${lastAnswer}"""

INSTRUCTIONS DETAILLEES:
1) Déduis à quels champs de la SECTION la DERNIERE_REPONSE se rapporte (ex. "Nom et prénom", "Lieu de naissance"...).
2) Compare au CANONICAL:
   - Si micro-écart (typo, accent, casse, tiret) et champ non verrouillé -> propose fields_to_update (auto-correction).
   - Si champ verrouillé mais écart mineur -> re-normaliser vers la valeur canonique (pas de changement).
   - Si écart majeur -> ajouter un item "conflicts".
3) Complétude: liste "missing" (champs "must_have" non satisfaits).
4) Si missing[] non vide ou conflicts[] non vide -> "status":"needs_followup" + followup (<=20 mots).
5) Si tout ok -> "status":"ok". Propose "locks_update" pour champs stables (si confirmés 2x).
6) JSON STRICT UNIQUEMENT.
`;

  const r = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
  });

  const raw = r.choices[0]?.message?.content ?? "{}";
  let parsed: ValidationResult;
  try {
    parsed = JSON.parse(raw) as ValidationResult;
  } catch {
    parsed = { status: "needs_followup", missing: [], conflicts: [], followup: "Peux-tu préciser ?" };
  }

  // Garde-fous
  if (!Array.isArray(parsed.missing)) parsed.missing = [];
  if (!Array.isArray(parsed.conflicts)) parsed.conflicts = [];
  if (parsed.followup && parsed.followup.length > 120) {
    parsed.followup = parsed.followup.slice(0, 120);
  }
  if (parsed.status !== "ok" && parsed.status !== "needs_followup" && parsed.status !== "auto_corrected") {
    parsed.status = (parsed.missing.length === 0 && parsed.conflicts.length === 0)
      ? "ok"
      : "needs_followup";
  }

  return parsed;
}

// ---------- Adapter LLM ----------
// IMPORTANT : on implémente tes méthodes existantes pour rester plug & play.
// Si ton LLM a des signatures supplémentaires (gaps/conflicts/nextQuestion), je peux les ajouter à l’identique.
export const agentAdapter: LLM = {

  // --- Interview: relance courte pilotée par l'agent ---
  async probe({ lastText, blockId, lang = "fr" }: ProbeInput): Promise<ProbeOutput> {
    const canonical: Canonical = {};    // TIP: charge ton profil courant ici si tu l'as côté serveur
    const locks: Locks = {};            // TIP: idem pour les locks par champ
    const section = (blockId as string) || "identite";
    const result = await validateAndPropose({
      canonical, lastAnswer: lastText, section, locks
    });

    // On renvoie un "ProbeOutput" minimal, compatible avec ton front
    const q = result.followup || "Peux-tu préciser un détail ?";
    return { question: q.replace(/^\p{P}+/u, "").trim() };
  },

  // --- Interview: variante de question (on se base sur la follow-up calculée) ---
  async variants({ question, blockId, lang = "fr" }: VariantsInput): Promise<VariantsOutput> {
    // Simple variante via modèle (ou rephraser court)
    const sys = `Propose UNE reformulation de la question suivante en ${lang === "en" ? "English" : "French"}, <= 20 mots, même intention.`;
    const usr = `Question: "${question}"`;
    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
    });
    const alt = r.choices[0]?.message?.content?.trim() || question;
    return { altQuestion: alt.replace(/^\p{P}+/u, "").trim() };
  },

  // --- Scribe / reformulation: on délègue à ton provider existant pour ne rien casser ---
  async rephrase(input: RephraseInput): Promise<RephraseOutput> {
    return openaiAdapter.rephrase(input);
  },

  // --- (Option) si tu as summarize, on peut déléguer aussi pour l’instant ---
  // async summarize(input: SummarizeInput): Promise<SummarizeOutput> {
  //   return openaiAdapter.summarize(input);
  // },
};
