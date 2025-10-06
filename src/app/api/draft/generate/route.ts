// src/app/api/draft/generate/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { Block } from "@/data/blocks";
import { buildSectionMessages } from "@/server/draft/prompts";
import type { EvidenceBundle, EvidenceItem } from "@/server/draft/types";
import type { DraftDoc } from "@/data/draft";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_FAST_MODEL || "gpt-4o-mini";

type Body = {
  blocks: Record<string, Block>;
  blockIds?: string[];
  style?: { person?: "je" | "il" | "elle" };
};

// ---- utils ----
const MONTHS_FR = [
  "janvier","février","mars","avril","mai","juin",
  "juillet","août","septembre","octobre","novembre","décembre"
];

/** Convertit YYYY-MM-DD -> "D mois YYYY" ; sinon renvoie tel quel. */
function formatDateFR(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return value;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!y || !mo || !d || mo < 1 || mo > 12) return value;
  return `${d} ${MONTHS_FR[mo - 1]} ${y}`;
}

/** Transforme le canonique d'un bloc en EvidenceItem[] concis et propres (dates FR). */
function canonicalToEvidenceItems(b: Block): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const resolved = (b.resolved as any) ?? {};
  const entries: string[] = [];

  for (const [key, obj] of Object.entries(resolved)) {
    const raw = String((obj as any)?.value ?? "").trim();
    if (!raw) continue;
    const isDate = /date/i.test(key);
    const val = isDate ? formatDateFR(raw) : raw;
    entries.push(`${key}: ${val}`);
  }

  // On fait 1 à 3 items max pour ne pas étouffer le modèle, mais assez pour la fluidité
  if (entries.length === 0) {
    items.push({ block: b.id, entry: 0, text: "(aucun fait disponible)" });
  } else {
    const chunkSize = Math.ceil(entries.length / Math.min(3, entries.length));
    let entryIdx = 0;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const slice = entries.slice(i, i + chunkSize).join(" · ");
      items.push({ block: b.id, entry: entryIdx++, text: slice });
    }
  }

  return items;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const all = body?.blocks || {};
    const wanted = body?.blockIds?.length ? body.blockIds : Object.keys(all);
    const chosen: Block[] = wanted.map((id) => all[id]).filter(Boolean);

    const person: "je" | "il" | "elle" = body?.style?.person ?? "je";

    const segments = [];
    for (const b of chosen) {
      // 1) On fabrique les evidences proprement depuis le canonique (dates FR)
      const evidence: EvidenceItem[] = canonicalToEvidenceItems(b);

      // 2) On appelle TON prompt builder
      const beats: EvidenceBundle["beats"] = [{ idea: b.title || b.id, evidence }];
      const bundle: EvidenceBundle = {
        identity: {}, // extensible plus tard
        style: { tone: "warm", person, tense: "past", language: "fr" } as const,
        rules: { length: { min: 120, max: 220 } } as const,
        beats,
      };

      const { system, user } = buildSectionMessages(bundle);

      // 3) Appel modèle
      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,   // un peu de liant, pas d'extra
        top_p: 0.9,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });

      // 4) Récupération JSON { title, markdown }
      let title = b.title || b.id;
      let markdown = "";
      try {
        const parsed = JSON.parse(r.choices?.[0]?.message?.content ?? "{}");
        if (typeof parsed?.title === "string" && parsed.title.trim()) title = parsed.title.trim();
        markdown = String(parsed?.markdown ?? "").trim();
      } catch {
        markdown = "";
      }

      // 5) Assemblage segment (aucune ancre ici)
      const heading = title.trim();
      const text = (heading ? `## ${heading}\n\n` : "") + markdown;

      segments.push({
        id: `${b.id}_ai_0`,
        text,
        anchors: [],                // ✅ pas de surlignage dans ce mode
        blockId: b.id,
        blockTitle: title,
      });
    }

    const doc: DraftDoc = { version: 1, segments };
    return NextResponse.json(doc);
  } catch (e: any) {
    console.error("draft/generate error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
