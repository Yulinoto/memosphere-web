// src/app/api/llm/gaps/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import schemaJson from "@/data/interviewSchema.json";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type Entry = { q?: string; a?: string; ts?: number };
type SlotStatus = "present" | "partial" | "missing" | "conflict";

type ChecklistEntry = {
  status: SlotStatus;
  confidence: number;
  evidenceEntryIdx?: number[];
};

// --- helpers: slug + slots dérivés depuis must_have (si pas de schema.slots) ---
function slugify(s: string) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function deriveSlotsFromSchema(subSchema: any): Array<{ id: string; label: string; weight?: number; hints?: string[] }> {
  if (Array.isArray(subSchema?.slots) && subSchema.slots.length) return subSchema.slots;
  if (!Array.isArray(subSchema?.must_have)) return [];
  // on dérive un slot par "must_have" avec quelques mots-clés naïfs
  return subSchema.must_have.map((label: string) => {
    const id = slugify(label);
    // hints : on prend quelques mots >= 4 lettres pour l’heuristique
    const hints = String(label)
      .toLowerCase()
      .split(/[^a-zàâäéèêëîïôöùûüç0-9]+/i)
      .filter((w) => w.length >= 4)
      .slice(0, 6);
    return { id, label, weight: 1, hints };
  });
}

// --- heuristique locale (déterministe) ---
function cheapHeuristics(entries: Entry[], blockId: string) {
  const out: Record<string, ChecklistEntry> = {};
  const blk: any = (schemaJson as any)[blockId];
  if (!blk) return out;

  const slots = deriveSlotsFromSchema(blk);
  if (!slots.length) return out;

  const flat = entries
    .map((e) => `${e.q ?? ""}\n${e.a ?? ""}`.toLowerCase())
    .join("\n\n");

  for (const slot of slots) {
    const hints: string[] = Array.isArray(slot.hints) ? slot.hints : [];
    if (!hints.length) continue;

    let hit = 0;
    for (const h of hints) {
      if (!h) continue;
      if (flat.includes(h.toLowerCase())) hit++;
    }
    if (hit >= 2) {
      out[slot.id] = { status: "present", confidence: 0.7 };
    } else if (hit >= 1) {
      out[slot.id] = { status: "partial", confidence: 0.55 };
    }
  }
  return out;
}

function computeProgress(checklist: Record<string, ChecklistEntry>, blockId: string) {
  const blk: any = (schemaJson as any)[blockId];
  if (!blk) return 0;
  const slots = deriveSlotsFromSchema(blk);
  if (!slots.length) return 0;

  let wsum = 0, got = 0;
  for (const slot of slots) {
    const w = Number(slot.weight) || 1;
    wsum += w;
    const st = checklist[slot.id]?.status ?? "missing";
    got += w * (st === "present" ? 1 : st === "partial" ? 0.5 : 0);
  }
  return wsum ? Math.max(0, Math.min(100, Math.round((got / wsum) * 100))) : 0;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json();
    const blockId: string = body.blockId;
    const entries: Entry[] = Array.isArray(body.entries) ? body.entries : [];
    const providedSchema: any = body.schema;
    const subSchema: any = providedSchema || (schemaJson as any)[blockId];

    if (!blockId || !subSchema) {
      return NextResponse.json({ ok: false, error: "Missing blockId or schema" }, { status: 400 });
    }

    // compact Q/R pour prompt
    const compact = entries.slice(-40).map((e, i) => ({
      i,
      q: (e.q || "").slice(0, 240),
      a: (e.a || "").slice(0, 1200),
    }));

    // Heuristique locale (jamais vide si must_have existe)
    const heur = cheapHeuristics(entries, blockId);

    // Prépare slots (source de vérité envoyée au LLM)
    const slots = deriveSlotsFromSchema(subSchema);

    const system = [
      "Tu es un contrôleur de complétude pour une interview.",
      "À partir des Q/R brutes et d'un schéma d'objectifs (slots), rends STRICTEMENT un JSON.",
      "Pour chaque slot: status ∈ {present, partial, missing, conflict}, confidence ∈ [0,1], evidenceEntryIdx? (indices d'entries).",
      "Propose aussi 0..3 relances (courtes, orales, fr-FR) pour les slots manquants/partiels.",
      "N'invente pas de contenus; ne réponds pas à la place de l'utilisateur.",
      'Sortie: { "checklist": { "<slotId>": { "status": "...", "confidence": 0.0, "evidenceEntryIdx": [i,j]? } }, "relances": [{ "slotId":"...","reason":"...","question":"...","priority":1|2|3 }] }',
    ].join("\n");

    const user = {
      blockId,
      goal: subSchema.goal ?? "",
      style: subSchema.style ?? "",
      slots,          // <<— ids & labels cohérents avec l’UI
      entries: compact,
      heuristics: heur,
    };

    // Appel LLM (format JSON strict)
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      max_tokens: 800,
    });

    const text = resp.choices?.[0]?.message?.content || "{}";
    const cleaned = text.trim().replace(/^```json\s*|\s*```$/g, "");
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[gaps] JSON parse failed:", text);
      // Fallback doux: on renvoie seulement l’heuristique (pas d’erreur 500)
      const progressFallback = computeProgress(heur, blockId);
      return NextResponse.json(
        { ok: true, blockId, checklist: heur, progress: progressFallback, relances: [] },
        { status: 200 }
      );
    }

    const checklist: Record<string, ChecklistEntry> = parsed?.checklist || {};
    // merge heuristiques (n’écrase pas le LLM si présent)
    for (const [k, v] of Object.entries(heur)) {
      if (!checklist[k]) checklist[k] = v;
    }

    const progress = computeProgress(checklist, blockId);

    return NextResponse.json(
      { ok: true, blockId, checklist, progress, relances: parsed?.relances || [] },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[/api/llm/gaps] error:", e?.message || e);
    // Fallback safe (pas de 500 visible côté UI)
    return NextResponse.json({ ok: true, checklist: {}, progress: 0, relances: [] }, { status: 200 });
  }
}
