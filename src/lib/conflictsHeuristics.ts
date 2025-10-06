// src/lib/conflictsHeuristics.ts
import type { Entry } from "@/data/blocks";

export type HeuristicConflict = {
  id: string;
  type: "fact_conflict" | "temporal_conflict" | "soft_conflict";
  slotId?: string;
  severity: "low" | "med" | "high";
  explanation: string;
  evidenceEntryIdx?: number[];
  createdAt: number;
};

/** Utils très simples pour extraire des indices */
function norm(s: string) { return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function extractYears(text: string): number[] {
  const years = new Set<number>();
  const re = /\b(19\d{2}|20\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) years.add(Number(m[1]));
  return [...years];
}

function extractBirthMentions(text: string): string[] {
  // capture mots autour de “né(e) à” / “naissance à”
  const t = norm(text);
  const m = t.match(/ne[ée]\s+(?:a|à)\s+([a-z\u00e0-\u00ff\s\-']{2,30})/i);
  const n = t.match(/naissance\s+(?:a|à)\s+([a-z\u00e0-\u00ff\s\-']{2,30})/i);
  const out: string[] = [];
  if (m?.[1]) out.push(m[1].trim());
  if (n?.[1]) out.push(n[1].trim());
  return out;
}

/** Heuristiques: renvoie 0..n conflits "soft/med" à confirmer/raffiner par LLM */
export function runLocalHeuristics(entries: Entry[], content?: string): HeuristicConflict[] {
  const conflicts: HeuristicConflict[] = [];
  const lines: { text: string; idx: number }[] = [];

  entries.forEach((e, i) => {
    const t = `${(e as any).q ?? ""}\n${(e as any).a ?? ""}`.trim();
    if (t) lines.push({ text: t, idx: i });
  });
  if (content && content.trim()) lines.push({ text: content.trim(), idx: -1 });

  // 1) multi-valeurs stables: naissance à X vs Y
  const births: Array<{ place: string; idx: number }> = [];
  lines.forEach(({ text, idx }) => {
    for (const p of extractBirthMentions(text)) births.push({ place: p, idx });
  });
  const uniquePlaces = Array.from(new Set(births.map(b => b.place)));
  if (uniquePlaces.length > 1) {
    conflicts.push({
      id: `birth_place:${uniquePlaces.sort().join("|")}`,
      type: "fact_conflict",
      slotId: "lieu_naissance",
      severity: "med",
      explanation: `Lieu de naissance multiple: ${uniquePlaces.join(" / ")}`,
      evidenceEntryIdx: births.map(b => b.idx).filter(i => i >= 0),
      createdAt: Date.now(),
    });
  }

  // 2) chrono grossière: années hors ordre (ex: “travail 2010” puis “diplôme 2013” sans contexte)
  // => on reste prudent: on ne déclare pas un conflit direct, juste "soft"
  const allYears = lines.flatMap(l => extractYears(l.text)).sort((a, b) => a - b);
  if (allYears.length >= 2) {
    // si des années s'entrecroisent "fort" (très proche et inversions multiples), flag soft
    // (v1 minimale: si plus de 4 années et pattern zigzag) — très conservateur
    let zigzag = 0;
    for (let i = 2; i < allYears.length; i++) {
      const a = allYears[i - 2], b = allYears[i - 1], c = allYears[i];
      if ((a < b && c < b) || (a > b && c > b)) zigzag++;
    }
    if (zigzag >= 2) {
      conflicts.push({
        id: `chrono_zigzag:${allYears.join(",")}`,
        type: "temporal_conflict",
        severity: "low",
        explanation: "Chronologie possiblement incohérente (années en zigzag).",
        createdAt: Date.now(),
      });
    }
  }

  return conflicts;
}
