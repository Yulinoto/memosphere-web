// src/data/draft.ts
import type { Block } from "@/data/blocks";

export type DraftAnchor = {
  slotId: string;                 // clé canonique (resolved)
  span: [number, number];         // offsets [start, end)
  blockId: string;                // bloc d'origine
};

export type DraftSegment = {
  id: string;                     // ex: "identite_0"
  text: string;                   // texte rendu
  anchors?: DraftAnchor[];        // ancrages canoniques
  blockId?: string;               // id du bloc (affichage)
  blockTitle?: string;            // titre du bloc (affichage)
  lastSyncHash?: string;          // réservé (resync fin)
};

export type DraftDoc = {
  segments: DraftSegment[];
  version: number;
};

// Utilitaires pour le placeholder (garde si tu veux la génération sans IA)
function findAllOccurrences(text: string, needle: string): [number, number][] {
  const spans: [number, number][] = [];
  if (!needle) return spans;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    spans.push([idx, idx + needle.length]);
    idx += needle.length;
  }
  return spans;
}

export function buildInitialDraftFromBlocks(blocks: Block[]): DraftDoc {
  const segments: DraftSegment[] = [];

  for (const b of blocks) {
    const title = b.title || b.id || "section";
    const canonical = Object.fromEntries(
      Object.entries(b.resolved ?? {}).map(([k, v]: any) => [k, (v?.value ?? "").toString()])
    );

    let text = `${title}\n\n`;
    const entries: string[] = [];
    for (const [slotId, val] of Object.entries(canonical)) {
      if (!val) continue;
      entries.push(`${slotId}: ${val}`);
    }
    text += entries.join("\n");

    const anchors: DraftAnchor[] = [];
    for (const [slotId, val] of Object.entries(canonical)) {
      const spans = findAllOccurrences(text, String(val));
      for (const span of spans) {
        anchors.push({ slotId, span, blockId: b.id });
      }
    }

    segments.push({
      id: `${b.id}_0`,
      text,
      anchors,
      blockId: b.id,
      blockTitle: title,
      lastSyncHash: "",
    });
  }

  return { segments, version: 1 };
}

export function resyncDraftWithBlocks(draft: DraftDoc, blocks: Block[]): DraftDoc {
  const byBlock: Record<string, Block> = Object.fromEntries(blocks.map(b => [b.id, b]));
  const next: DraftDoc = { ...draft, segments: draft.segments.map(s => ({ ...s })) };

  for (const seg of next.segments) {
    if (!seg.anchors?.length) continue;
    let offsetDelta = 0;
    for (let i = 0; i < seg.anchors.length; i++) {
      const a = seg.anchors[i];
      const blk = byBlock[a.blockId];
      const newVal = String(blk?.resolved?.[a.slotId]?.value ?? "");
      const [start0, end0] = a.span;
      const start = start0 + offsetDelta;
      const end = end0 + offsetDelta;

      const current = seg.text.slice(start, end);
      if (newVal && current !== newVal) {
        seg.text = seg.text.slice(0, start) + newVal + seg.text.slice(end);
        const delta = newVal.length - (end - start);
        offsetDelta += delta;
        seg.anchors[i] = { ...a, span: [start0, end0 + delta] };
      }
    }
  }
  return next;
}
