// src/app/outline/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useBlocks } from "@/hooks/useBlocks";

// ===== Types locaux (alignés avec le backend) =====
type EvidenceRef = { block: string; entry: number };
type OutlineBeat = { idea: string; evidence: EvidenceRef[] };
type OutlineSection = { title: string; beats: OutlineBeat[] };
type OutlineChapter = { title: string; summary: string; sections: OutlineSection[] };
type BookOutline = {
  mode: "Timeline";
  title: string;
  chapters: OutlineChapter[];
  coverage: { must_uncovered: string[] };
};

type ContextPack = {
  identity: Record<string, string>;
  blocks: {
    id: string;
    progress: number;
    highlights: { entry: number; text: string }[];
    must_covered?: string[];
    good_covered?: string[];
    resolved?: Record<string, { value: string }>;
  }[];
  style: {
    tone: "warm" | "neutral" | "formal";
    person: "je" | "il" | "elle";
    tense: "past" | "present";
    language?: "fr";
  };
  constraints: { maxChapters?: number; maxSectionsPerChapter?: number };
  target?: { workingTitle?: string };
};

type EvidenceItem = { block: string; entry: number; text: string };
type EvidenceBeatInput = { idea: string; evidence: EvidenceItem[] };
type EvidenceBundle = {
  identity: Record<string, string>;
  beats: EvidenceBeatInput[];
  style: ContextPack["style"];
  rules: {
    length?: { min?: number; max?: number };
    citations?: "anchors";
    grounding?: "strict";
    gaps?: "mark";
    avoid_repeating?: string[];
    focus_intro?: string;
    subject_name?: string;
    ban_subject_name_when_je?: boolean;
    ban_identity_fields_without_evidence?: boolean;
  };
};

type SectionDraft = { title: string; markdown: string; used_evidence: EvidenceRef[] };

// ===== Persistance locale =====
const LS_OUTLINE = "ms_outline_v1";
const LS_DRAFTS = "ms_drafts_v2";     // v2 : inclut used_keys + source_digest
const LS_EIMAP   = "ms_outline_eimap_v1"; // map index→EID (fige les preuves du plan)

// — Drafts enrichis (pour badge “à rafraîchir”)
type StoredDraft = SectionDraft & {
  sectionId: string;
  used_keys: string[];   // ["block#eid", ... , "identite@surnom", ...]
  source_digest: string; // hash du contenu courant de ces keys
  updatedAt: number;
};
type DraftStore = Record<string, StoredDraft>; // clé = sectionId

// — Map “index -> EID” figée au moment du plan
type EvidenceIndexMap = Record<string, Array<{ block: string; entry: number; eid: number }>>;

// ===== Helpers LocalStorage =====
function loadOutlineFromLS(): { outline: BookOutline | null; person: "je" | "il" | "elle" } {
  try {
    const raw = localStorage.getItem(LS_OUTLINE);
    if (!raw) return { outline: null, person: "je" };
    const obj = JSON.parse(raw);
    return { outline: obj.outline ?? null, person: obj.person ?? "je" };
  } catch {
    return { outline: null, person: "je" };
  }
}
function saveOutlineToLS(outline: BookOutline | null, person: "je" | "il" | "elle") {
  try { localStorage.setItem(LS_OUTLINE, JSON.stringify({ outline, person })); } catch {}
}
function loadDraftsFromLS(): DraftStore {
  try {
    const raw = localStorage.getItem(LS_DRAFTS);
    return raw ? (JSON.parse(raw) as DraftStore) : {};
  } catch { return {}; }
}
function saveDraftsToLS(store: DraftStore) {
  try { localStorage.setItem(LS_DRAFTS, JSON.stringify(store)); } catch {}
}
function loadEimap(): EvidenceIndexMap {
  try { return JSON.parse(localStorage.getItem(LS_EIMAP) || "{}"); } catch { return {}; }
}
function saveEimap(map: EvidenceIndexMap) {
  try { localStorage.setItem(LS_EIMAP, JSON.stringify(map)); } catch {}
}

// ===== Utilitaires =====
// Id de section déterministe : titre + références d’évidence affichées dans le plan
function sectionIdOf(section: OutlineSection): string {
  const ref = section.beats?.flatMap(b => (b.evidence || []).map(ev => `${ev.block}:${ev.entry}`))?.join("|") || "";
  const slug = section.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
  return `${slug}__${ref}`.slice(0, 160);
}

// Texte d’une entrée Q/R
function textOfEntry(entry: any): string {
  if (!entry || entry.type !== "texte") return "";
  const q = (entry.q ?? "").toString().trim();
  const a = (entry.a ?? "").toString().trim();
  return (q && a) ? `${q}\n${a}` : (q || a);
}

// Recherche par EID (ts)
function textFromKey(blocks: any, key: string): string {
  const [bid, eidStr] = key.split("#");
  const eid = Number(eidStr);
  const blk = blocks?.[bid];
  if (!blk || !Array.isArray(blk.entries)) return "";
  const found = blk.entries.find((e: any) => e?.ts === eid);
  return textOfEntry(found);
}

// Valeur courante d’une source (Q/R par EID ou identité résolue)
function valueForKey(blocks: any, key: string): string {
  if (key.startsWith("identite@")) {
    const slot = key.slice("identite@".length);
    const v = blocks?.identite?.resolved?.[slot]?.value ?? "";
    return typeof v === "string" ? v : String(v || "");
  }
  if (key.includes("#")) return textFromKey(blocks, key);
  return "";
}

// Hash DJB2 simple
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// Digest stable des sources (Q/R EIDs + identité)
function digestFromKeys(blocks: any, used_keys: string[]): string {
  const parts: string[] = [];
  for (const k of used_keys) parts.push(`[${k}]::${valueForKey(blocks, k)}`);
  return djb2(parts.join("\n---\n"));
}

export default function OutlinePage() {
  const { blocks, loading } = useBlocks();

  // États généraux
  const [busy, setBusy] = useState(false);
  const [loose, setLoose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outline, setOutline] = useState<BookOutline | null>(null);

  // États par sectionId
  const [drafts, setDrafts] = useState<Record<string, SectionDraft | null>>({});
  const [draftBusy, setDraftBusy] = useState<Record<string, boolean>>({});
  const [draftErr, setDraftErr] = useState<Record<string, string | null>>({});
  const [stale, setStale] = useState<Record<string, boolean>>({});

  // Personne grammaticale
  const [person, setPerson] = useState<"je" | "il" | "elle">("je");

  // Hydratation LS
  useEffect(() => {
    const { outline: savedOutline, person: savedPerson } = loadOutlineFromLS();
    if (savedOutline && !outline) setOutline(savedOutline);
    if (savedPerson) setPerson(savedPerson);

    const store = loadDraftsFromLS();
    const plain: Record<string, SectionDraft | null> = {};
    for (const sid of Object.keys(store)) {
      const d = store[sid];
      plain[sid] = { title: d.title, markdown: d.markdown, used_evidence: d.used_evidence };
    }
    setDrafts(plain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recalcul badge “stale” quand blocks changent
  useEffect(() => {
    if (!blocks) return;
    const store = loadDraftsFromLS();
    const flags: Record<string, boolean> = {};
    for (const sid of Object.keys(store)) {
      const d = store[sid];
      const nowDigest = digestFromKeys(blocks, d.used_keys || []);
      flags[sid] = (nowDigest !== d.source_digest);
    }
    setStale(flags);
  }, [blocks]);

  // Construit le contexte pour l’IA
  const context = useMemo<ContextPack | null>(() => {
    if (loading || !blocks) return null;

    const ident = (blocks as any)["identite"];
    const identity: Record<string, string> = {};
    if (ident?.resolved && typeof ident.resolved === "object") {
      for (const k of Object.keys(ident.resolved)) {
        const v = ident.resolved[k]?.value;
        if (typeof v === "string" && v.trim()) identity[k] = v.trim();
      }
    }

    function collectHighlights(bid: string, max = 4) {
      const blk = (blocks as any)[bid];
      if (!blk) return [];
      const h: { entry: number; text: string }[] = [];
      const entries = Array.isArray(blk.entries) ? blk.entries : [];
      for (let i = 0; i < entries.length && h.length < max; i++) {
        const txt = textOfEntry(entries[i]);
        if (!txt) continue;
        const snip = txt.length > 280 ? txt.slice(0, 277) + "..." : txt;
        h.push({ entry: i, text: snip });
      }
      return h;
    }

    const packBlocks: ContextPack["blocks"] = Object.keys(blocks).map((id) => {
      const b: any = (blocks as any)[id];
      const resolved = (b?.resolved && typeof b.resolved === "object") ? b.resolved : undefined;
      return { id, progress: Number(b?.progress ?? 0), highlights: collectHighlights(id, 4), resolved };
    });

    const style: ContextPack["style"] = { tone: "warm", person, tense: "past", language: "fr" };
    const constraints: ContextPack["constraints"] = { maxChapters: 8, maxSectionsPerChapter: 2 };
    const target: ContextPack["target"] = {
      workingTitle: identity["nom_prenom"] ? `La vie de ${identity["nom_prenom"]}` : "Working Title",
    };

    return { identity, blocks: packBlocks, style, constraints, target };
  }, [blocks, loading, person]);

  // Générer le plan
  async function generateOutline() {
    if (!context) return;
    setBusy(true);
    setError(null);
    try {
      const url = `/api/draft/outline${loose ? "?loose=1" : ""}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        setError(JSON.stringify(json, null, 2));
        return;
      }
      const outlineObj = json.outline as BookOutline;
      setOutline(outlineObj);
      saveOutlineToLS(outlineObj, person);

      // — Photo des EIDs des preuves (index → EID) au moment du plan
      const eimap: EvidenceIndexMap = {};
      for (const ch of outlineObj.chapters) {
        for (const s of ch.sections) {
          const sid = sectionIdOf(s);
          const arr: Array<{ block: string; entry: number; eid: number }> = [];
          for (const b of s.beats) {
            for (const ev of (b.evidence || [])) {
              const blk: any = (blocks as any)?.[ev.block];
              const ent = blk?.entries?.[ev.entry];
              const eid = typeof ent?.ts === "number" ? ent.ts : -1;
              if (eid > 0) arr.push({ block: ev.block, entry: ev.entry, eid });
            }
          }
          eimap[sid] = arr;
        }
      }
      saveEimap(eimap);

      // On ne vide pas les drafts LS (ils seront réutilisés si sectionId identique)
      setDraftBusy({});
      setDraftErr({});
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Préparer le bundle pour une section (relit les textes via EID si dispo)
  function makeBundle(section: OutlineSection): EvidenceBundle | null {
    if (!blocks || !context) return null;

    const eimap = loadEimap();
    const sid = sectionIdOf(section);
    const mapForSection = new Map<string, number>(); // `${block}:${entry}` -> eid
    for (const rec of (eimap[sid] || [])) {
      mapForSection.set(`${rec.block}:${rec.entry}`, rec.eid);
    }

    const beats: EvidenceBeatInput[] = section.beats
      .map((b) => {
        const items: EvidenceItem[] = (b.evidence || [])
          .map((ev) => {
            const key = `${ev.block}:${ev.entry}`;
            const eid = mapForSection.get(key);
            if (eid) {
              const blk = (blocks as any)?.[ev.block];
              const entry = Array.isArray(blk?.entries) ? blk.entries.find((e: any) => e?.ts === eid) : null;
              const text = textOfEntry(entry);
              return { block: ev.block, entry: ev.entry, text };
            }
            // Fallback si pas d’EID (rare)
            const blk = (blocks as any)?.[ev.block];
            const entry = blk?.entries?.[ev.entry];
            const text = textOfEntry(entry);
            return { block: ev.block, entry: ev.entry, text };
          })
          .filter((x) => !!x.text);
        return { idea: b.idea, evidence: items };
      })
      .filter((bb) => bb.evidence.length > 0);

    if (beats.length === 0) return null;

    const avoidRepeating = [
      context.identity?.nom_prenom || null,
      context.identity?.date_naissance || null,
      context.identity?.lieu_naissance || null,
    ].filter(Boolean) as string[];

    const focusIntro = `${section.title} — ${section.beats?.[0]?.idea ?? ""}`.trim();

    return {
      identity: context.identity,
      beats,
      style: context.style,
      rules: {
        length: { min: 600, max: 1200 },
        citations: "anchors",
        grounding: "strict",
        gaps: "mark",
        avoid_repeating: avoidRepeating,
        focus_intro: focusIntro,
        subject_name: context.identity?.nom_prenom,
        ban_subject_name_when_je: context.style.person === "je",
        ban_identity_fields_without_evidence: true,
      },
    };
  }

  // Rédiger une section
  async function draftSection(section: OutlineSection) {
    const sid = sectionIdOf(section);
    const bundle = makeBundle(section);
    if (!bundle) {
      setDraftErr((prev) => ({ ...prev, [sid]: "Pas d'évidence exploitable pour cette section." }));
      return;
    }

    setDraftBusy((p) => ({ ...p, [sid]: true }));
    setDraftErr((p) => ({ ...p, [sid]: null }));

    try {
      const resp = await fetch("/api/draft/section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle }),
      });
      const json = await resp.json();

      if (!resp.ok || !json?.ok) {
        setDraftErr((p) => ({ ...p, [sid]: JSON.stringify(json, null, 2) }));
        return;
      }

      if (json.warn === "missing_anchors") {
        setDraftErr((p) => ({
          ...p,
          [sid]: "⚠️ Ancres manquantes : une section « Sources » a été ajoutée en bas du texte.",
        }));
      }

      const draft = json.draft as SectionDraft;

      // 1) État mémoire
      setDrafts((p) => ({ ...p, [sid]: draft }));

      // 2) used_keys stables (via EIMAP) + identité si la section touche 'identite'
      const eimap = loadEimap();
      const mapForSection = new Map<string, number>();
      for (const rec of (eimap[sid] || [])) {
        mapForSection.set(`${rec.block}:${rec.entry}`, rec.eid);
      }

      const sectionEvidence = section.beats.flatMap(b => b.evidence || []);
      const entryKeys = sectionEvidence
        .map(ev => {
          const eid = mapForSection.get(`${ev.block}:${ev.entry}`);
          return eid ? `${ev.block}#${eid}` : null;
        })
        .filter(Boolean) as string[];

      const hasIdentiteEvidence = sectionEvidence.some(ev => ev.block === "identite");
      const identityKeys = hasIdentiteEvidence
        ? Object.keys(((blocks as any)?.identite?.resolved) ?? {}).map(slot => `identite@${slot}`)
        : [];

      const used_keys = Array.from(new Set([...entryKeys, ...identityKeys]));

      // 3) Persister avec digest
      const store = loadDraftsFromLS();
      const source_digest = digestFromKeys(blocks, used_keys);
      store[sid] = {
        ...draft,
        sectionId: sid,
        used_keys,
        source_digest,
        updatedAt: Date.now(),
      };
      saveDraftsToLS(store);

      // 4) Badge à false juste après génération
      setStale((prev) => ({ ...prev, [sid]: false }));
    } catch (e: any) {
      setDraftErr((p) => ({ ...p, [sid]: String(e?.message || e) }));
    } finally {
      setDraftBusy((p) => ({ ...p, [sid]: false }));
    }
  }

  // ===== UI =====
  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Aperçu du plan — <span className="italic">Timeline</span>
        </h1>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-2">
            <span>Narration</span>
            <select
              value={person}
              onChange={(e) => { const p = e.target.value as "je" | "il" | "elle"; setPerson(p); saveOutlineToLS(outline, p); }}
              className="border rounded px-2 py-1 text-sm"
              title="Choisir la personne grammaticale"
            >
              <option value="je">1ʳᵉ personne (je)</option>
              <option value="il">3ᵉ personne (il)</option>
              <option value="elle">3ᵉ personne (elle)</option>
            </select>
          </label>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={loose} onChange={(e) => setLoose(e.target.checked)} />
            Mode rapide
          </label>
          <button
            disabled={loading || !context || busy}
            onClick={generateOutline}
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
          >
            {busy ? "Génération…" : "Générer le plan"}
          </button>
        </div>
      </header>

      {/* Contexte minimal */}
      <section className="bg-gray-50 border rounded-lg p-4">
        <p className="text-sm text-gray-700">
          Identité :{" "}
          {context?.identity?.nom_prenom ? <b>{context.identity.nom_prenom}</b> : <em>non renseignée</em>}
          {" "}• Blocs : <b>{context?.blocks?.length ?? 0}</b>
        </p>
      </section>

      {error && (
        <pre className="whitespace-pre-wrap text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </pre>
      )}

      {outline && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{outline.title}</h2>
            <div className={`px-3 py-1 rounded-full text-sm ${
              outline.coverage.must_uncovered.length === 0 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
            }`}>
              Must couverts : {outline.coverage.must_uncovered.length === 0 ? "OK" : `à compléter (${outline.coverage.must_uncovered.length})`}
            </div>
          </div>

          <div className="space-y-6">
            {outline.chapters.map((ch, ci) => (
              <div key={ci} className="border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-1">{ch.title}</h3>
                <p className="text-sm text-gray-700 mb-3">{ch.summary}</p>

                <div className="space-y-4">
                  {ch.sections.map((s, si) => {
                    const sid = sectionIdOf(s);
                    const d = drafts[sid] || null;
                    const be = !!draftBusy[sid];
                    const er = draftErr[sid] || null;
                    const isStale = !!stale[sid];

                    return (
                      <div key={si} className="bg-white border rounded-lg p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium">{s.title}</h4>
                            {isStale && (
                              <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800 border">
                                à rafraîchir (sources modifiées)
                              </span>
                            )}
                          </div>
                          <button
                            className="text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                            onClick={() => draftSection(s)}
                            disabled={be}
                            title={isStale ? "Mettre à jour cette section" : "Rédiger cette section"}
                          >
                            {be ? "Rédaction…" : (isStale ? "Mettre à jour" : "Rédiger cette section")}
                          </button>
                        </div>

                        <ul className="list-disc pl-5 space-y-1">
                          {s.beats.map((b, bi) => (
                            <li key={bi} className="text-sm">
                              {b.idea}{" "}
                              {b.evidence?.length > 0 && (
                                <span className="ml-2 text-xs text-gray-600">
                                  {b.evidence.map((ev, ei) => (
                                    <span key={ei} className="inline-block mr-1 px-2 py-0.5 rounded bg-gray-100 border">
                                      B:{ev.block} E:{ev.entry}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                        {er && (
                          <pre className="whitespace-pre-wrap text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                            {er}
                          </pre>
                        )}

                        {d && (
                          <div className="border-t pt-2">
                            <h5 className="font-medium mb-2">Brouillon</h5>
                            <pre className="whitespace-pre-wrap text-sm bg-gray-50 border rounded p-3">
                              {d.markdown}
                            </pre>
                            <div className="mt-2 text-xs text-gray-600">
                              Évidence utilisée :{" "}
                              {d.used_evidence.map((ev, i) => (
                                <span key={i} className="inline-block mr-1 px-2 py-0.5 rounded bg-gray-100 border">
                                  B:{ev.block} E:{ev.entry}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
