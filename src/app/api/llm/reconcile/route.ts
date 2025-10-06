import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import schemaJson from "@/data/interviewSchema.json";

export const runtime = "nodejs";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

type Proposal = {
  field: string;        // id exact du champ (ex: "nom_prenom")
  old?: string | null;  // valeur perçue actuelle
  new: string;          // valeur proposée depuis le résumé
  reason?: string;      // pourquoi (cohérence, correction orthographe, etc.)
  confidence?: number;  // 0..1
};

export async function POST(req: NextRequest) {
  try {
    const { blockId, summaryText = "", current = {} } = await req.json();

    if (!blockId || typeof blockId !== "string") {
      return NextResponse.json({ ok: false, error: "Missing blockId" }, { status: 400 });
    }

    const sec: any = (schemaJson as any)[blockId] || {};
    const must: string[] = Array.isArray(sec.must_have) ? sec.must_have : [];
    const good: string[] = Array.isArray(sec.good_to_have) ? sec.good_to_have : [];
    const slots: string[] = Array.isArray(sec.slots) ? sec.slots.map((s: any) => String(s.id)) : [];
    const known = Array.from(new Set([...must, ...good, ...slots]));

    const sys = `
Tu es un assistant de réconciliation de données biographiques.
Tu reçois:
- SECTION_ID
- CHAMPS_VALIDES = liste d'identifiants de champs autorisés (IDs exacts du schéma)
- PROFIL_ACTUEL = { champ: valeur } (peut être incomplet)
- RESUME_TEXTE = résumé édité par l’utilisateur

Tâche:
- Trouver dans RESUME_TEXTE des valeurs fiables pour des champs de CHAMPS_VALIDES.
- Comparer à PROFIL_ACTUEL et proposer des corrections ciblées uniquement si:
  * orthographe normalisée (ex: Rosier -> Rozier), ou
  * informations plus précises (date complète, lieu détaillé), ou
  * évidence claire de remplacement.
- Ne JAMAIS inventer.
- Retourne STRICTEMENT un JSON:
{
  "proposals": [
    { "field": "<id>", "old": "<ancienne ou null>", "new": "<nouvelle>", "reason": "<texte court>", "confidence": 0.0..1.0 }
  ]
}
- Ne propose que des champs dont l'id est dans CHAMPS_VALIDES.
- 0 à 8 propositions max.
- Si aucune proposition fiable: "proposals":[]
`;

    const user = `
SECTION_ID=${blockId}
CHAMPS_VALIDES=${JSON.stringify(known)}
PROFIL_ACTUEL=${JSON.stringify(current, null, 2)}
RESUME_TEXTE:
"""
${String(summaryText || "").slice(0, 8000)}
"""
`;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
    });

    const raw = r.choices?.[0]?.message?.content || "{}";
    let parsed: { proposals?: Proposal[] } = {};
    try { parsed = JSON.parse(raw); } catch {}
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];

    // gardes-fous
    const filtered = proposals
      .filter(p => p && typeof p.field === "string" && typeof p.new === "string" && known.includes(p.field))
      .map(p => ({
        field: p.field,
        old: typeof p.old === "string" ? p.old : (p.old ?? null),
        new: p.new.trim(),
        reason: typeof p.reason === "string" ? p.reason.slice(0, 200) : undefined,
        confidence: Math.max(0, Math.min(1, Number(p.confidence ?? 0.6))),
      }))
      .slice(0, 8);

    return NextResponse.json({ ok: true, proposals: filtered }, { headers: { "x-handler": "reconcile" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "reconcile error" }, { status: 500 });
  }
}
