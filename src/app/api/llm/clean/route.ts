import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import schemaJson from "@/data/interviewSchema.json";

export const runtime = "nodejs";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

type EntryLike = { q?: string; a?: string; ts?: number };

type CleanIssue = {
  type: "duplicate" | "conflict" | "format" | "incoherence" | "outlier" | "uncertain";
  fields: string[];                   // champ(s) concernés (IDs du schéma si possible)
  description: string;                // explication courte (lisible)
  severity?: "low" | "medium" | "high";
  suggestion?: {                      // proposition optionnelle
    patch?: Record<string, string>;   // { fieldId: value }
    replace_in_entries?: { find: string; replace: string }[]; // corrections texte libres
    reason?: string;                  // justification courte
  };
  clarify_question?: string;          // question à poser à l’utilisateur si doute
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { blockId, entries = [], profile = {} } = body || {} as { blockId: string; entries: EntryLike[]; profile: Record<string, string> };

    if (!blockId || typeof blockId !== "string") {
      return NextResponse.json({ ok: false, error: "Missing blockId" }, { status: 400 });
    }

    const sec: any = (schemaJson as any)[blockId] || {};
    const must: string[] = Array.isArray(sec.must_have) ? sec.must_have : [];
    const good: string[] = Array.isArray(sec.good_to_have) ? sec.good_to_have : [];
    const slotsArr: any[] = Array.isArray(sec.slots) ? sec.slots : [];
    const slots: string[] = slotsArr.map((s: any) => String(s.id));
    const known = Array.from(new Set([...must, ...good, ...slots]));
    const details = slotsArr.map((s: any) => ({ id: String(s?.id || ""), label: String(s?.label || "") }));

    const sys = `
Tu es un AGENT NETTOYEUR de données biographiques pour une section donnée.
Objectif: détecter doublons, incohérences et anomalies dans:
- PROFIL (valeurs consolidées par champ),
- ENTRIES (questions/réponses brutes, texte libre).

Règles:
- Utilise uniquement les infos fournies, pas de connaissance externe.
- Identifie:
  * duplicate: doublons textuels inutiles (profil ou entrées).
  * conflict: 2 valeurs différentes pour un même champ (noms différents, dates incompatibles).
  * format: date au format anormal, casse incohérente, espaces superflus.
  * incoherence/outlier: âge impossible, ordre chronologique impossible, etc.
  * uncertain: cas nécessitant une confirmation utilisateur.
- Si possible, propose une correction (suggestion.patch) avec des fields présents dans CHAMPS_VALIDES.
- En cas de doute, fournir clarify_question que l’UI pourra poser à l’utilisateur.
- Tu as CHAMPS_DETAILS (id,label) pour t'aider à choisir le bon champ.
- Si la correction concerne une entité (ex: nom propre), pense à:
  * mettre à jour le champ cible (patch[id] = valeur corrigée), ET
  * proposer des remplacements textuels dans les ENTRIES (suggestion.replace_in_entries) pour harmoniser les anciennes mentions (ex: "Mella" -> "Vella").
- Retourne STRICTEMENT un JSON:
{
  "issues": [
    {
      "type": "duplicate|conflict|format|incoherence|outlier|uncertain",
      "fields": ["<id>", ...],
      "description": "<lisible>",
      "severity": "low|medium|high",
      "suggestion": { "patch": { "<id>": "<value>" }, "replace_in_entries": [{"find":"","replace":""}], "reason": "<courte>" },
      "clarify_question": "<si pertinent>"
    }
  ]
}
Limites: max 12 issues, descriptions courtes, ne pas inventer.
`;

    const user = `
SECTION_ID=${blockId}
CHAMPS_VALIDES=${JSON.stringify(known)}
CHAMPS_DETAILS=${JSON.stringify(details)}
PROFIL=${JSON.stringify(profile, null, 2)}
ENTRIES=${JSON.stringify(entries, null, 2)}
`;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY missing" }, { status: 500 });
    }

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const raw = r.choices?.[0]?.message?.content || "{}";
    let parsed: { issues?: CleanIssue[] } = {} as any;
    try { parsed = JSON.parse(raw); } catch {}
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];

    const cleanIssues: CleanIssue[] = issues
      .filter(it => it && Array.isArray(it.fields))
      .map(it => ({
        type: (it.type as any) || "uncertain",
        fields: (it.fields || []).filter((f: any) => typeof f === "string"),
        description: String(it.description || "Anomalie détectée").slice(0, 240),
        severity: ["low","medium","high"].includes(String(it.severity)) ? (it.severity as any) : undefined,
        suggestion: it.suggestion && typeof it.suggestion === "object" ? {
          patch: it.suggestion.patch && typeof it.suggestion.patch === "object" ? Object.fromEntries(
            Object.entries(it.suggestion.patch).filter(([k,v]) => typeof k === "string" && typeof v === "string" && known.includes(k))
          ) : undefined,
          replace_in_entries: Array.isArray((it as any).suggestion?.replace_in_entries)
            ? (it as any).suggestion.replace_in_entries
                .filter((r: any) => r && typeof r.find === "string" && typeof r.replace === "string")
                .slice(0, 4)
            : undefined,
          reason: typeof it.suggestion.reason === "string" ? it.suggestion.reason.slice(0, 200) : undefined,
        } : undefined,
        clarify_question: typeof it.clarify_question === "string" ? it.clarify_question.slice(0, 240) : undefined,
      }))
      .slice(0, 12);

    return NextResponse.json({ ok: true, issues: cleanIssues }, { headers: { "x-handler": "clean" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "clean error" }, { status: 500 });
  }
}
