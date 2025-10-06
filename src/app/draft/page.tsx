"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useBlocks } from "@/hooks/useBlocks";
import type { Block } from "@/data/blocks";
import type { DraftDoc, DraftSegment, DraftAnchor } from "@/data/draft";
import { resyncDraftWithBlocks } from "@/data/draft";
import { DRAFT_STORAGE_KEY } from "@/lib/draftStorage";

type PersonOption = "je" | "il" | "elle";

// === Persistance locale ===
function loadDraftFromStorage(): DraftDoc | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveDraftToStorage(doc: DraftDoc | null) {
  try {
    if (!doc) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // silencieux
  }
}

export default function DraftPage() {
  const { blocks } = useBlocks(); // BlocksState | null
  const [doc, setDoc] = useState<DraftDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [person, setPerson] = useState<PersonOption>("je"); // 1re personne par défaut
  const saveTimer = useRef<number | null>(null);

  const blockList: Block[] = useMemo(() => Object.values(blocks ?? {}), [blocks]);
  const byBlockId = useMemo(
    () => Object.fromEntries(blockList.map((b) => [b.id, b])),
    [blockList]
  );

  // Empêche la génération si aucun bloc ne contient de données utiles
  const canGenerate = useMemo(() => {
    if (!blockList.length) return false;
    return blockList.some((b) => {
      const hasEntries = (b.entries ?? []).some((e: any) => {
        if (e?.type === "texte") return Boolean((e.q ?? "").trim() || (e.a ?? "").trim());
        if (e?.type === "audio") return Boolean((e.a ?? "").trim());
        if (e?.type === "photo") return Boolean((e.caption ?? "").trim());
        return false;
      });
      const hasResolved = !!b.resolved &&
        Object.values(b.resolved).some((v: any) => String(v?.value ?? "").trim().length > 0);
      const hasContent = typeof (b as any).content === "string" && ((b as any).content).trim().length > 0;
      const hasSummary = typeof b.summary === "string" && b.summary.trim().length > 0;
      return hasEntries || hasResolved || hasContent || hasSummary;
    });
  }, [blockList]);

  // === Charger le draft mémorisé au premier rendu ===
  useEffect(() => {
    const saved = loadDraftFromStorage();
    if (saved) setDoc(saved);
  }, []);

  // === Sauvegarder (debounce) à chaque changement de doc ===
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveDraftToStorage(doc);
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [doc]);

  // === On NE génère plus automatiquement au chargement ===
  useEffect(() => {
    // Rien ici : génération manuelle uniquement via le bouton
  }, [blocks]);

  const handleResync = () => {
    if (!doc) return;
    const next = resyncDraftWithBlocks(doc, blockList);
    setDoc(next);
  };

  const handleGenerateIA = async () => {
    if (!blocks) return;
    if (!canGenerate) {
      alert("Pas de données disponibles pour générer un texte.");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        blocks: Object.fromEntries(Object.entries(blocks)),
        style: { person }, // on transmet la personne choisie
      };
      const res = await fetch("/api/draft/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      // nettoyage des ancres si jamais la route en envoie un jour (sécurité)
      const clean: DraftDoc = {
        ...json,
        segments: (json?.segments ?? []).map((s: any) => ({
          ...s,
          anchors: (s?.anchors ?? []).filter((a: any) => {
            const [start, end] = a?.span ?? [0, 0];
            return (
              Number.isFinite(start) &&
              Number.isFinite(end) &&
              end > start &&
              start >= 0 &&
              end <= (s?.text?.length ?? 0)
            );
          }),
        })),
      };
      setDoc(clean);
    } finally {
      setLoading(false);
    }
  };

  // === Régénérer une seule section (un bloc) ===
  const handleRegenerateSegment = async (blockId: string) => {
    if (!blocks) return;
    const block = byBlockId[blockId];
    if (!block) return;

    setLoading(true);
    try {
      const payload = {
        blocks: { [blockId]: block }, // n’envoyer que le bloc concerné
        blockIds: [blockId],
        style: { person },
      };
      const res = await fetch("/api/draft/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      const seg = (json?.segments ?? [])[0];
      if (!seg) return;

      // Remplacer uniquement ce segment dans le draft courant, en gardant l’ordre
      setDoc((prev) => {
        if (!prev) return { version: 1, segments: [seg] };
        const nextSegments = prev.segments.map((s) => (s.blockId === blockId ? seg : s));
        const exists = prev.segments.some((s) => s.blockId === blockId);
        return { ...prev, segments: exists ? nextSegments : [...prev.segments, seg] };
      });
    } finally {
      setLoading(false);
    }
  };

  // === Effacer le draft mémorisé (optionnel) ===
  const handleClearDraft = () => {
    setDoc(null);
    saveDraftToStorage(null);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Draft (brouillon du livre)</h1>

          {/* Sélecteur de personne (n’impacte rien tant que tu ne cliques pas sur Générer) */}
          <label className="text-sm flex items-center gap-2">
            Personne :
            <select
              className="border rounded px-2 py-1"
              value={person}
              onChange={(e) => setPerson(e.target.value as PersonOption)}
              title="Choisir la personne narrative"
            >
              <option value="je">1re personne (je)</option>
              <option value="il">3e personne (il)</option>
              <option value="elle">3e personne (elle)</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateIA}
            className="px-3 py-2 border rounded hover:bg-gray-50"
            disabled={!blocks || loading || !canGenerate}
            title="Générer (ou régénérer) tout le brouillon via l’IA"
          >
            {loading ? "Génération…" : doc ? "Régénérer tout" : "Générer avec IA"}
          </button>

          {!canGenerate && (
            <span className="text-sm text-gray-500" title="Aucune donnée exploitable">
              Pas de données disponibles pour générer un texte
            </span>
          )}

          <button
            onClick={handleResync}
            className="px-3 py-2 border rounded hover:bg-gray-50"
            disabled={!doc || blockList.length === 0}
            title="Mettre à jour les fragments ancrés depuis Blocks"
          >
            Resynchroniser
          </button>

          <button
            onClick={handleClearDraft}
            className="px-3 py-2 border rounded hover:bg-gray-50"
            disabled={!doc}
            title="Effacer le brouillon mémorisé"
          >
            Effacer
          </button>

          <Link href="/blocks" className="px-3 py-2 border rounded hover:bg-gray-50">
            Aller à Blocks
          </Link>
          <Link href="/interview" className="px-3 py-2 border rounded hover:bg-gray-50">
            Aller à Interview
          </Link>
        </div>
      </header>

      <p className="text-sm text-gray-600 mt-2">
        Le brouillon est <strong>mémorisé</strong> localement et restauré à l’ouverture.
        Génère tout ou régénère une section au cas par cas. L’édition est auto-enregistrée ; un badge vert confirme l’enregistrement.
      </p>

      <div className="mt-6 space-y-8">
        {doc?.segments.map((seg) => (
          <DraftSegmentView
            key={seg.id}
            seg={seg}
            onChange={(s) => {
              setDoc((prev) =>
                !prev ? prev : { ...prev, segments: prev.segments.map((x) => (x.id === s.id ? s : x)) }
              );
            }}
            onRegenerate={() => handleRegenerateSegment(seg.blockId!)}
          />
        ))}

        {!doc && (
          <div className="text-sm text-gray-500 border rounded p-4">
            Aucun draft encore généré. Utilise le bouton <strong>Générer avec IA</strong>.
          </div>
        )}
      </div>
    </div>
  );
}

function DraftSegmentView({
  seg,
  onChange,
  onRegenerate,
}: {
  seg: DraftSegment;
  onChange: (next: DraftSegment) => void;
  onRegenerate: () => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const saveDebounce = useRef<number | null>(null);

  const validAnchors = useMemo(() => {
    const a = (seg.anchors ?? []).filter((an) => {
      const [start, end] = an.span ?? [0, 0];
      return Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0 && end <= seg.text.length;
    });
    return a.sort((x, y) => x.span[0] - y.span[0]);
  }, [seg.text, seg.anchors]);

  const parts = useMemo(() => {
    const out: Array<{ key: string; text: string; anchor?: DraftAnchor }> = [];
    let idx = 0;
    let plainSeq = 0;

    validAnchors.forEach((a, i) => {
      const [start, end] = a.span;
      if (start > idx) {
        out.push({ key: `plain_${plainSeq++}_${idx}_${start}`, text: seg.text.slice(idx, start) });
      }
      out.push({ key: `anch_${i}_${start}_${end}_${Math.random()}`, text: seg.text.slice(start, end), anchor: a });
      idx = end;
    });

    if (idx < seg.text.length) {
      out.push({ key: `plain_${plainSeq++}_${idx}_end`, text: seg.text.slice(idx) });
    }
    return out;
  }, [seg.text, validAnchors]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const nextText = (e.currentTarget.textContent ?? "").toString();
    if (nextText === seg.text) return;

    // Protection minimale si jamais des ancres existent (cas héritage)
    const touchedCanonical = validAnchors.some((a) => {
      const [start, end] = a.span;
      const before = seg.text.slice(start, end);
      return !nextText.includes(before);
    });
    if (touchedCanonical) {
      e.currentTarget.textContent = seg.text;
      alert("Ce passage est canonique. Corrige-le dans Blocks ou relance l’Interview.");
      return;
    }

    // Déclenche une sauvegarde (debounce)
    setIsSaving(true);
    setJustSaved(false);
    if (saveDebounce.current) window.clearTimeout(saveDebounce.current);
    saveDebounce.current = window.setTimeout(() => {
      onChange({ ...seg, text: nextText });
      setIsSaving(false);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1200);
    }, 400);
  };

  useEffect(() => {
    return () => {
      if (saveDebounce.current) window.clearTimeout(saveDebounce.current);
    };
  }, []);

  return (
    <section className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="font-semibold">
            {seg.blockTitle || "Section"}{" "}
            {seg.blockId && (
              <span className="ml-2 text-xs px-2 py-0.5 border rounded bg-gray-50">{seg.blockId}</span>
            )}
          </div>

          {/* État de sauvegarde */}
          {isSaving && <span className="text-xs text-gray-500">Enregistrement…</span>}
          {!isSaving && justSaved && (
            <span className="text-xs font-medium text-green-600">Enregistré</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {seg.blockId && (
            <>
              <Link
                href={`/blocks/${encodeURIComponent(seg.blockId)}`}
                className="text-sm underline decoration-dotted"
                title="Ouvrir le bloc source"
              >
                Ouvrir le bloc
              </Link>
              {seg.blockId && (
  <Link
    href={`/interview?block=${encodeURIComponent(seg.blockId)}`}
    className="text-sm px-2 py-1 border rounded hover:bg-gray-50"
    title="Relancer l'interview pour ce bloc"
  >
    Relancer l’interview
  </Link>
)}
              <button
                onClick={async () => {
                  setIsRegenerating(true);
                  try {
                    await onRegenerate();
                  } finally {
                    setIsRegenerating(false);
                  }
                }}
                className="text-sm px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                disabled={isRegenerating}
                title="Régénérer uniquement cette section"
              >
                {isRegenerating ? "Génération en cours…" : "Régénérer ce segment"}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        className="whitespace-pre-wrap leading-7 focus:outline-none"
      >
        {validAnchors.length === 0
          ? seg.text
          : parts.map((p) =>
              p.anchor ? (
                <span key={p.key} className="underline decoration-dotted">
                  {p.text}
                </span>
              ) : (
                <span key={p.key}>{p.text}</span>
              )
            )}
      </div>
    </section>
  );
}
