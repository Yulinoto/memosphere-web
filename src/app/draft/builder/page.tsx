"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SortableBlockList } from "@/components/DraftBuilder/SortableBlockList";
import { Plus, Trash2, MessageCircle, Blocks } from "lucide-react";
import { useBlocks } from "@/hooks/useBlocks";
import { PageNavButtons } from "@/components/ui/PageNavButtons";

interface Block {
  id: string;
  title?: string;
  summary?: string;
}

const LS_KEY = "draft:builder:v1";

export default function BuilderPage() {
  const router = useRouter();
  const { blocks, loading } = (useBlocks() as any) || {};
  const allBlocks: Block[] = useMemo(() => {
    const vals = blocks ? Object.values(blocks) : [];
    return (vals as any[]).map((b) => ({
      id: String(b?.id ?? ""),
      title: String(b?.title ?? ""),
      summary: String(b?.summary ?? ""),
    }));
  }, [blocks]);

  const [sortedBlocks, setSortedBlocks] = useState<Block[]>([]);
  const [bookTitle, setBookTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [style, setStyle] = useState("narratif");
  const [styleInstructions, setStyleInstructions] = useState("");
  const [introHint, setIntroHint] = useState("");
  const [conclusionHint, setConclusionHint] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Hydratation depuis localStorage
  useEffect(() => {
    let persisted: any = null;
    try {
      persisted = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    } catch {}
    if (!allBlocks.length) return;

    let initial = allBlocks.slice();
    if (persisted?.order && Array.isArray(persisted.order)) {
      const byId = new Map(initial.map((b) => [b.id, b]));
      const ordered: Block[] = [];
      for (const id of persisted.order as string[]) {
        const found = byId.get(id);
        if (found) {
          ordered.push(found);
          byId.delete(id);
        }
      }
      initial = [...ordered, ...Array.from(byId.values())];
    }

    if (persisted?.titlesById) {
      initial = initial.map((b) =>
        persisted.titlesById[b.id]
          ? { ...b, title: String(persisted.titlesById[b.id] || "") }
          : b
      );
    }

    setSortedBlocks(initial);
    if (persisted?.bookTitle) setBookTitle(persisted.bookTitle);
    if (persisted?.subtitle) setSubtitle(persisted.subtitle);
    if (persisted?.style) setStyle(persisted.style);
    if (persisted?.styleInstructions) setStyleInstructions(persisted.styleInstructions);
    if (persisted?.introHint) setIntroHint(persisted.introHint);
    if (persisted?.conclusionHint) setConclusionHint(persisted.conclusionHint);
  }, [allBlocks.length]);

  // Auto-save
  useEffect(() => {
    setSaveStatus("saving");
    const t = setTimeout(() => {
      const titlesById = Object.fromEntries(sortedBlocks.map((b) => [b.id, b.title || ""]));
      const payload = {
        bookTitle,
        subtitle,
        style,
        styleInstructions,
        introHint,
        conclusionHint,
        order: sortedBlocks.map((b) => b.id),
        titlesById,
      };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
      } catch {}
      setSaveStatus("saved");
      const t2 = setTimeout(() => setSaveStatus("idle"), 1200);
      return () => clearTimeout(t2);
    }, 600);
    return () => clearTimeout(t);
  }, [sortedBlocks, bookTitle, subtitle, style, styleInstructions, introHint, conclusionHint]);

  const availableBlocks = useMemo(() => {
    const present = new Set(sortedBlocks.map((b) => b.id));
    return allBlocks.filter((b) => !present.has(b.id));
  }, [allBlocks, sortedBlocks]);

  function handleReorder(newOrder: string[]) {
    setSortedBlocks((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      return newOrder.map((id) => byId.get(id)!).filter(Boolean) as Block[];
    });
  }

  function handleDelete(blockId: string) {
    setSortedBlocks((prev) => prev.filter((b) => b.id !== blockId));
  }

  function handleAdd(blockId: string) {
    const found = allBlocks.find((b) => b.id === blockId);
    if (!found) return;
    setSortedBlocks((prev) => [...prev, found]);
  }

  // ✨ IA Generation (version robuste)
  async function generateWithAI(
    type: "book" | "subtitle" | "blockTitle",
    payload: any
  ) {
    setLoadingId(type === "blockTitle" ? payload.block.id : type);
    try {
      const res = await fetch("/api/agent/generateTitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        const txt = await res.text();
        const clean = txt.replace(/```[a-z]*\n?|\n?```/g, "").trim();
        try {
          data = JSON.parse(clean);
        } catch {
          throw new Error("Réponse IA non parseable");
        }
      }

      if (!res.ok) {
        throw new Error(data?.error || "Erreur API");
      }

      if (type === "book" && data?.bookTitle != null) {
        setBookTitle(String(data.bookTitle));
      }
      if (type === "subtitle" && data?.subtitle != null) {
        setSubtitle(String(data.subtitle));
      }
      if (type === "blockTitle" && typeof data?.title === "string") {
        setSortedBlocks((prev) =>
          prev.map((b) =>
            b.id === payload.block.id ? { ...b, title: data.title } : b
          )
        );
      }
    } catch (e) {
      console.error("IA generation error:", (e as any)?.message || e);
    } finally {
      setLoadingId(null);
    }
  }

  if (loading) return <div className="p-6">Chargement des blocs…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* 🔝 Navigation */}
<div className="flex items-center justify-between mb-6">
  {/* Boutons de navigation unifiés */}
  <PageNavButtons show={["home", "interview", "blocks"]} />

  <div className="text-xs text-gray-500">
    {saveStatus === "saving" && <span className="text-amber-600">💾 Enregistrement…</span>}
    {saveStatus === "saved" && <span className="text-green-600">✅ Enregistré</span>}
  </div>
</div>


      <h1 className="text-2xl font-bold">Paramétrage du livre</h1>

      {/* Paramètres globaux */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Input
            value={bookTitle}
            onChange={(e) => setBookTitle(e.target.value)}
            placeholder="Titre du livre"
            className="flex-1 font-semibold text-lg"
          />
          <Button
            title="Générer un titre avec l’IA"
            onClick={() => generateWithAI("book", { blocks: sortedBlocks })}
            disabled={loadingId === "book"}
            className="text-gray-600 hover:text-gray-900"
          >
            {loadingId === "book" ? "…" : "✨"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Sous-titre"
            className="flex-1"
          />
          <Button
            title="Générer un sous-titre avec l’IA"
            onClick={() => generateWithAI("subtitle", { blocks: sortedBlocks })}
            disabled={loadingId === "subtitle"}
            className="text-gray-600 hover:text-gray-900"
          >
            {loadingId === "subtitle" ? "…" : "✨"}
          </Button>
        </div>

        {/* Style de rédaction */}
<div>
  <label className="text-sm font-medium mb-1 block">Style de rédaction</label>
  <select
    value={style}
    onChange={(e) => setStyle(e.target.value)}
    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm
               focus:outline-none focus:ring-2 focus:ring-[#6BA5C8]/40 transition"
  >
    <option value="narratif">Narratif / fluide</option>
    <option value="journalistique">Journalistique / factuel</option>
    <option value="poetique">Poétique / imagé</option>
    <option value="chaleureux">Chaleureux / intime</option>
    <option value="sobre">Sobre / classique</option>
    <option value="humoristique">Humoristique léger</option>
    <option value="contemplatif">Contemplatif / introspectif</option>
    <option value="chronique">Chronique / chapitré</option>
    <option value="memoire_vive">Mémoire vive (présent)</option>
  </select>
  <p className="text-xs text-gray-500 mt-1">
    Ce choix orientera le ton que l’agent utilisera pour la rédaction du livre.
  </p>
</div>


        <div>
          <label className="text-sm font-medium">Instructions de style</label>
          <Textarea
            value={styleInstructions}
            onChange={(e) => setStyleInstructions(e.target.value)}
            placeholder="Donnez des indications sur le ton, le rythme, la longueur, etc."
          />
        </div>

        <div>
          <label className="text-sm font-medium">Introduction (indications)</label>
          <Textarea
            value={introHint}
            onChange={(e) => setIntroHint(e.target.value)}
            placeholder="Facultatif — précisez les thèmes ou émotions à aborder dans l’introduction"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Conclusion (indications)</label>
          <Textarea
            value={conclusionHint}
            onChange={(e) => setConclusionHint(e.target.value)}
            placeholder="Facultatif — précisez les messages ou émotions à souligner en conclusion"
          />
        </div>
      </Card>

      {/* Blocs */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">🧩 Blocs du livre</h2>
          <div className="flex items-center gap-2">
            <select
              id="add-block-select"
              className="border rounded p-2 text-sm"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                handleAdd(id);
                e.currentTarget.value = "";
              }}
            >
              <option value="" disabled>
                Ajouter un bloc…
              </option>
              {availableBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title || `Bloc ${b.id}`}
                </option>
              ))}
            </select>
            <Button
              onClick={() => {
                const sel = document.getElementById("add-block-select") as HTMLSelectElement | null;
                if (sel && sel.value) {
                  handleAdd(sel.value);
                  sel.value = "";
                }
              }}
              className="flex items-center text-gray-700 hover:text-gray-900"
              title="Ajouter le bloc sélectionné"
            >
              <Plus className="h-4 w-4 mr-1" /> Ajouter
            </Button>
          </div>
        </div>

        <SortableBlockList
          items={sortedBlocks}
          onReorder={handleReorder}
          renderItem={(block: Block) => (
            <AnimatePresence>
              <motion.div
                key={block.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="p-4 mb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm text-muted-foreground">Bloc {block.id} —</span>
                      <input
                        type="text"
                        value={block.title || ""}
                        onChange={(e) => {
                          const newTitle = e.target.value;
                          setSortedBlocks((prev) =>
                            prev.map((b) =>
                              b.id === block.id ? { ...b, title: newTitle } : b
                            )
                          );
                        }}
                        placeholder="Titre du bloc"
                        className="border-b border-transparent focus:border-gray-400 focus:outline-none bg-transparent text-base font-semibold flex-1"
                      />
                      <Button
                        title="Générer un titre avec l’IA"
                        onClick={() => generateWithAI("blockTitle", { block })}
                        disabled={!block.summary?.trim() || loadingId === block.id}
                        className={`text-gray-600 hover:text-gray-900 ${
                          !block.summary?.trim() ? "opacity-40 cursor-not-allowed" : ""
                        }`}
                      >
                        {loadingId === block.id ? "…" : "✨"}
                      </Button>
                      <Button
                        onClick={() => handleDelete(block.id)}
                        title="Supprimer du draft"
                        className="p-2 text-grey-800 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <p className="italic text-sm text-gray-600 mt-2">
                    {block.summary?.trim() ? block.summary : "⚠️ Pas de résumé disponible."}
                  </p>
                </Card>
              </motion.div>
            </AnimatePresence>
          )}
        />
      </Card>
    </div>
  );
}
