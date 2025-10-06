// /src/app/api/llm/nextQuestion/route.ts
import { NextRequest, NextResponse } from "next/server";
import schemaJson from "@/data/interviewSchema.json";

export const runtime = "nodejs";

type Entry = { q?: string; a?: string; ts?: number };

/* ===========================================================
   PHASE 1 : IDENTITÉ (heuristique factuelle, comme avant)
   =========================================================== */

// 1) Noms via verbes ("je m'appelle", "mon nom est", ...)
function hasNomPrenomVerb(text: string) {
  return /\b(je m'?appelle|mon nom est|je me nomme)\s+[a-zà-öø-ÿ' -]{3,60}\b/i.test(text);
}

// 2) Noms “nus” (ex: "Jean Dupont" ou "Dupont Jean", 2..4 mots, capitalisés)
function hasNomPrenomBare(s: string) {
  const t = (s || "").trim();
  if (!t) return false;

  const line = t.replace(/\s{2,}/g, " ").trim();
  if (line.length > 80) return false;

  const parts = line.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;

  const rxWord = /^[A-ZÀ-ÖØ-Ý][\p{L}'-]{1,40}$/u; // Maj + lettres/’/-
  if (!parts.every((w) => rxWord.test(w))) return false;

  // si ça ressemble à une question, on refuse
  if (/[?!.]$/.test(line) || /\b(comment|quel|quelle|quels|quelles)\b/i.test(line)) return false;

  return true;
}

function hasNomPrenom(entries: Entry[], lastAnswer?: string) {
  const concat =
    entries.map((e) => `${e.q ?? ""}\n${e.a ?? ""}`).join("\n") +
    (lastAnswer ? `\n${lastAnswer}` : "");
  const low = concat.toLowerCase();

  if (hasNomPrenomVerb(low)) return true;

  // test fort sur la dernière réponse (ex: "Dupont Jean")
  if (lastAnswer && hasNomPrenomBare(lastAnswer)) return true;

  // scrute 5–6 dernières réponses
  for (let i = entries.length - 1; i >= 0 && i >= entries.length - 6; i--) {
    const a = (entries[i]?.a || "").trim();
    if (a && hasNomPrenomBare(a)) return true;
  }
  return false;
}

function hasDateNaissance(text: string) {
  // formats numériques
  if (/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(text)) return true;
  // formats littéraires
  if (
    /\b(le\s*)?\d{1,2}\s*(janvier|février|fevrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s*\d{2,4}\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

function hasLieuNaissance(text: string) {
  return /\b(n[ée]\s*(?:a|à)|naissance\s*(?:a|à))\s+[a-zà-öø-ÿ' -]{2,60}\b/i.test(text);
}

function hasFamilleProche(text: string) {
  return /\b(m[èe]re|p[èe]re|fr[èe]re|so[eè]ur|parents|fratrie|famille proche)\b/i.test(text);
}

function hasSurnoms(text: string) {
  return /\b(on m'?appelait|mon surnom (?:c'?|était|etait))\b/i.test(text);
}

const questionsIdentite: Record<string, string> = {
  nom_prenom: "Quel est ton nom et prénom complet ?",
  date_naissance: "Quelle est ta date de naissance (ex. 26 juin 1979) ?",
  lieu_naissance: "Où es-tu né·e (ville, pays) ?",
  famille_proche: "Qui formait ta famille proche à ta naissance ?",
  surnoms: "Avais-tu un surnom ? Si oui, lequel ?",
};

function findMissingIdentite(entries: Entry[], lastAnswer?: string) {
  const flat =
    entries.map((e) => `${e.q ?? ""}\n${e.a ?? ""}`).join("\n") +
    (lastAnswer ? `\n${lastAnswer}` : "");
  const low = flat.toLowerCase();

  const missing: string[] = [];
  if (!hasNomPrenom(entries, lastAnswer)) missing.push("nom_prenom");
  if (!hasDateNaissance(low)) missing.push("date_naissance");
  if (!hasLieuNaissance(low)) missing.push("lieu_naissance");
  if (!hasFamilleProche(low)) missing.push("famille_proche");
  if (!hasSurnoms(low)) missing.push("surnoms"); // optionnel
  return missing;
}

function wrapUp(style?: string) {
  if (style && /conversationnel|simple|chaud/i.test(style)) {
    return "Tu veux ajouter un petit détail sur ta naissance ou ta famille ?";
  }
  return "Souhaites-tu ajouter un dernier détail avant de passer à la suite ?";
}

/* ===========================================================
   PHASE 2 : PORTRAIT (questions humaines, non-IA)
   =========================================================== */

const PORTRAIT_QUESTIONS: string[] = [
  "Si tu devais te décrire en trois traits de caractère, lesquels choisirais-tu ?",
  "Quelles sont tes valeurs non négociables ?",
  "Qu’est-ce qui te motive le matin, vraiment ?",
  "Quelles peurs t’accompagnent (même discrètement) ?",
  "Quelles passions ou activités te font perdre la notion du temps ?",
  "Quels livres, films, musiques t’ont marqué·e — et pourquoi ?",
  "Quelle personne (ou rencontre) t’a le plus influencé·e ?",
  "Quel défaut tu assumes — et comment tu le transformes ?",
  "Quel compliment te touche le plus (et pourquoi) ?",
  "Quel moment fondateur te revient spontanément si on dit « toi » ?",
];

// Mémoire en process
const PORTRAIT_CURSOR: Record<string, number> = {}; // sessionId -> index
function getPortraitIndex(sessionId: string): number {
  const i = PORTRAIT_CURSOR[sessionId] ?? 0;
  return Math.min(Math.max(i, 0), PORTRAIT_QUESTIONS.length);
}
function setPortraitIndex(sessionId: string, idx: number) {
  PORTRAIT_CURSOR[sessionId] = Math.min(Math.max(idx, 0), PORTRAIT_QUESTIONS.length);
}
function advancePortrait(sessionId: string) {
  setPortraitIndex(sessionId, getPortraitIndex(sessionId) + 1);
}
function resetPortrait(sessionId: string) {
  setPortraitIndex(sessionId, 0);
}

const LAST_BLOCK: Record<string, string> = {};
function isPortraitBlock(id: string) {
  return id === "identite" || id === "portrait";
}

/* ===========================================================
   PHASE 3 : SECTIONS GÉNÉRIQUES GUIDÉES PAR LE PLAN JSON
   =========================================================== */
/**
 * On pilote les sections “valeurs_et_croyances”, “adolescence”, etc.
 * en suivant le plan JSON :
 *   schema[blockId].fields.must_have (puis) .good_to_have
 * On garde un curseur de slot par (sessionId, blockId).
 */
type SectionCursor = { i: number; mode: "must" | "good" };
const SECTION_CURSOR: Record<string, SectionCursor> = {}; // key = `${sessionId}::${blockId}`

function getCursorKey(sessionId: string, blockId: string) {
  return `${sessionId}::${blockId}`;
}
function getSectionCursor(sessionId: string, blockId: string): SectionCursor {
  const key = getCursorKey(sessionId, blockId);
  if (!SECTION_CURSOR[key]) SECTION_CURSOR[key] = { i: 0, mode: "must" };
  return SECTION_CURSOR[key];
}
function resetSectionCursor(sessionId: string, blockId: string) {
  SECTION_CURSOR[getCursorKey(sessionId, blockId)] = { i: 0, mode: "must" };
}
function advanceSectionCursor(sessionId: string, blockId: string, must: string[], good: string[]) {
  const cur = getSectionCursor(sessionId, blockId);
  const list = cur.mode === "must" ? must : good;
  if (cur.i + 1 < list.length) {
    cur.i += 1;
  } else {
    if (cur.mode === "must") {
      // passe aux good_to_have
      if (good.length > 0) {
        cur.mode = "good";
        cur.i = 0;
      } else {
        // fin
        cur.i = list.length;
      }
    } else {
      // fin
      cur.i = list.length;
    }
  }
}

/** Fabrique une question lisible à partir d’un id de slot. */
function toHumanQuestion(slotId: string): string {
  // Si ton schema a des libellés, on peut les utiliser ici.
  // En attendant, on fait simple :
  return `Peux-tu préciser « ${slotId.replace(/[_-]/g, " ")} » ?`;
}

/** Récupère la prochaine question “guidée par plan” pour un block générique. */
function nextGuidedQuestion(sessionId: string, blockId: string, lastAnswer: string) {
  const section: any = (schemaJson as any)[blockId] || {};
  const must: string[] = Array.isArray(section?.fields?.must_have) ? section.fields.must_have : [];
  const good: string[] = Array.isArray(section?.fields?.good_to_have) ? section.fields.good_to_have : [];

  // avance le curseur SEULEMENT si on vient de répondre
  if ((lastAnswer || "").trim()) {
    advanceSectionCursor(sessionId, blockId, must, good);
  }

  const cur = getSectionCursor(sessionId, blockId);
  const list = cur.mode === "must" ? must : good;

  if (list.length === 0) {
    return { done: true as const, question: "Souhaites-tu ajouter un détail important avant de passer à la suite ?" };
  }

  if (cur.i >= list.length) {
    // si on a fini must + good
    if (cur.mode === "must" && good.length > 0) {
      // sécurité : bascule si non fait
      cur.mode = "good";
      cur.i = 0;
    } else if (cur.mode === "good") {
      return { done: true as const, question: "Souhaites-tu ajouter un détail important avant de passer à la suite ?" };
    } else {
      // rien d’autre
      return { done: true as const, question: "Souhaites-tu ajouter un détail important avant de passer à la suite ?" };
    }
  }

  const slotId = list[cur.i];
  return { done: false as const, question: toHumanQuestion(slotId) };
}

/* ===========================
   HANDLER
   =========================== */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // On lit SANS destructuring (ton style)
    const blockIdRaw: string = typeof body.blockId === "string" ? body.blockId : "";
    const sessionIdRaw: string = typeof body.sessionId === "string" ? body.sessionId : "";
    const entries: Entry[] = Array.isArray(body.entries) ? body.entries : [];
    const lastAnswer: string = typeof body.lastAnswer === "string" ? body.lastAnswer : "";
    const forcePortrait: boolean = Boolean(body.forcePortrait);

    // Session stable
    let sess: string = (sessionIdRaw || "").trim() || "anon";

    // Block courant
    const blockId = (blockIdRaw || "").trim() || "identite";

    // Gestion reset portrait si on passe d’un bloc non-portrait → portrait
    {
      const last = LAST_BLOCK[sess];
      if (last && last !== blockId) {
        const wasPortraitZone = isPortraitBlock(last);
        const isPortraitZone = isPortraitBlock(blockId);
        if (!wasPortraitZone && isPortraitZone) {
          resetPortrait(sess);
        }
      }
      LAST_BLOCK[sess] = blockId;
    }

    const subSchema: any = (schemaJson as any)[blockId] || {};
    const style: string = subSchema?.style || "";

    // ===== Portrait forcé ?
    if (forcePortrait || blockId === "portrait") {
      if ((lastAnswer || "").trim()) {
        advancePortrait(sess);
      }
      const idx = getPortraitIndex(sess);
      if (idx < PORTRAIT_QUESTIONS.length) {
        const q = PORTRAIT_QUESTIONS[idx];
        return NextResponse.json({
          ok: true,
          question: q,
          via: forcePortrait ? "portrait-forced" : "portrait",
          portraitIndex: idx + 1,
          portraitTotal: PORTRAIT_QUESTIONS.length,
        });
      }
      return NextResponse.json({
        ok: true,
        question: wrapUp(style),
        via: "portrait-end",
      });
    }

    // ===== Identité en heuristique stricte
    if (blockId === "identite") {
      const missing = findMissingIdentite(entries, lastAnswer);
      if (missing.length > 0) {
        const order = ["nom_prenom", "date_naissance", "lieu_naissance", "famille_proche", "surnoms"];
        const next = order.find((s) => missing.includes(s)) || missing[0];
        // reset du curseur de section “identite” si tu veux forcer l’ordre à chaque reprise
        resetSectionCursor(sess, blockId);
        return NextResponse.json({
          ok: true,
          question: questionsIdentite[next],
          via: "identite-heuristique",
        });
      }

      // Identité complète → on bascule sur Portrait par défaut
      if ((lastAnswer || "").trim()) {
        advancePortrait(sess);
      }
      const idx = getPortraitIndex(sess);
      if (idx < PORTRAIT_QUESTIONS.length) {
        const q = PORTRAIT_QUESTIONS[idx];
        return NextResponse.json({
          ok: true,
          question: q,
          via: "portrait",
          portraitIndex: idx + 1,
          portraitTotal: PORTRAIT_QUESTIONS.length,
        });
      }
      return NextResponse.json({
        ok: true,
        question: wrapUp(style),
        via: "portrait-end",
      });
    }

    // ===== Autres sections : GUIDAGE PAR LE PLAN JSON
    {
      // sécurité : (re)crée un curseur de section si nécessaire
      const cur = getSectionCursor(sess, blockId);

      // Avancer SEULEMENT si on vient de répondre
      const guided = nextGuidedQuestion(sess, blockId, lastAnswer);

      if (!guided.done) {
        return NextResponse.json({
          ok: true,
          question: guided.question,
          via: "guided",
          sectionCursor: { i: getSectionCursor(sess, blockId).i, mode: getSectionCursor(sess, blockId).mode },
        });
      }

      // Tout le plan couvert → question de sortie
      return NextResponse.json({
        ok: true,
        question: "Souhaites-tu ajouter un détail important avant de passer à la suite ?",
        via: "guided-end",
      });
    }
  } catch (e: any) {
    console.error("[/api/llm/nextQuestion] error:", e?.message || e);
    return NextResponse.json(
      { ok: true, question: "Peux-tu préciser avec un exemple concret ?", via: "error-fallback" },
      { status: 200 }
    );
  }
}
