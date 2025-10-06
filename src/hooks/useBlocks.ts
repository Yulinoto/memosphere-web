"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { BlocksState, Entry, Block, ResolvedValue } from "@/data/blocks";
import { loadBlocks, saveBlocks, resetBlocks } from "@/lib/storage";
import schemaJson from "@/data/interviewSchema.json";
import { DEFAULT_BLOCKS } from "@/data/blocks";
import { openaiAdapter } from "@/server/llm/providers/openai";
import { extractNameParts } from "@/utils/extractNameParts"; 



/** Pondération simple */
function cov(status: "present" | "partial" | "missing" | "conflict") {
  if (status === "present") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

/**
 * Progress = couverture du schéma (règle unifiée pour TOUS les blocs)
 * - present si valeur canonique (resolved) OU override checklist
 * - partial si indices textuels (hint) dans les entrées
 * - missing sinon
 * Pondération : must_have = 80%, good_to_have = 20%
 * AUCUN lien avec le nombre d’entrées.
 */
// 🔒 modif Naya — progression unifiée must/good (labels normalisés, slots optionnels)
function recomputeProgress(block: Block): number {
  const schema: any = (schemaJson as any)[block.id] || {};
  const resolved: Record<string, ResolvedValue> = ((block as any).resolved || {}) as any;
  const checklist: Record<string, any> = ((block as any).checklist || {}) as any;

  // --- helpers locaux ---
  const rmAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const norm = (s: string) =>
    rmAccents(String(s || ""))
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")                // enlève "(…)" ex: "(et origine)"
      .replace(/\b(?:a|à)\s+la\s+naissance\b/g, " ") // tolère "à la naissance"
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const textNorm = (s: string) => norm(s); // même normalisation pour texte

  const mustLabels: string[] = Array.isArray(schema.must_have) ? schema.must_have : [];
  const goodLabels: string[] = Array.isArray(schema.good_to_have) ? schema.good_to_have : [];

  if (mustLabels.length + goodLabels.length === 0) return 0;

  // Map label(normalisé) -> slotId si slots existent (utile pour Identité)
  const slots = Array.isArray(schema.slots) ? schema.slots : [];
  const labelToId = new Map<string, string>();
  for (const s of slots) {
    const labNorm = norm(s?.label || "");
    const sid = String(s?.id || "").trim();
    if (labNorm && sid) labelToId.set(labNorm, sid);
  }

  // Concatène Q+A (normalisé) pour hints "partial"
  const bigText = (block.entries || [])
    .filter((e: Entry) => e.type === "texte")
    .flatMap((e: any) => [String(e?.q || ""), String(e?.a || "")])
    .map(textNorm)
    .join("\n");

  const cov = (st: "present" | "partial" | "missing") =>
    st === "present" ? 1 : st === "partial" ? 0.5 : 0;

  const statusFor = (label: string): "present" | "partial" | "missing" => {
    const labNorm = norm(label);

    // 1) checklist (par label normalisé OU par slotId mappé)
    const chk = (() => {
      // cherche clé équivalente dans la checklist (case/accents insensibles)
      for (const k of Object.keys(checklist || {})) {
        if (norm(k) === labNorm) return checklist[k];
      }
      const sid = labelToId.get(labNorm);
      return sid ? checklist[sid] : null;
    })();
    if (chk?.manualOverride === "present" || chk?.status === "present") return "present";
    if (chk?.manualOverride === "partial" || chk?.status === "partial") return "partial";

    // 2) resolved : par slotId (si mappé) OU par label normalisé (blocs sans slots)
    const sid = labelToId.get(labNorm);
    if (sid && resolved?.[sid]?.value && String(resolved[sid].value).trim()) return "present";
    if (!sid) {
      for (const k of Object.keys(resolved || {})) {
        const v = (resolved as any)[k]?.value;
        if (norm(k) === labNorm && v && String(v).trim()) return "present";
      }
    }

    // 3) hint textuel → partial si un token du libellé est repéré dans le texte
    const toks = labNorm.split(/\s+/).filter((w) => w.length >= 3);
    const hasHint = toks.length ? toks.some((w) => bigText.includes(w)) : false;
    return hasHint ? "partial" : "missing";
  };

  const mustScore =
    mustLabels.length
      ? mustLabels.map(statusFor).reduce((a, s) => a + cov(s), 0) / mustLabels.length
      : 1;

  const goodScore =
    goodLabels.length
      ? goodLabels.map(statusFor).reduce((a, s) => a + cov(s), 0) / goodLabels.length
      : 0;

  // must 80% / good 20%
  const score = Math.round((mustScore * 0.8 + goodScore * 0.2) * 100);
  return Math.max(0, Math.min(100, score));
}


/** Sanitize block */
function sanitizeBlock(raw: any): Block {
  const id = String(raw?.id ?? "");
  const title = String((raw?.title ?? id) || "Sans titre");
  const entries: Entry[] = Array.isArray(raw?.entries) ? raw.entries : [];
  const summary = typeof raw?.summary === "string" || raw?.summary === null ? raw.summary : null;
  const pinnedQuestions = Array.isArray(raw?.pinnedQuestions)
    ? raw.pinnedQuestions.map((x: any) => String(x))
    : undefined;
  const content = typeof raw?.content === "string" ? raw.content : "";
  const checklist = raw?.checklist && typeof raw.checklist === "object" ? raw.checklist : undefined;
  // Normalize resolved so that all values are strings
  const resolved = (raw?.resolved && typeof raw.resolved === "object")
    ? Object.fromEntries(
        Object.entries(raw.resolved).map(([k, v]: any) => {
          const valRaw = (v && typeof v === "object" && "value" in v) ? (v as any).value : v;
          let val: string = "";
          if (typeof valRaw === "string") val = valRaw;
          else if (typeof valRaw === "number" || typeof valRaw === "boolean") val = String(valRaw);
          else if (Array.isArray(valRaw)) val = valRaw.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
          else if (valRaw && typeof valRaw === "object") {
            if (typeof (valRaw as any).text === "string") val = (valRaw as any).text;
            else if (typeof (valRaw as any).label === "string") val = (valRaw as any).label;
            else { try { val = JSON.stringify(valRaw); } catch { val = String(valRaw); } }
          } else { val = String(valRaw ?? ""); }
          return [String(k), { value: val, source: (v as any)?.source || (v as any)?.src || "import", at: (v as any)?.at || Date.now() }];
        })
      )
    : undefined;

  const draft: Block = { id, title, progress: 0, entries, summary, pinnedQuestions } as any;
  (draft as any).content = content;
  (draft as any).checklist = checklist;
  (draft as any).resolved = resolved;
  draft.progress = recomputeProgress(draft);
  return draft;
}

/** Sanitize state */
function sanitizeState(raw: any): BlocksState {
  const out: BlocksState = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(raw)) {
    const sb = sanitizeBlock(raw[key]);
    if (sb.id) out[sb.id] = sb;
  }
  return out;
}
// 🔒 modif Naya — garantit la présence des blocs requis (ex: theme_central)
function ensureRequiredBlocks(state: BlocksState): BlocksState {
  const out: BlocksState = { ...state };
  for (const id of Object.keys(DEFAULT_BLOCKS)) {
    if (!out[id]) {
      // on sanitize pour recalculer progress et normaliser la shape
      out[id] = sanitizeBlock(DEFAULT_BLOCKS[id]);
    }
  }
  return out;
}

/* ============================================================
   Extracteurs (gardés tels quels)
   ============================================================ */
function extractCandidates(slotId: string, text: string): string[] {
  const t = String(text || "");
  const dedup = (arr: string[]) =>
    Array.from(new Set(arr.map(s => s.trim().toLowerCase()))).map(
      s => s.charAt(0).toUpperCase() + s.slice(1)
    );

  if (slotId === "nom_prenom") {
    const rx = /\b(je m'appelle|je m apelle|je me nomme|mon nom est)\s+([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60})/gi;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = rx.exec(t))) found.push(m[2].trim());
    return dedup(found);
  }

  if (slotId === "lieu_naissance") {
    const rx = /\b(n[ée]\s+(?:a|à)|naissance\s+(?:a|à))\s+([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60})/gi;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = rx.exec(t))) found.push(m[2].trim());
    return dedup(found);
  }

  // fallback: texte entre guillemets
  const rxQuotes = /["“”‚‘’'»«]{1}\s*([^"“”‚‘’'»«]{2,60})\s*["“”‚‘’'»«]{1}/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rxQuotes.exec(t))) found.push(m[1].trim());
  return dedup(found);
}

/* ============================================================
   Hook
   ============================================================ */
export function useBlocks() {
  const [blocks, setBlocks] = useState<BlocksState | null>(null);
  const [loading, setLoading] = useState(true);
  const blocksRef = useRef<BlocksState | null>(null);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    (async () => {
      const b = await loadBlocks();
      const fixed: BlocksState = {};
      for (const id of Object.keys(b)) fixed[id] = sanitizeBlock(b[id]);
      const completed = ensureRequiredBlocks(fixed); 
      setBlocks(fixed);
      blocksRef.current = fixed;
      setLoading(false);
    })();
  }, []);

  /** persist — race-safe */
  const persist = useCallback(
    async (updater: (prev: BlocksState) => BlocksState) => {
      setBlocks(prev => {
        const base = (prev ?? {}) as BlocksState;
        const next = updater(base);
        blocksRef.current = next;
        saveBlocks(next).catch(() => {});
        return next;
      });
    },
    []
  );
const normalizeToString = (val: any): string => {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map(normalizeToString).join(" ");
  if (typeof val === "object") {
    if (typeof (val as any).value === "string") return (val as any).value;
    if (typeof (val as any).text === "string") return (val as any).text;
    if (typeof (val as any).label === "string") return (val as any).label;
    try { return JSON.stringify(val); } catch { return String(val); }
  }
  return String(val);
};

const setResolved = useCallback(
    async (blockId: string, patch: Record<string, { value: string; source?: string }>) => {
      // 🔥 Auto-extraction prénom + nom si bloc identité et slot nom_prenom présent
    if (blockId === "identite" && patch["nom_prenom"]?.value) {
      const { prenom, nom } = extractNameParts(patch["nom_prenom"].value);
      if (prenom) {
        patch["prenom"] = { value: prenom, source: "auto_split" };
      }
      if (nom) {
        patch["nom"] = { value: nom, source: "auto_split" };
      }
    }
      await persist((prev) => {
        const b = { ...prev };
        const blk = b[blockId];
        if (!blk) return prev;

        const now = Date.now();
        const nextResolved: Record<string, ResolvedValue> = { ...(blk.resolved || {}) };
        for (const key of Object.keys(patch)) {
          const p = patch[key];
          nextResolved[key] = { value: normalizeToString(p.value), source: p.source || "manual", at: now };
        }

        // checklist sync (inchangée)
        const blkSchema: any = (schemaJson as any)[blk.id] || {};
        const slotIds: string[] = Array.isArray(blkSchema?.slots)
          ? blkSchema.slots.map((s: any) => String(s.id))
          : [];
        const must: string[] = Array.isArray(blkSchema?.must_have) ? blkSchema.must_have.map((x: any) => String(x)) : [];
        const good: string[] = Array.isArray(blkSchema?.good_to_have) ? blkSchema.good_to_have.map((x: any) => String(x)) : [];
        const knownKeys = new Set<string>([...slotIds, ...must, ...good]);

        const baseChecklist =
          (blk as any).checklist && typeof (blk as any).checklist === "object"
            ? (blk as any).checklist
            : {};
        const nextChecklist: Record<string, any> = { ...baseChecklist };
        for (const key of Object.keys(patch)) {
          const accept =
            knownKeys.has(key) ||
            knownKeys.has(String(key).trim().toLowerCase());
          if (!accept) continue;
          nextChecklist[key] = {
            ...(nextChecklist[key] || { status: "missing", confidence: 0 }),
            status: "present",
            confidence: 1,
            lastUpdated: now,
            notes: "Fixé via agent/resolved",
          };
        }

        const next: Block = { ...blk, resolved: nextResolved, checklist: nextChecklist as any };
        next.progress = recomputeProgress(next);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );
  const unsetResolved = useCallback(
    async (blockId: string, key: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const blk = b[blockId];
        if (!blk) return prev;

        const nextResolved: Record<string, ResolvedValue> = { ...(blk.resolved || {}) };
        if (key in nextResolved) {
          delete nextResolved[key];
        }

        // checklist: remet à missing si la clé existe dans le schéma
        const blkSchema: any = (schemaJson as any)[blk.id] || {};
        const slotIds: string[] = Array.isArray(blkSchema?.slots)
          ? blkSchema.slots.map((s: any) => String(s.id))
          : [];
        const must: string[] = Array.isArray(blkSchema?.must_have) ? blkSchema.must_have.map((x: any) => String(x)) : [];
        const good: string[] = Array.isArray(blkSchema?.good_to_have) ? blkSchema.good_to_have.map((x: any) => String(x)) : [];
        const knownKeys = new Set<string>([...slotIds, ...must, ...good]);

        const baseChecklist = (blk as any).checklist && typeof (blk as any).checklist === "object" ? (blk as any).checklist : {};
        const nextChecklist: Record<string, any> = { ...baseChecklist };
        if (knownKeys.has(key) || knownKeys.has(String(key).trim().toLowerCase())) {
          nextChecklist[key] = {
            ...(nextChecklist[key] || {}),
            status: "missing",
            confidence: 0,
            lastUpdated: Date.now(),
            notes: "Unset via user",
          };
        }

        const next: Block = { ...blk, resolved: nextResolved, checklist: nextChecklist as any };
        next.progress = recomputeProgress(next);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );
  const addTextEntry = useCallback(
  async (blockId: string, q: string, a: string) => {
    await persist((prev) => {
      const b = { ...prev };
      const block = b[blockId];
      if (!block) return prev;
      const entry: Entry = { type: "texte", q, a, ts: Date.now() };
      const entries = [...block.entries, entry];
      const tmp: Block = { ...block, entries };
      tmp.progress = recomputeProgress(tmp);
      b[blockId] = tmp;
      return b;
    });

    // Une fois le block mis à jour localement, on récupère sa dernière version
    const updated = blocksRef.current?.[blockId];
    if (!updated || !updated.entries?.length) return;

    try {
      const res = await fetch("/api/agent/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: updated.entries }),
      });

      if (!res.ok) {
        console.warn("Échec appel agent/resolve:", await res.text());
        return;
      }

      const autoResolved = await res.json();
      const payload: Record<string, { value: string; source?: string }> = {};
      if (autoResolved && typeof autoResolved === "object") {
        for (const [k, v] of Object.entries(autoResolved)) {
          let text = "";
          if (typeof v === "string") text = v;
          else if (typeof v === "number" || typeof v === "boolean") text = String(v);
          else if (Array.isArray(v)) text = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
          else if (v && typeof v === "object") {
            if (typeof (v as any).value === "string") text = (v as any).value;
            else if (typeof (v as any).text === "string") text = (v as any).text;
            else if (typeof (v as any).label === "string") text = (v as any).label;
            else { try { text = JSON.stringify(v); } catch { text = String(v); } }
          } else { text = String(v ?? ""); }
          payload[String(k)] = { value: text, source: "agent_resolve" };
        }
      }
      if (Object.keys(payload).length) {
        await setResolved(blockId, payload);
      }
    } catch (err) {
      console.error("Erreur agent/resolve:", err);
    }
  },
  [persist, setResolved]
);


  const setSummary = useCallback(
    async (blockId: string, summary: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;
        b[blockId] = { ...block, summary };
        return b;
      });
    },
    [persist]
  );

  const setContent = useCallback(
    async (blockId: string, content: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block: any = b[blockId];
        if (!block) return prev;
        const next: any = { ...block, content };
        next.progress = recomputeProgress(next as Block);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );

  const renameBlock = useCallback(
    async (blockId: string, title: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;
        b[blockId] = { ...block, title };
        return b;
      });
    },
    [persist]
  );

  const clearAll = useCallback(async () => {
    const fresh = await resetBlocks();
    const fixed: BlocksState = {};
    for (const id of Object.keys(fresh)) fixed[id] = sanitizeBlock(fresh[id]);
    setBlocks(fixed);
    blocksRef.current = fixed;
  }, []);

  const importBlocks = useCallback(async (raw: unknown) => {
    const next = ensureRequiredBlocks(sanitizeState(raw));
    setBlocks(next);
    blocksRef.current = next;
    await saveBlocks(next);
  }, []);

  const replaceInEntries = useCallback(
    async (blockId: string, replacements: { find: string; replace: string }[]) => {
      if (!Array.isArray(replacements) || !replacements.length) return;
      await persist((prev) => {
        const b = { ...prev };
        const block = b[blockId];
        if (!block) return prev;
        const reps = replacements
          .map(r => ({ find: String(r.find || ""), replace: String(r.replace || "") }))
          .filter(r => r.find && r.replace);
        if (!reps.length) return prev;
        const updated = (block.entries || []).map((e: Entry) => {
          if (e.type !== "texte") return e;
          let q = (e as any).q || "";
          let a = (e as any).a || "";
          for (const r of reps) {
            try {
              const re = new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
              q = q.replace(re, r.replace);
              a = a.replace(re, r.replace);
            } catch {}
          }
          return { ...(e as any), q, a } as Entry;
        });
        const next: Block = { ...block, entries: updated };
        next.progress = recomputeProgress(next);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );

  const updateChecklist = useCallback(
    async (blockId: string, checklist: Record<string, { status: "present" | "partial" | "missing" | "conflict"; confidence: number; evidenceEntryIdx?: number[] }>) => {
      await persist((prev) => {
        const b = { ...prev };
        const block: any = b[blockId];
        if (!block) return prev;
        const next: any = { ...block, checklist };
        next.progress = recomputeProgress(next as Block);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );

  const analyzeNow = useCallback(async (blockId: string) => {
    const snap = blocksRef.current;
    if (!snap) return;
    const block = snap[blockId];
    if (!block) return;
    const blkSchema: any = (schemaJson as any)[block.id];
    if (!blkSchema) return;

    try {
      const res = await fetch("/api/llm/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: block.id,
          entries: block.entries,
          schema: blkSchema,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) return;
      await updateChecklist(block.id, json.checklist || {});
    } catch (e) {
      console.warn("gaps analyze failed:", e);
    }
  }, [updateChecklist]);

  /* ============================================================
     Canonisation et nettoyage auto
     ============================================================ */

  /**
   * Merge (patch) des valeurs canoniques pour un bloc
   * + synchronisation de la checklist quand les clés existent dans le schéma du bloc.
   * (corrigé: on prend must + good, pas seulement must)
   */
  

  const cleanupConflictsFor = useCallback(
    async (blockId: string, slotId: string) => {
      await persist((prev) => {
        const b = { ...prev };
        const blk = b[blockId];
        if (!blk) return prev;
        const canon = blk.resolved?.[slotId]?.value?.trim();
        if (!canon) return prev;

        const kept: Entry[] = blk.entries.filter((e) => {
          if (e.type !== "texte") return true;
          const text = `${e.q ?? ""}\n${e.a ?? ""}`;
          const candidates = extractCandidates(slotId, text);
          if (!candidates.length) return true;
          const hasCanon = candidates.some((c) => c.toLowerCase() === canon.toLowerCase());
          const hasOther = candidates.some((c) => c.toLowerCase() !== canon.toLowerCase());
          if (hasOther && !hasCanon) return false;
          return true;
        });

        const nextChecklist = { ...(blk as any).checklist || {} };
        nextChecklist[slotId] = {
          ...(nextChecklist[slotId] || { status: "missing", confidence: 0 }),
          status: "present",
          confidence: 1,
          lastUpdated: Date.now(),
          notes: "Fixé via canonisation/clean-up",
        };

        const next: Block = { ...blk, entries: kept, checklist: nextChecklist as any };
        next.progress = recomputeProgress(next);
        b[blockId] = next;
        return b;
      });
    },
    [persist]
  );

  return {
    loading,
    blocks,
    addTextEntry,
    setSummary,
    setContent,
    renameBlock,
    clearAll,
    importBlocks,
    replaceInEntries,
    updateChecklist,
    analyzeNow,
    setResolved,
    unsetResolved,
    cleanupConflictsFor,
  };
}
