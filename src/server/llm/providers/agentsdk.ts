import { Agent, run, tool, setDefaultOpenAIKey, type AgentInputItem } from "@openai/agents";
import { z } from "zod";
import schemaJson from "@/data/interviewSchema.json";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY manquant");
}
setDefaultOpenAIKey(process.env.OPENAI_API_KEY!);

// ====== Config ======
const GOOD2HAVE_LIMIT = Number(process.env.GOOD2HAVE_LIMIT ?? 6); // max de questions good_to_have par section

// ===== Store mémoire par session + section =====
type SectionStore = Record<string, any>;              // ex: { nom_prenom: "Jean Dupont", ... }
type SessionStore = Record<string, SectionStore>;     // sectionId -> data
const STORE: Record<string, SessionStore> = {};       // sessionId -> section -> data

// Compteur good_to_have posées par section (pour éviter l’infini)
const GOOD_COUNT: Record<string, Record<string, number>> = {}; // sessionId -> sectionId -> n

export function getSectionProfile(sessionId: string, sectionId: string): SectionStore {
  STORE[sessionId] ||= {};
  STORE[sessionId][sectionId] ||= {};
  return STORE[sessionId][sectionId];
}
function upsertSectionFields(sessionId: string, sectionId: string, patch: Record<string, any>) {
  const s = getSectionProfile(sessionId, sectionId);
  Object.assign(s, patch);
}
function bumpGoodCount(sessionId: string, sectionId: string) {
  GOOD_COUNT[sessionId] ||= {};
  GOOD_COUNT[sessionId][sectionId] = (GOOD_COUNT[sessionId][sectionId] ?? 0) + 1;
}
function getGoodCount(sessionId: string, sectionId: string) {
  return GOOD_COUNT[sessionId]?.[sectionId] ?? 0;
}

// ===== Patches récents pour remontée vers l’UI =====
const LAST_PATCH: Record<string, Record<string, any>> = {}; // sessionId -> sectionId -> patch
function setLastPatch(sessionId: string, sectionId: string, patch: Record<string, any>) {
  LAST_PATCH[sessionId] ||= {};
  LAST_PATCH[sessionId][sectionId] = patch;
}
export function consumeLastPatch(sessionId: string, sectionId: string) {
  const p = (LAST_PATCH[sessionId] || {})[sectionId];
  if (p) {
    delete LAST_PATCH[sessionId][sectionId];
    if (Object.keys(LAST_PATCH[sessionId]).length === 0) delete LAST_PATCH[sessionId];
  }
  return p || null;
}

// ===== Utils schéma =====
export function sectionMustHave(sectionId: string): string[] {
  const sec = (schemaJson as any)[sectionId] || {};
  return Array.isArray(sec.must_have) ? sec.must_have : [];
}
export function sectionGoodToHave(sectionId: string): string[] {
  const sec = (schemaJson as any)[sectionId] || {};
  return Array.isArray(sec.good_to_have) ? sec.good_to_have : [];
}
export function isFilled(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}
export function sectionPhase(sessionId: string, sectionId: string): "must" | "good" | "done" {
  const sec: any = (schemaJson as any)[sectionId] || {};
  const must: string[] = Array.isArray(sec.must_have) ? sec.must_have : [];
  const good: string[] = Array.isArray(sec.good_to_have) ? sec.good_to_have : [];
  const slots: string[] = Array.isArray(sec.slots) ? sec.slots.map((s: any) => String(s.id)) : [];

  const known = new Set<string>([...must, ...good, ...slots]);
  const data = getSectionProfile(sessionId, sectionId);

  // helper: uniquement clés connues du schéma
  const filled = (key: string) => known.has(key) && isFilled(data[key]);

  const allMust = must.length > 0 ? must.every(filled) : false;
  if (!allMust) return "must";

  // must ok → phase good si encore des champs good_to_have non remplis et limite pas atteinte
  const remainingGood = good.filter((k) => !filled(k));
  if (remainingGood.length > 0 && getGoodCount(sessionId, sectionId) < GOOD2HAVE_LIMIT) {
    return "good";
  }
  return "done";
}


// ===== Tools =====
const getSectionRequirements = tool({
  name: "get_section_requirements",
  description: "Retourne les champs 'must_have' et 'good_to_have' ordonnés pour une section.",
  parameters: z.object({ sectionId: z.string() }),
  async execute({ sectionId }) {
    const must = sectionMustHave(sectionId);
    const good = sectionGoodToHave(sectionId);
    console.log("[TOOL:get_section_requirements]", { sectionId, must, good });
    return { sectionId, must_have: must, good_to_have: good };
  },
});

const getProfile = tool({
  name: "get_profile",
  description: "Retourne l'état courant des champs pour une section (session+section).",
  parameters: z.object({
    sessionId: z.string(),
    sectionId: z.string(),
  }),
  async execute({ sessionId, sectionId }) {
    const prof = getSectionProfile(sessionId, sectionId);
    console.log("[TOOL:get_profile]", { sessionId, sectionId, keys: Object.keys(prof) });
    return prof;
  },
});

const upsertFields = tool({
  name: "upsert_fields",
  description:
    "Écrit/normalise des champs de la section. Utiliser les IDs EXACTS du schéma (must_have/slots/good_to_have).",
  parameters: z.object({
    sessionId: z.string(),
    sectionId: z.string(),
    fields: z
      .array(
        z.object({
          key: z.string(),                 // ex: "nom_prenom" ou un id de 'good_to_have'
          value: z.string().nullable(),    // ex: "Jean Dupont" ou null pour effacer
        })
      )
      .min(1),
  }),
  async execute({ sessionId, sectionId, fields }) {
    // Convertit [{key, value}] -> { key: value, ... }
    const patch: Record<string, any> = {};
    for (const { key, value } of fields) {
      if (typeof key !== "string") continue;
      let v = value;
      // JJ/MM/AAAA -> AAAA-MM-JJ
      if (v && typeof v === "string") {
        const m = v.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/);
        if (m) v = `${m[3]}-${m[2]}-${m[1]}`;
      }
      patch[key] = v;
    }
    upsertSectionFields(sessionId, sectionId, patch);
    setLastPatch(sessionId, sectionId, patch);

    // Si on est en phase "good", on incrémente le compteur de richesses posées
    if (sectionPhase(sessionId, sectionId) === "good") {
      bumpGoodCount(sessionId, sectionId);
    }

    console.log("[TOOL:upsert_fields]", { sessionId, sectionId, patch });
    return { ok: true, saved: patch };
  },
});

// ===== Agent =====
export const interviewAgent = new Agent({
  name: "Intervieweur Memosphere",
  instructions: `
Tu conduis une interview PAR SECTION.

Objectif:
1) D'abord, compléter les champs "must_have" de la section, dans l'ORDRE.
2) Ensuite, enrichir avec les "good_to_have" (un par un), tant qu'il en reste
   et que cela apporte de la valeur.

Procédure stricte:
1) get_section_requirements({ sectionId: SECTION_ID }) → récupère "must_have" ET "good_to_have" ordonnés.
2) get_profile({ sessionId: SESSION_ID, sectionId: SECTION_ID }) → lis l'état actuel.
3) Si des must_have manquent, POSE UNE question courte (≤ 15 mots) sur le PROCHAIN must_have manquant.
   - Respecte l'ordre des must_have.
   - Ne répète jamais un champ déjà rempli.
   - Indique le format attendu quand utile.
4) Après chaque réponse utilisateur, appelle upsert_fields({
     sessionId, sectionId,
     fields: [ { key: "<id_champ>", value: "<valeur ou null>" } ]
   }).
   - Utilise les IDs EXACTS de must_have (ou des slots/good_to_have si applicable).
5) Lorsque TOUS les must_have sont remplis:
   - Passe aux good_to_have: POSE UNE seule question courte sur le prochain good_to_have manquant.
   - Continue un par un (pas d'interrogatoire multichamps).

🔎 Approfondissement contrôlé (sans casser le flow):
- But: poser 1 à 2 sous-questions supplémentaires sur le MÊME THÈME quand c’est utile.
- Déclencheurs d’approfondissement: émotion forte, événement pivot, détails flous (date/lieu/noms),
  contradiction apparente, “première/dernière/meilleure/pire fois”, précision chiffrée incertaine.
- Règle: au maximum 2 sous-questions consécutives par champ/thème, puis on reprend le flow normal.
- Les sous-questions sont concises (≤ 15 mots), ciblées, et N’INTRODUISENT PAS un nouveau champ.
- Si la réponse permet d’affiner un champ déjà saisi (ex.: préciser l’année),
  appelle upsert_fields(...) avec la nouvelle valeur (même key) avant de poursuivre.
- Si l’utilisateur montre des signaux de fatigue/désintérêt, interrompre l’approfondissement (0 est acceptable).

6) Termine par "Section terminée." uniquement quand:
   - il n'y a plus de must_have manquants ET plus de good_to_have manquants utiles.

Style:
- Précis, sans bla-bla. Jamais deux questions à la fois. Pas d'invention.
- Tant que la section n’est pas clôturée, terminer par une question claire se finissant par un "?".
- Lors d’un approfondissement, signale subtilement la focalisation (ex.: "Tu disais ... Peux-tu préciser ... ?").
`,
  tools: [getSectionRequirements, getProfile, upsertFields],
});


// ===== Threads (mémoire de discussion) =====
const THREADS: Record<string, AgentInputItem[]> = {};
// ---- Reset mémoire agent (STORE / THREADS / GOOD_COUNT / LAST_PATCH)
export function resetAgentSession(sessionId?: string) {
  if (sessionId) {
    delete STORE[sessionId];
    delete THREADS[sessionId];
    delete GOOD_COUNT[sessionId];
    delete LAST_PATCH[sessionId];
  } else {
    // purge totale (utile en dev)
    for (const k of Object.keys(STORE)) delete STORE[k];
    for (const k of Object.keys(THREADS)) delete THREADS[k];
    for (const k of Object.keys(GOOD_COUNT)) delete GOOD_COUNT[k];
    for (const k of Object.keys(LAST_PATCH)) delete LAST_PATCH[k];
  }
}
export async function runInterviewTurn(input: string, sessionId: string, sectionId: string) {
  const prev = THREADS[sessionId] ?? [];
  const bootstrap: AgentInputItem[] =
    prev.length === 0
      ? [{ role: "system", content: `SESSION_ID=${sessionId}\nSECTION_ID=${sectionId}` }]
      : [];

  console.log("[RUN]", { sessionId, sectionId, hasPrev: prev.length > 0, input: String(input).slice(0, 200) });

  const result = await run(
    interviewAgent,
    [...bootstrap, ...prev, { role: "user", content: input || "" }],
  );

  THREADS[sessionId] = result.history;

  const say =
    typeof result.finalOutput === "string"
      ? result.finalOutput
      : JSON.stringify(result.finalOutput ?? "");

  console.log("[RUN:FINAL]", { sessionId, sectionId, say: String(say).slice(0, 200) });

  return { say };
  
}
