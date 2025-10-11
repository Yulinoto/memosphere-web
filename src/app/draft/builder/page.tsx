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
import ReactMarkdown from "react-markdown";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";



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
  const [pointOfView, setPointOfView] = useState("first");
  const [styleInstructions, setStyleInstructions] = useState("");
  const [introHint, setIntroHint] = useState("");
  const [conclusionHint, setConclusionHint] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  // 📄 État de l’aperçu
  const [previewText, setPreviewText] = useState("");
const [previewLoading, setPreviewLoading] = useState(false);
  // 📘 État de la génération du livre
const [bookText, setBookText] = useState("");
const [generatingBook, setGeneratingBook] = useState(false);

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
  async function handlePreviewBook() {
  setPreviewLoading(true);
  try {
    const res = await fetch("/api/book/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        style,
        pointOfView,
        blocks: sortedBlocks,
      }),
    });
    const json = await res.json();
    setPreviewText(json.text || "⚠️ Aucun aperçu généré.");
  } catch (e) {
    console.error(e);
    setPreviewText("❌ Erreur lors de la génération de l’aperçu.");
  } finally {
    setPreviewLoading(false);
  }
}

async function handleGenerateBook() {
  setGeneratingBook(true);
  setBookText("");
  try {
    const res = await fetch("/api/book/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks,
        pointOfView,
        style: style || "narratif",
      }),
    });
    const json = await res.json();
    if (json.ok && json.text) {
      setBookText(json.text);
    } else {
      setBookText("⚠️ Erreur lors de la génération du livre.");
    }
  } catch (e) {
    console.error("Erreur génération livre:", e);
    setBookText("❌ Erreur réseau ou serveur.");
  } finally {
    setGeneratingBook(false);
  }
}

async function handleExportPDF() {
  try {
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 60;

    // === TITRES DYNAMIQUES ===
    const mainTitle = bookTitle || "Titre du livre";
    const subTitle = subtitle || "Sous-titre ou thème principal";

    // === PAGE DE COUVERTURE ===
    pdf.setFillColor(107, 165, 200);
    pdf.rect(0, 0, pageWidth, pageHeight, "F");

    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(36);
    pdf.text(mainTitle, pageWidth / 2, pageHeight / 2 - 20, { align: "center" });

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(18);
    pdf.text(subTitle, pageWidth / 2, pageHeight / 2 + 20, { align: "center" });

    pdf.setFontSize(12);
    pdf.text("MemoSphere Book", pageWidth / 2, pageHeight - 50, { align: "center" });

    // === PAGE 2 : SOMMAIRE ===
    pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.setTextColor(33, 33, 33);
    pdf.text("Sommaire", margin, margin);

    const chapterTitles = (bookText.match(/^#+\s+.+/gm) || []).map((l) =>
      l.replace(/^#+\s*/, "").trim()
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    let tocY = margin + 40;
    chapterTitles.forEach((title, i) => {
      pdf.text(`${i + 1}. ${title}`, margin, tocY);
      tocY += 20;
      if (tocY > pageHeight - 80) {
        pdf.addPage();
        tocY = margin;
      }
    });

    // === TRAITEMENT DES CHAPITRES ===
    const chapters = bookText.split(/^#\s+/gm).filter(Boolean);

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i].trim();
      const titleLine = chapter.split("\n")[0].trim();
      const contentText = chapter.split("\n").slice(1).join("\n").trim();

      // === PAGE D’OUVERTURE DU CHAPITRE ===
      pdf.addPage();
      pdf.setFillColor(240, 240, 240);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(30);
      pdf.setTextColor(50, 50, 50);
      pdf.text(`Chapitre ${i + 1}`, pageWidth / 2, pageHeight / 2 - 30, { align: "center" });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(18);
      pdf.text(titleLine, pageWidth / 2, pageHeight / 2 + 15, { align: "center" });

      // === PAGE SUIVANTE : CONTENU DU CHAPITRE ===
      pdf.addPage();
      pdf.setFont("times", "normal");
      pdf.setFontSize(12);
      pdf.setTextColor(30, 30, 30);

      const lines = pdf.splitTextToSize(contentText, pageWidth - margin * 2);
      let y = margin;

      for (const line of lines) {
        if (y > pageHeight - margin) {
          pdf.addPage();
          pdf.setFont("times", "normal");
          pdf.setFontSize(12);
          y = margin;
        }
        pdf.text(line, margin, y);
        y += 18;
      }
    }

    // === PIEDS DE PAGE : uniquement à partir des chapitres ===
    const pageCount = (pdf.internal as any).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      if (i <= 2) continue; // pas de pied sur couverture + sommaire
      pdf.setPage(i);
      pdf.setFontSize(10);
      pdf.setTextColor(150);
      pdf.text(`Page ${i - 2} / ${pageCount - 2}`, pageWidth - margin, pageHeight - 25, {
        align: "right",
      });
      pdf.text("MemoSphere - Souvenirs de vie", margin, pageHeight - 25);
    }

    // === ENREGISTREMENT ===
    pdf.save(`${mainTitle.replace(/\s+/g, "_")}_MemoSphere_Book.pdf`);
  } catch (e) {
    console.error(e);
    alert("Erreur lors de la génération du PDF enrichi.");
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
{/* Point de vue du récit */}
<div>
  <label className="text-sm font-medium mb-1 block">Point de vue du récit</label>
  <select
    value={pointOfView}
    onChange={(e) => setPointOfView(e.target.value)}
    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm
               focus:outline-none focus:ring-2 focus:ring-[#6BA5C8]/40 transition"
  >
    <option value="first">Première personne ("je")</option>
    <option value="third">Troisième personne ("il/elle")</option>
  </select>
  <p className="text-xs text-gray-500 mt-1">
    Ce choix déterminera la voix narrative du livre (récit intime ou narratif externe).
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
{/* 👀 Aperçu du rendu (gratuit) */}
<Card className="p-6 space-y-5">
  <h2 className="text-lg font-semibold flex items-center gap-2">
    <span role="img" aria-label="book">👀</span> Aperçu du livre (extrait gratuit)
  </h2>

  <Button
    onClick={handlePreviewBook}
    disabled={previewLoading}
    className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-all"
  >
    {previewLoading ? "✍️ Génération de l’aperçu…" : "🔍 Voir un aperçu représentatif"}
  </Button>

  {previewText && (
    <div className="mt-6 space-y-6">
     {/* 📘 COUVERTURE SIMULÉE — format A5 premium */}
<div className="relative mx-auto w-full flex flex-col items-center py-10">
  {/* Fond de présentation façon table */}
  <div className="relative p-10 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl shadow-inner border border-gray-200">
    <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-white/40 to-white/80 opacity-50 rounded-2xl"></div>

    {/* Perspective */}
    <div className="relative flex justify-center perspective-[1000px]">
      {/* Livre */}
      <div
        className="relative w-64 h-96 bg-gradient-to-br from-[#6BA5C8] to-[#9DC8A5]
                   text-white rounded-lg shadow-2xl overflow-hidden
                   transform rotate-y-[8deg] rotate-x-[1deg]
                   transition-transform duration-700 ease-out
                   hover:rotate-y-[5deg] hover:rotate-x-[0deg] hover:scale-[1.03]"
      >
        {/* Tranche du livre */}
        <div className="absolute left-0 top-0 h-full w-[6px] bg-gradient-to-b from-white/30 to-white/10 opacity-40 rounded-l-md"></div>

        {/* Contenu centré */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center select-none">
          <h3 className="text-3xl font-bold leading-snug mb-3 drop-shadow-lg tracking-wide">
            {bookTitle || "Titre du livre"}
          </h3>
          <p className="text-lg italic opacity-90 mb-6 drop-shadow-sm">
            {subtitle || "Sous-titre du livre"}
          </p>
          <div className="absolute bottom-6 text-xs opacity-80 font-light tracking-wide">
            MEMOSPHERE BOOK
          </div>
        </div>

        {/* Reflet lumineux */}
        <div className="absolute inset-0 bg-gradient-to-r from-white/10 via-transparent to-white/20 opacity-40 pointer-events-none"></div>

        {/* Ombre du livre */}
        <div className="absolute -right-4 bottom-0 w-[90%] h-[25px] bg-black/15 blur-md rotate-[2deg]"></div>
      </div>
    </div>
  </div>

  {/* 🔒 Étiquette d’aperçu verrouillée */}
  <div className="mt-4 px-6 py-2 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-full shadow-sm text-gray-700 text-sm font-medium flex items-center gap-2">
    <span>🔒 Aperçu limité — La couverture sera 100 % personnalisable après paiement</span>
  </div>
</div>




      {/* 📖 EXTRAIT */}
<div className="relative mx-auto max-w-[650px] bg-[#fdfaf6] border border-gray-300 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.06)] overflow-hidden">
  {/* léger reflet */}
  <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/70 via-transparent to-gray-100/30"></div>

  <div className="p-8 lg:p-10 font-serif text-[15px] leading-[1.9] text-gray-800">
    <p className="text-[11px] tracking-[0.25em] uppercase text-gray-400 mb-3">
      Extrait représentatif
    </p>

    {/* rendu type page de roman + lettrine en première lettre du 1er paragraphe */}
    <div className="[&_p]:mb-4 [&_h1]:mb-4 [&_h2]:mb-3">
      <div className="[&_p:first-child]:first-letter:text-5xl [&_p:first-child]:first-letter:font-bold [&_p:first-child]:first-letter:float-left [&_p:first-child]:first-letter:mr-3 [&_p:first-child]:first-letter:text-[#6BA5C8] [&_p:first-child]:first-letter:leading-[0.8]">
        <ReactMarkdown>
          {
            // on prend 2–3 paragraphes pour un “vrai” morceau de lecture
            previewText.split(/\n{2,}/).slice(0, 3).join("\n\n")
          }
        </ReactMarkdown>
      </div>
    </div>

    <div className="mt-6 flex items-center justify-between text-[12px] text-gray-500 italic">
      <span>
        Style : <strong className="not-italic">{style}</strong> —{" "}
        <strong className="not-italic">
          {pointOfView === "first" ? "Première personne" : "Troisième personne"}
        </strong>
      </span>
      <span className="text-gray-400">— Extrait —</span>
    </div>
  </div>

  {/* ombre basse */}
  <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-200/60 to-transparent"></div>
</div>

    </div>
  )}
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
      {/* 📘 Génération du livre final */}
<Card className="p-6 space-y-4">
  <h2 className="text-lg font-semibold">📘 Génération du livre final</h2>

  <div className="flex flex-wrap items-center gap-3">
    <Button
      onClick={handleGenerateBook}
      disabled={generatingBook}
      className={`text-white font-semibold px-6 py-2 rounded-lg transition-all ${
        generatingBook
          ? "bg-gray-400 cursor-not-allowed"
          : "bg-gradient-to-r from-[#6BA5C8] to-[#9DC8A5] hover:opacity-90"
      }`}
    >
      {generatingBook ? "Rédaction en cours…" : "✨ Générer le livre complet"}
    </Button>

    <p className="text-xs text-gray-500">
      Le livre sera rédigé à partir des souvenirs et faits bruts de tous les blocs.
    </p>
  </div>

  {/* Zone d'affichage du livre */}
  {generatingBook && (
    <div className="text-center text-gray-500 py-6 animate-pulse">
      ⏳ L’agent rédige le livre… Patiente un instant.
    </div>
  )}

  {!generatingBook && bookText && (
  <div className="space-y-4">
    <div
      id="book-content"
      className="prose prose-indigo max-w-none border rounded-xl bg-white p-6 shadow-sm"
    >
      <ReactMarkdown>{bookText}</ReactMarkdown>
    </div>

    <div className="flex justify-end">
      <button
        onClick={handleExportPDF}
        className="px-4 py-2 text-sm font-medium rounded-lg border hover:bg-gray-50
                   bg-gradient-to-r from-[#6BA5C8] to-[#9DC8A5] text-white shadow-sm
                   transition-all hover:shadow-md active:scale-95"
      >
        📄 Exporter en PDF
      </button>
    </div>
  </div>
)}

</Card>

    </div>
  );
}
