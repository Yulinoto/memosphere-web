"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageNavButtons } from "@/components/ui/PageNavButtons";
import { useBlocks } from "@/hooks/useBlocks";
import { exportBookToPDF } from "@/utils/exportBookToPDF";
import { CoverEditor } from "@/components/CoverEditor";



type Block = { id: string; title?: string; summary?: string };
type Chapter = { id: string; title: string; text: string; images?: (string | { page: number; src: string })[] };

const LS_KEY_BUILDER = "draft:builder:v1";
const LS_KEY_FINAL = "draft:final:v1";
const LS_KEY_HISTORY = "draft:final:history";
const CHARS_PER_PAGE = 1600;

function splitIntoPages(text: string, charsPerPage = CHARS_PER_PAGE): string[] {
  const t = text.trim();
  if (!t) return [""];
  const pages: string[] = [];
  let i = 0;
  while (i < t.length) {
    const slice = t.slice(i, i + charsPerPage);
    const lastPara = slice.lastIndexOf("\n\n");
    const cut = lastPara > 400 ? lastPara + 2 : slice.length;
    pages.push(t.slice(i, i + cut).trim());
    i += cut;
  }
  return pages.length ? pages : [t];
}

function todayISO() {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function debounce<T extends (...args: any[]) => void>(fn: T, delay = 600) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// Pagination par hauteur réelle pour du texte brut (paragraphes séparés par deux sauts de ligne)
function paginateTextByHeight(input: string): string[] {
  if (typeof window === "undefined") return [input || ""];
  const PAGE_HEIGHT = 1020;
  const PAD_TOP = 56; // p-14
  const PAD_BOTTOM = 96; // pb-24
  const INNER_HEIGHT = PAGE_HEIGHT - PAD_TOP - PAD_BOTTOM; // ~868px
  const PAGE_WIDTH = 720;
  const PAD_X = 56; // p-14
  const INNER_WIDTH = PAGE_WIDTH - PAD_X * 2; // ~608px

  const text = String(input || "").replace(/<[^>]+>/g, "");
  const paragraphs = text.split(/\n\n+/);
  if (!paragraphs.length) return [""];

  const meas = document.createElement("div");
  meas.style.position = "fixed";
  meas.style.left = "-99999px";
  meas.style.top = "-99999px";
  meas.style.width = `${INNER_WIDTH}px`;
  meas.style.fontFamily = "ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif";
  meas.style.fontSize = "15px";
  meas.style.lineHeight = "1.9";
  meas.style.visibility = "hidden";
  document.body.appendChild(meas);

  let pages: string[][] = [[]];
  let currentHeight = 0;

  const paraEls: HTMLParagraphElement[] = [];
  try {
    for (const para of paragraphs) {
      const p = document.createElement("p");
      p.style.margin = "0 0 16px 0";
      p.textContent = para;
      meas.appendChild(p);
      const h = p.offsetHeight;
      paraEls.push(p);
      if (h > INNER_HEIGHT && pages[pages.length - 1].length === 0) {
        // Paragraphe plus haut qu'une page: on le force seul sur une page
        pages[pages.length - 1].push(para);
        pages.push([]);
        meas.innerHTML = "";
        currentHeight = 0;
        continue;
      }
      if (currentHeight + h > INNER_HEIGHT && pages[pages.length - 1].length > 0) {
        pages.push([]);
        meas.innerHTML = "";
        currentHeight = 0;
        // Remesure dans nouvelle page
        const p2 = document.createElement("p");
        p2.style.margin = "0 0 16px 0";
        p2.textContent = para;
        meas.appendChild(p2);
        const h2 = p2.offsetHeight;
        currentHeight += h2;
        pages[pages.length - 1].push(para);
        continue;
      }
      currentHeight += h;
      pages[pages.length - 1].push(para);
    }
  } finally {
    document.body.removeChild(meas);
  }

  // Convertit pages de tableaux -> string par page
  return pages
    .map((paras) => paras.join("\n\n").trim())
    .filter((s, i, arr) => i === 0 || s.length > 0 || i < arr.length - 1 || arr.length === 1);
}

async function compressImage(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(null);
      img.onerror = reject;
      img.src = url;
    });
    const { width, height } = img as HTMLImageElement;
    let targetW = width;
    let targetH = height;
    if (width > height && width > maxDim) {
      targetW = maxDim;
      targetH = Math.round((height / width) * maxDim);
    } else if (height >= width && height > maxDim) {
      targetH = maxDim;
      targetW = Math.round((width / height) * maxDim);
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function stripImageTags(html: string | undefined | null): string {
  if (!html) return "";
  try {
    // Supprime les balises <img ...> (souvent data: base64) pour l'historique
    return String(html).replace(/<img[^>]*>/gi, "");
  } catch {
    return String(html || "");
  }
}

function toHistorySnapshot(state: { prefaceHtml?: string; conclusionHtml?: string; chapters?: any[] }) {
  const prefaceHtml = stripImageTags(state.prefaceHtml);
  const conclusionHtml = stripImageTags(state.conclusionHtml);
  const chapters = (state.chapters || []).map((ch) => ({
    id: ch?.id ?? "",
    title: ch?.title ?? "",
    text: ch?.text ?? "",
    // On ne stocke pas les images en historique pour éviter le dépassement de quota
    images: [],
  }));
  return { prefaceHtml, conclusionHtml, chapters };
}

function BookPage({
  children,
  showFooter,
  pageNumber,
  bookTitle,
  onAddImage,
  noShadow,
  className = "",
}: {
  children: React.ReactNode;
  showFooter?: boolean;
  pageNumber?: number;
  bookTitle?: string;
  onAddImage?: () => void;
  noShadow?: boolean;
  className?: string;            // ✅
}) {
  return (
    <div
  className={`book-page relative w-[720px] h-[1020px] mx-auto rounded-[18px] ${
    noShadow ? "" : "shadow-[0_25px_60px_rgba(0,0,0,0.12)]"
  } border border-gray-200 overflow-hidden mb-8 ${className}`}
  style={{
    contain: "strict",
    backgroundColor:
      className?.includes("book-cover") ? "#9DC8A5" : "#fdfaf6",
  }}
>

      <div className="absolute inset-0 overflow-hidden p-14 pb-24 font-serif text-[15px] leading-[1.9] text-gray-900">
        {children}
      </div>
      {onAddImage && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <button
            onClick={onAddImage}
            className="text-xs px-3 py-1 rounded border bg-white/80 hover:bg-white shadow-sm"
            title="Insérer une image sur cette page"
          >
            ➕ Image
          </button>
        </div>
      )}
      {showFooter && (
        <div className="absolute bottom-0 left-0 right-0 px-10 py-4 text-xs text-gray-500 flex items-center justify-between pointer-events-none">
          <span>MemoSphere — {bookTitle || "Livre"}</span>
          <span>{pageNumber}</span>
        </div>
      )}
    </div>
  );
}



function PaginatedText({
  html,
  onChange,
  className = "",
  maxHeight = 780,
}: {
  html: string;
  onChange: (newHtml: string) => void;
  className?: string;
  maxHeight?: number;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Découpe en pages selon la hauteur réelle
  const repaginate = useMemo(
    () =>
      debounce(() => {
        if (typeof window === "undefined") return;
        const temp = document.createElement("div");
        temp.style.width = "720px";
        temp.style.position = "absolute";
        temp.style.left = "-9999px";
        temp.style.top = "0";
        temp.style.fontFamily = "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";
        temp.style.fontSize = "15px";
        temp.style.lineHeight = "1.9";
        document.body.appendChild(temp);

        const paras = html
          .replace(/<[^>]+>/g, "")
          .split(/\n\n+/)
          .map((p) => `<p>${p}</p>`);
        temp.innerHTML = "";
        let curPage: string[] = [];
        let curH = 0;
        const result: string[][] = [];
        for (const p of paras) {
          temp.innerHTML = p;
          const h = temp.scrollHeight;
          if (curH + h > maxHeight * 1.2 && curPage.length > 0) {
            result.push(curPage);
            curPage = [];
            curH = 0;
          }
          curPage.push(p);
          curH += h;
        }
        if (curPage.length) result.push(curPage);
        document.body.removeChild(temp);
        setPages(result.map((x) => x.join("\n")));
      }, 200),
    [html, maxHeight]
  );

  useEffect(() => {
    repaginate();
  }, [html, repaginate]);

  const handleInput = (pageIdx: number, e: React.FormEvent<HTMLDivElement>) => {
    const text = (e.target as HTMLDivElement).innerText;
    const updated = [...pages];
    updated[pageIdx] = text;
    const merged = updated.join("\n\n");
    onChange(merged);
  };

  return (
    <>
      {pages.map((page, i) => (
        <BookPage key={i} showFooter bookTitle="Ton Livre" pageNumber={i + 1}>
          <div
            ref={i === pages.length - 1 ? ref : null}
            contentEditable
            suppressContentEditableWarning
            className={`outline-none h-[${maxHeight}px] overflow-hidden ${className}`}
            onInput={(e) => handleInput(i, e)}
            dangerouslySetInnerHTML={{
              __html: page
                .split("\n")
                .map((p) => `<p>${p}</p>`)
                .join(""),
            }}
          />
        </BookPage>
      ))}
    </>
  );
}

function EditableBlock({
  html,
  onChange,
  className = "",
  enableImageDelete = false,
  maxHeight = 780,
}: {
  html: string;
  onChange: (html: string) => void;
  className?: string;
  enableImageDelete?: boolean;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el) el.innerHTML = html || "";

    // Boutons suppression images
    if (enableImageDelete) {
      const imgs = el.querySelectorAll("img");
      imgs.forEach((img) => {
        const parent = img.parentElement;
        if (!parent) return;
        parent.classList.add("relative", "group");
        if (parent.querySelector('[data-img-delete]')) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("data-img-delete", "1");
        btn.textContent = "×";
        btn.className =
          "absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded-full bg-white border shadow hover:bg-red-50 hover:text-red-600";
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          parent.remove();
          onChange(el.innerHTML);
        };
        parent.appendChild(btn);
      });
    }
  }, [html, enableImageDelete, onChange]);

  // Empêche l’écriture si la page est "pleine"
  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight > maxHeight * 0.95) {
      setIsFull(true);
      e.preventDefault();
      return;
    } else {
      setIsFull(false);
    }
    onChange(el.innerHTML);
  };

  return (
  <div
    ref={ref}
    contentEditable
    suppressContentEditableWarning
    onInput={(e) => {
      const el = e.target as HTMLDivElement;
      const maxHeight = 780; // même valeur que ta page
      const parent = el.closest(".relative");
      const fullHeight = parent ? parent.clientHeight : maxHeight;

      // ⚙️ Si le contenu dépasse la hauteur dispo : bloque l’ajout
      if (false && el.scrollHeight > fullHeight - 50) {
        const sel = window.getSelection();
        if ((sel?.rangeCount ?? 0) > 0) {
          sel!.getRangeAt(0).deleteContents();
        }
        return; // empêche d'aller plus loin
      }

      onChange(el.innerHTML);
    }}
    onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
    className={`outline-none ${className}`}
  />
);
}


export default function FinalBookPage() {
  
  const router = useRouter();
  const { blocks } = (useBlocks() as any) || {};
  const allBlocks: Block[] = useMemo(() => {
    const vals = blocks ? Object.values(blocks) : [];
    return (vals as any[]).map((b) => ({
      id: String(b?.id ?? ""),
      title: String(b?.title ?? b?.id ?? ""),
      summary: String(b?.summary ?? ""),
    }));
  }, [blocks]);

  const [bookTitle, setBookTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
   const [coverBg, setCoverBg] = useState("#9DC8A5");
  const [showCoverEditor, setShowCoverEditor] = useState(false);
  const [style, setStyle] = useState("narratif");
  const [coverTextColor, setCoverTextColor] = useState("white");
  const [coverTitleSize, setCoverTitleSize] = useState<"small" | "medium" | "large">("medium");
  const [coverSubtitleSize, setCoverSubtitleSize] = useState<"small" | "medium" | "large">("medium");
  const [coverTitleFont, setCoverTitleFont] = useState<string>("Georgia, serif");
  const [coverSubtitleFont, setCoverSubtitleFont] = useState<string>("Georgia, serif");
  const [coverBgImage, setCoverBgImage] = useState<string | null>(null);
  const [coverBgScale, setCoverBgScale] = useState<number>(40);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("draft:final:coverTextColor");
      if (saved) setCoverTextColor(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem("draft:final:coverTitleSize") as any;
      const s = localStorage.getItem("draft:final:coverSubtitleSize") as any;
      if (t === "small" || t === "medium" || t === "large") setCoverTitleSize(t);
      if (s === "small" || s === "medium" || s === "large") setCoverSubtitleSize(s);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const tf = localStorage.getItem("draft:final:coverTitleFont");
      const sf = localStorage.getItem("draft:final:coverSubtitleFont");
      if (tf) setCoverTitleFont(tf);
      if (sf) setCoverSubtitleFont(sf);
    } catch {}
  }, []);

  const [order, setOrder] = useState<string[]>([]);
  const [titlesById, setTitlesById] = useState<Record<string, string>>({});
  const [prefaceHtml, setPrefaceHtml] = useState("<em>Préface (en cours de construction)</em>");
  const [conclusionHtml, setConclusionHtml] = useState("<em>Conclusion — à compléter</em>");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const inputFileRef = useRef<HTMLInputElement | null>(null);
  const pendingImageTargetRef = useRef<number | null>(null);
  const pendingChapterPageRef = useRef<number | null>(null);
  const [prefaceImages, setPrefaceImages] = useState<Array<string | { page: number; src: string }>>([]);
  const [conclusionImages, setConclusionImages] = useState<Array<string | { page: number; src: string }>>([]);
// Pages vierges ajoutées manuellement
const [extraPages, setExtraPages] = useState<{ afterPage: number; id: string }[]>([]);

  const pageCounterRef = useRef(0);
  const nextPageNumber = () => (pageCounterRef.current += 1);

  const debouncedSave = useMemo(
    () =>
      debounce(() => {
        const payload = { prefaceHtml, chapters, conclusionHtml, prefaceImages, conclusionImages };
        try {
          localStorage.setItem(LS_KEY_FINAL, JSON.stringify(payload));
        } catch {}
        try {
          pushHistory(payload);
        } catch {}
      }, 700),
    [prefaceHtml, chapters, conclusionHtml, prefaceImages, conclusionImages]
  );

  // Ajout d'une page vierge à la suite d'une page donnée
  const isAddingRef = useRef(false);

function realignFloatLayersInDOM() {
  try {
    const layers = document.querySelectorAll('[data-ms-float-layer="1"]');
    layers.forEach((node) => {
      const layer = node as HTMLDivElement;
      const host = layer.parentElement as HTMLElement | null;
      if (!host) return;
      const container = host.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (!container) return;
      const cr = container.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      const cs = window.getComputedStyle(container);
      const padL = parseFloat(cs.paddingLeft || '0') || 0;
      const padT = parseFloat(cs.paddingTop || '0') || 0;
      const padR = parseFloat(cs.paddingRight || '0') || 0;
      const padB = parseFloat(cs.paddingBottom || '0') || 0;
      const scrollL = (container as HTMLElement).scrollLeft || 0;
      const scrollT = (container as HTMLElement).scrollTop || 0;
      layer.style.position = 'absolute';
      layer.style.left = (cr.left - hr.left + padL - scrollL) + 'px';
      layer.style.top = (cr.top - hr.top + padT - scrollT) + 'px';
      layer.style.width = (container.clientWidth - padL - padR) + 'px';
      layer.style.height = (container.clientHeight - padT - padB) + 'px';
      layer.style.pointerEvents = 'none';
    });
  } catch {}
}

function addBlankPage(afterPage: number, forcedId?: string): string {
  const newId = forcedId ?? `blank-${Date.now()}`;
  setExtraPages((prev) => {
    const newPage = { afterPage, id: newId };

    // insère la nouvelle page juste après la cible
    const next: { afterPage: number; id: string }[] = [];
    let inserted = false;

    for (const p of prev) {
      next.push(p);
      if (!inserted && p.afterPage === afterPage) {
        next.push(newPage);
        inserted = true;
      }
    }
    if (!inserted) next.push(newPage);

    try {
      localStorage.setItem("draft:final:blankPages", JSON.stringify(next));
    } catch {}

    return next;
  });
  return newId;
}


function deleteBlankPage(id: string) {
  setExtraPages(prev => {
    const next = prev.filter(p => p.id !== id);
    try {
      localStorage.setItem("draft:final:blankPages", JSON.stringify(next));
    } catch {}
    return next;
  });
}

function insertBlankPage(afterPage: number) {
  addBlankPage(afterPage);
}
// Rend les pages vierges insérées après un numéro de page donné
const renderBlankPagesAfter = (after: number) => {
  // récupère toutes les pages vierges qui suivent ce "after"
  const list = extraPages.filter((p) => p.afterPage === after);
  if (!list.length) return null;

  return list.map((page) => (
    <BookPage
  key={page.id}
  showFooter
  pageNumber={nextPageNumber()}
  bookTitle={bookTitle}
  data-page={page.id}
>
  <div className="h-full flex flex-col justify-between">
    <div
  contentEditable
  suppressContentEditableWarning
  className="flex-1 p-4 outline-none overflow-auto export-paginate"
  onInput={(e) => {
    const el = e.target as HTMLDivElement;
    const maxHeight = 780;
    if (false && el.scrollHeight > maxHeight - 50) {
      const sel = window.getSelection();
      if ((sel?.rangeCount ?? 0) > 0) {
        sel!.getRangeAt(0).deleteContents();
      }
      return;
    }
    const val = el.innerHTML;
    localStorage.setItem(`draft:final:blank:${page.id}`, val);
  }}
  dangerouslySetInnerHTML={{
    __html: localStorage.getItem(`draft:final:blank:${page.id}`) || "",
  }}
/>
    <div className="flex justify-end mt-4">
      <button
        onClick={() => deleteBlankPage(page.id)}
        className="text-xs px-3 py-1 rounded border bg-white hover:bg-red-50 shadow-sm text-red-600"
      >
        🗑 Supprimer cette page
      </button>
    </div>
  </div>
</BookPage>
  ));
};

// --- Bouton d’insertion de page vierge ---
const InsertButton = ({ after }: { after: number }) => (
  <div className="flex justify-center my-6">
    <button
      onClick={() => insertBlankPage(after)}
      className="text-sm px-4 py-1 rounded border border-dashed bg-white hover:bg-gray-50 shadow-sm"
    >
      ➕ Ajouter une page
    </button>
  </div>
);



  useEffect(() => {
    debouncedSave();
  }, [prefaceHtml, chapters, conclusionHtml, debouncedSave]);

  // Utilitaires images chapitres
  const normalizeChapterImages = (imgs: (string | { page: number; src: string })[] | undefined | null) =>
    (imgs || []).map((img) => (typeof img === "string" ? { page: 0, src: img } : img));

  const addChapterImageAtPage = (chIdx: number, pageIdx: number, base64: string) => {
    setChapters((prev) => {
      const next = [...prev];
      const current = next[chIdx];
      if (!current) return prev;
      const curImgs = normalizeChapterImages(current.images);
      const already = curImgs.filter((i) => i.page === pageIdx).length;
      const targetPage = already ? pageIdx + 1 : pageIdx;
      const updatedImages = [...curImgs, { page: targetPage, src: base64 }];
      next[chIdx] = { ...current, images: updatedImages };
      pushHistory({ prefaceHtml, chapters: next, conclusionHtml });
      return next;
    });
    debouncedSave();
  };

  const pushHistory = (state: any) => {
    setHistory((prev) => {
      const snap = toHistorySnapshot(state);
      const next = [...prev, JSON.stringify(snap)].slice(-5);
      try {
        localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(next));
      } catch {
        // Si quota dépassé, on tente de réduire l'historique
        try {
          const reduced = next.slice(-3);
          localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(reduced));
          return reduced;
        } catch {}
      }
      return next;
    });
  };

  const restoreSnapshotAt = (index: number) => {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const safeIdx = Math.max(0, Math.min(index, prev.length - 1));
      let parsed: any;
      try {
        parsed = JSON.parse(prev[safeIdx]);
      } catch {
        return prev;
      }
      // parsed est une version "light" sans images inline ni arrays images
      setPrefaceHtml(parsed.prefaceHtml ?? "");
      setChapters(parsed.chapters ?? []);
      setConclusionHtml(parsed.conclusionHtml ?? "");
      const next = [...prev, prev[safeIdx]].slice(-5);
      try {
        localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(next));
      } catch {}
      try {
        const payload = { prefaceHtml: parsed.prefaceHtml ?? "", chapters: parsed.chapters ?? [], conclusionHtml: parsed.conclusionHtml ?? "" };
        localStorage.setItem(LS_KEY_FINAL, JSON.stringify(payload));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    try {
      const persisted = JSON.parse(localStorage.getItem(LS_KEY_BUILDER) || "null");
      if (persisted) {
        setBookTitle(persisted.bookTitle || "");
        setSubtitle(persisted.subtitle || "");
        setStyle(persisted.style || "narratif");
        setOrder(persisted.order || []);
        setTitlesById(persisted.titlesById || {});
      }
      const saved = JSON.parse(localStorage.getItem(LS_KEY_FINAL) || "null");
      if (saved?.chapters) setChapters(saved.chapters);
      if (saved?.prefaceHtml) setPrefaceHtml(saved.prefaceHtml);
      if (saved?.conclusionHtml) setConclusionHtml(saved.conclusionHtml);
      if (Array.isArray(saved?.prefaceImages)) setPrefaceImages(saved.prefaceImages);
      if (Array.isArray(saved?.conclusionImages)) setConclusionImages(saved.conclusionImages);
      const hist = JSON.parse(localStorage.getItem(LS_KEY_HISTORY) || "[]");
      if (hist.length) setHistory(hist);
      // ✅ Charger la couleur de couverture si présente
try {
  const savedBg = localStorage.getItem("draft:final:coverBg");
  if (savedBg) setCoverBg(savedBg);
  const savedImg = localStorage.getItem("draft:final:coverBgImage");
  if (savedImg) setCoverBgImage(savedImg);
  const savedScale = Number(localStorage.getItem("draft:final:coverBgScale") || "");
  if (!Number.isNaN(savedScale) && savedScale > 0) setCoverBgScale(savedScale);
} catch {}
    } catch {}
        const savedBlanks = JSON.parse(localStorage.getItem("draft:final:blankPages") || "[]");
    if (Array.isArray(savedBlanks)) setExtraPages(savedBlanks);

  }, []);

  // Hydrate from builder-generated book when redirected from builder
  useEffect(() => {
    try {
      const just = localStorage.getItem("book:justGenerated");
      const raw = localStorage.getItem("book:final");
      if (just === "true" && raw) {
        const title = localStorage.getItem("book:lastTitle") || "";
        const parts = raw.split(/^#\s+/m).filter(Boolean);
        const parsedChapters: Chapter[] = parts.map((chunk, idx) => {
          const lines = chunk.split(/\r?\n/);
          const chTitle = (lines.shift() || `Chapitre ${idx + 1}`).trim();
          const chText = lines.join("\n").trim();
          return { id: `gen-${idx}`, title: chTitle, text: chText, images: [] };
        });
        if (title) setBookTitle(title);
        if (parsedChapters.length) {
          setChapters(parsedChapters);
          pushHistory({ prefaceHtml, chapters: parsedChapters, conclusionHtml });
          try {
            localStorage.setItem(
              LS_KEY_FINAL,
              JSON.stringify({ prefaceHtml, chapters: parsedChapters, conclusionHtml })
            );
          } catch {}
        }
        localStorage.removeItem("book:justGenerated");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!allBlocks.length) return;
    if (chapters.length) return;

    const byId = new Map(allBlocks.map((b) => [b.id, b]));
    const ids = order.length ? order : allBlocks.map((b) => b.id);

    const built: Chapter[] = ids
      .map((id) => {
        const b = byId.get(id);
        if (!b) return null;
        const title = (titlesById[id] || b.title || id).trim();
        const raw = (b.summary || "").trim();
        if (!raw) return null;
        return { id, title, text: raw, images: [] };
      })
      .filter(Boolean) as Chapter[];

    setChapters(built);
    pushHistory({ prefaceHtml, chapters: built, conclusionHtml });
  }, [allBlocks, order, titlesById]);

  const handleAddImage2 = (idx: number) => {
    const input = inputFileRef.current;
    if (!input) return;
    // Reset pour permettre la même sélection plusieurs fois d'affilée
    try {
      (input as any).value = "";
    } catch {}
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (idx >= 0) {
          setChapters((prev) => {
            const next = [...prev];
            const current = next[idx];
            if (!current) return prev;
            const updatedImages = [...(current.images || []), base64];
            next[idx] = { ...current, images: updatedImages };
  const handleAddImage2 = (idx: number) => {
    const input = inputFileRef.current;
    if (!input) return;
    pendingImageTargetRef.current = idx;
    try { (input as any).value = ""; } catch {}
    input.click();
  };
            pushHistory({ prefaceHtml, chapters: next, conclusionHtml });
            return next;
          });
          debouncedSave();
          return;
        }
        const imgBlock = `<div class=\"mt-6 flex justify-center\"><img src=\"${base64}\" alt=\"\" class=\"max-w-[80%] rounded-lg shadow-md border border-gray-200\" /></div>`;
        if (idx === -1) {
          setPrefaceHtml((prev) => {
            const html = (prev || "") + imgBlock;
            pushHistory({ prefaceHtml: html, chapters, conclusionHtml });
            return html;
          });
          debouncedSave();
          return;
        }
        if (idx === -2) {
          setConclusionHtml((prev) => {
            const html = (prev || "") + imgBlock;
            pushHistory({ prefaceHtml, chapters, conclusionHtml: html });
            return html;
          });
          debouncedSave();
          return;
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
// Convertit ton HTML (préface/conclusion) en texte brut
function htmlToText(html: string | undefined | null): string {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Construit le texte complet du livre à partir de ton état
function buildBookText(
  prefaceHtml: string,
  chapters: { title: string; text: string }[],
  conclusionHtml: string
): string {
  const preface = htmlToText(prefaceHtml);
  const conclusion = htmlToText(conclusionHtml);

  const chaps = chapters
    .map((c) => `# ${c.title}\n\n${(c.text || "").trim()}`)
    .join("\n\n");

  return `${preface ? "# Préface\n\n" + preface + "\n\n" : ""}${chaps}${
    conclusion ? "\n\n# Conclusion\n\n" + conclusion : ""
  }`;
}
  function updateChapter(idx: number, patch: Partial<Chapter>) {
    setChapters((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      pushHistory({ prefaceHtml, chapters: next, conclusionHtml });
      return next;
    });
    debouncedSave();
  }

  function removeChapterImage(chIdx: number, imgIdx: number) {
    setChapters((prev) => {
      const next = [...prev];
      const current = next[chIdx];
      if (!current) return prev;
      const imgs = [...(current.images || [])];
      if (imgIdx < 0 || imgIdx >= imgs.length) return prev;
      imgs.splice(imgIdx, 1);
      next[chIdx] = { ...current, images: imgs };
      pushHistory({ prefaceHtml, chapters: next, conclusionHtml });
      return next;
    });
    debouncedSave();
  }

  function removePrefaceImage(imgIdx: number) {
    setPrefaceImages((prev) => {
      const next = [...prev];
      if (imgIdx < 0 || imgIdx >= next.length) return prev;
      next.splice(imgIdx, 1);
      pushHistory({ prefaceHtml, chapters, conclusionHtml });
      return next;
    });
    debouncedSave();
  }

  function removeConclusionImage(imgIdx: number) {
    setConclusionImages((prev) => {
      const next = [...prev];
      if (imgIdx < 0 || imgIdx >= next.length) return prev;
      next.splice(imgIdx, 1);
      pushHistory({ prefaceHtml, chapters, conclusionHtml });
      return next;
    });
    debouncedSave();
  }

  pageCounterRef.current = 0;
  const tableOfContents = chapters.map((ch, i) => `Chapitre ${i + 1} — ${ch.title}`);

  return (
    <>
{/* ✅ Couverture invisible pour export PDF */}
<div
  id="pdf-cover-for-export"
  style={{
    width: "720px",
    height: "1020px",
    backgroundColor: coverBg || "#9DC8A5",
    backgroundImage: coverBgImage ? `url("${coverBgImage}")` : "none",
    backgroundSize: coverBgImage ? `${coverBgScale}px ${coverBgScale}px` : "cover",
    backgroundRepeat: coverBgImage ? "repeat" : "no-repeat",
    backgroundPosition: coverBgImage ? "top left" : "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Georgia, serif",
    fontSize: "32px",
    position: "fixed",
    top: "0",
    left: "0",
    opacity: 0,
    pointerEvents: "none",
    zIndex: -9999,
  }}
>
  <div
    style={{
      fontWeight: "bold",
      fontSize: coverTitleSize === "large" ? "48px" : coverTitleSize === "small" ? "36px" : "42px",
      fontFamily: coverTitleFont,
      textAlign: "center",
      padding: "0 40px",
      color: coverTextColor, // ✅ inline
    }}
  >
    {bookTitle || "Titre du livre"}
  </div>
  <div
    style={{
      marginTop: "20px",
      fontStyle: "italic",
      fontSize: coverSubtitleSize === "large" ? "28px" : coverSubtitleSize === "small" ? "20px" : "24px",
      fontFamily: coverSubtitleFont,
      textAlign: "center",
      padding: "0 40px",
      color: coverTextColor, // ✅ inline
    }}
  >
    {subtitle || "Sous-titre du livre"}
  </div>
  <div
    style={{
      position: "absolute",
      bottom: "40px",
      fontSize: "14px",
      color: coverTextColor,
    }}
  >
    MEMOSPHERE BOOK
  </div>
</div>
    <div className="max-w-[1200px] mx-auto p-6 space-y-8">
      <input
  type="file"
  ref={inputFileRef}
  accept="image/*"
  onChange={async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    let base64 = '';
    try {
      // Si compressImage(file) existe déjà, garde-le:
      base64 = await compressImage(file);
    } catch {
      // Fallback simple si tu préfères:
      try {
        base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } catch { return; }
    }

    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);

      // Trouve l'éditeur contentEditable (où se trouve le caret)
      let container = range.commonAncestorContainer as HTMLElement | null;
      while (container && (!container.getAttribute || container.getAttribute('contenteditable') !== 'true')) {
        container = container.parentElement;
      }
      if (!container) return;

      // Hôte absolu (zone de page)
      const host = container.parentElement as HTMLElement | null;
      if (!host) return;

      // Couche flottante (créée au besoin)
      let layer = host.querySelector('[data-ms-float-layer="1"]') as HTMLDivElement | null;
      if (!layer) {
  layer = document.createElement('div');
  layer.setAttribute('data-ms-float-layer', '1');
  layer.style.position = 'absolute';
  // anchor precisely to the editable box
  const contRect = container.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  layer.style.left = (contRect.left - hostRect.left) + 'px';
  layer.style.top = (contRect.top - hostRect.top) + 'px';
  layer.style.width = container.clientWidth + 'px';
  layer.style.height = container.clientHeight + 'px';
  layer.style.pointerEvents = 'none';
  host.appendChild(layer);
  // keep layer aligned on resize/layout
  const sync = () => {
    const cr = container.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    layer!.style.left = (cr.left - hr.left) + 'px';
    layer!.style.top = (cr.top - hr.top) + 'px';
    layer!.style.width = container.clientWidth + 'px';
    layer!.style.height = container.clientHeight + 'px';
  };
  window.addEventListener('resize', sync);
  setTimeout(sync, 0);
}


      // Bloc image flottante
      const wrap = document.createElement('div');
      wrap.className = 'group';
      wrap.style.position = 'absolute';
      wrap.style.left = '16px';
      wrap.style.top = '16px';
      wrap.style.width = '240px';
      wrap.style.height = '160px';
      wrap.style.pointerEvents = 'auto';
      wrap.style.cursor = 'grab';
      wrap.style.userSelect = 'none';

      const img = document.createElement('img');
      img.src = base64;
      img.alt = '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '8px';
      img.style.boxShadow = '0 6px 18px rgba(0,0,0,0.15)';
      img.style.border = '1px solid rgba(0,0,0,0.08)';
      (img as any).draggable = false;

      // Bouton supprimer (au survol)
      const del = document.createElement('button');
      del.type = 'button';
      del.setAttribute('data-role', 'delete');
      del.title = "Supprimer l'image";
      del.textContent = 'x';
      del.style.position = 'absolute';
      del.style.top = '-8px';
      del.style.right = '-8px';
      del.style.fontSize = '12px';
      del.style.padding = '2px 6px';
      del.style.borderRadius = '9999px';
      del.style.background = 'white';
      del.style.border = '1px solid rgba(0,0,0,0.15)';
      del.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)';
      del.style.opacity = '0';
      del.style.transition = 'opacity .15s ease';
      del.onclick = (ev) => { ev.stopPropagation(); wrap.remove(); };

      // Poignée de redimension en bas à droite
      const handle = document.createElement('div');
      handle.setAttribute('data-role', 'resize');
      handle.title = 'Redimensionner';
      handle.style.position = 'absolute';
      handle.style.right = '0';
      handle.style.bottom = '0';
      handle.style.width = '12px';
      handle.style.height = '12px';
      handle.style.background = 'white';
      handle.style.border = '1px solid rgba(0,0,0,0.2)';
      handle.style.borderTopLeftRadius = '4px';
      handle.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
      handle.style.cursor = 'nwse-resize';
      handle.style.opacity = '0';
      handle.style.transition = 'opacity .15s ease';

      wrap.onmouseenter = () => { del.style.opacity = '1'; handle.style.opacity = '1'; };
      wrap.onmouseleave = () => { del.style.opacity = '0'; handle.style.opacity = '0'; };

      // Drag
      let dragInfo: { x0:number; y0:number; startL:number; startT:number } | null = null;
      wrap.onmousedown = (ev) => {
        const t = ev.target as HTMLElement;
        if (t.getAttribute('data-role') === 'resize' || t.getAttribute('data-role') === 'delete') return;
        ev.preventDefault();
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        const rect = wrap.getBoundingClientRect();
        const hostRect = layer!.getBoundingClientRect();
        dragInfo = { x0: (ev as MouseEvent).clientX, y0: (ev as MouseEvent).clientY, startL: rect.left - hostRect.left, startT: rect.top - hostRect.top };
      };

      // Resize (preserve aspect ratio)
      let resizeInfo: { x0:number; y0:number; startW:number; startH:number; ratio:number } | null = null;
      handle.onmousedown = (ev) => {
        ev.stopPropagation();
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';
        const startW = wrap.clientWidth;
        const startH = wrap.clientHeight;
        resizeInfo = {
          x0: (ev as MouseEvent).clientX,
          y0: (ev as MouseEvent).clientY,
          startW,
          startH,
          ratio: startW > 0 && startH > 0 ? startW / startH : 1,
        };
      };

      const onMove = (ev: MouseEvent) => {
        if (dragInfo) {
          const dx = ev.clientX - dragInfo.x0;
          const dy = ev.clientY - dragInfo.y0;
          const hostW = layer!.clientWidth;
          const hostH = layer!.clientHeight;
          const w = wrap.clientWidth;
          const h = wrap.clientHeight;
          wrap.style.left = Math.max(0, Math.min(hostW - w, Math.round(dragInfo.startL + dx))) + 'px';
          wrap.style.top  = Math.max(0, Math.min(hostH - h, Math.round(dragInfo.startT + dy))) + 'px';
        } else if (resizeInfo) {
          const dx = ev.clientX - resizeInfo.x0;
          const dy = ev.clientY - resizeInfo.y0;
          // prefer the larger delta to feel diagonal from bottom-right
          const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
          const hostW = layer!.clientWidth;
          const hostH = layer!.clientHeight;
          const left = parseInt(wrap.style.left || '0', 10) || 0;
          const top  = parseInt(wrap.style.top  || '0', 10) || 0;
          const maxW = Math.max(40, hostW - left);
          const maxH = Math.max(40, hostH - top);
          // maintain aspect ratio
          let nw = Math.max(40, Math.round(resizeInfo.startW + delta));
          let nh = Math.max(40, Math.round(nw / (resizeInfo.ratio || 1)));
          // clamp within bounds while keeping ratio
          if (nw > maxW) {
            nw = maxW;
            nh = Math.max(40, Math.round(nw / (resizeInfo.ratio || 1)));
          }
          if (nh > maxH) {
            nh = maxH;
            nw = Math.max(40, Math.round(nh * (resizeInfo.ratio || 1)));
          }
          wrap.style.width  = nw + 'px';
          wrap.style.height = nh + 'px';
        }
      };
      const onUp = () => {
        dragInfo = null; resizeInfo = null;
        document.body.style.cursor = 'auto';
        document.body.style.userSelect = 'auto';
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      wrap.appendChild(img);
      wrap.appendChild(del);
      wrap.appendChild(handle);
      layer.appendChild(wrap);
    } catch {}

    try { (e.target as HTMLInputElement).value = ''; } catch {}
  }}
  style={{ display: 'none' }}
/>


      <div className="sticky top-0 z-50 bg-[#fdfaf6] flex items-center justify-between py-2 border-b border-gray-200 shadow-sm">
        <PageNavButtons show={["home", "draft", "blocks"]} />
        <div className="flex items-center gap-4">
    <button
  onClick={async () => {
    const { exportBookToPDF } = await import("@/utils/exportBookToPDF");
    await exportBookToPDF();
  }}
  
  className="text-sm px-3 py-1 rounded border bg-white hover:bg-gray-50 shadow-sm"
>
  ⬇️ Export PDF
</button>

    
  </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              if (history.length > 1) {
                restoreSnapshotAt(history.length - 2);
              }
            }}
            className="hidden text-sm px-3 py-1 rounded border bg-white hover:bg-gray-50 shadow-sm"
          >
            ↩ Annuler dernière action
          </button>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Historique</label>
            <select
              className="text-sm px-2 py-1 rounded border bg-white hover:bg-gray-50 shadow-sm"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) restoreSnapshotAt(v);
              }}
              value={history.length ? String(history.length - 1) : ''}
            >
              {history.map((_, i) => (
                <option key={i} value={i}>
                  Sauvegarde #{i + 1}{i === history.length - 1 ? ' (récente)' : ''}
                </option>
              ))}
              {!history.length && <option value="">Aucune</option>}
            </select>
          </div>
          <div className="text-xs text-gray-500">
            Rendu final — édition directe (autosave)
          </div>
        </div>
      </div>

  


 {/* Couv plein écran, fond vert uni */}
<BookPage
  showFooter={false}
  noShadow
  className="book-cover" 
>
  <div
  data-keep-bg="1"
  className="absolute inset-0 flex flex-col items-center justify-center"
  style={{
    backgroundColor: coverBg || "#9DC8A5",
    backgroundImage: coverBgImage ? `url("${coverBgImage}")` : "none",
    backgroundSize: coverBgImage ? `${coverBgScale}px ${coverBgScale}px` : "cover",
    backgroundRepeat: coverBgImage ? "repeat" : "no-repeat",
    backgroundPosition: coverBgImage ? "top left" : "center",
  }}
>
  <div className="absolute top-6 right-6 no-export">
  <button
    onClick={() => setShowCoverEditor(true)}
    className="text-xs bg-white/30 px-3 py-1 rounded hover:bg-white/50 text-black shadow-sm"
  >
    ✏️ Éditer la couverture
  </button>
</div>
  <EditableBlock
    html={`<div class='${coverTitleSize === "large" ? "text-5xl" : coverTitleSize === "small" ? "text-3xl" : "text-4xl"} font-extrabold drop-shadow-md' style='color:${coverTextColor}; font-family:${coverTitleFont}'>${bookTitle || "Titre du livre"}</div>`}
    onChange={(html) => setBookTitle(html.replace(/<[^>]+>/g, ""))}
    className=""
  />

  <div className="mt-4 opacity-90">
    <EditableBlock
      html={`<div class='${coverSubtitleSize === "large" ? "text-2xl" : coverSubtitleSize === "small" ? "text-lg" : "text-xl"} italic' style='color:${coverTextColor}; font-family:${coverSubtitleFont}'>${subtitle || "Sous-titre du livre"}</div>`}
      onChange={(html) => setSubtitle(html.replace(/<[^>]+>/g, ""))}
      className=""
    />
  </div>

    <div className="absolute bottom-8 text-xs tracking-wide opacity-85" style={{ color: coverTextColor }}>
      MEMOSPHERE BOOK
    </div>

  {showCoverEditor && (
      <CoverEditor
  initialBg={coverBg}
  initialTitle={bookTitle}
  initialSubtitle={subtitle}
  initialTitleSize={coverTitleSize}
  initialSubtitleSize={coverSubtitleSize}
  initialTitleFont={coverTitleFont}
  initialSubtitleFont={coverSubtitleFont}
  onSave={(bg: string, t: string, st: string, textColor: string, tSize: "small"|"medium"|"large", sSize: "small"|"medium"|"large", tFont: string, sFont: string, bgImg?: string | null, bgScale?: number) => {
    setCoverBg(bg);
    setBookTitle(t);
    setSubtitle(st);
    localStorage.setItem("draft:final:coverBg", bg);
    if (textColor) {
      setCoverTextColor(textColor);
      localStorage.setItem("draft:final:coverTextColor", textColor);
    }
    if (tSize) {
      setCoverTitleSize(tSize);
      localStorage.setItem("draft:final:coverTitleSize", tSize);
    }
    if (sSize) {
      setCoverSubtitleSize(sSize);
      localStorage.setItem("draft:final:coverSubtitleSize", sSize);
    }
    if (tFont) {
      setCoverTitleFont(tFont);
      localStorage.setItem("draft:final:coverTitleFont", tFont);
    }
    if (sFont) {
      setCoverSubtitleFont(sFont);
      localStorage.setItem("draft:final:coverSubtitleFont", sFont);
    }
    if (typeof bgImg === 'string' && bgImg.length) {
      setCoverBgImage(bgImg);
      localStorage.setItem("draft:final:coverBgImage", bgImg);
    } else {
      setCoverBgImage(null);
      localStorage.removeItem("draft:final:coverBgImage");
    }
    if (typeof bgScale === 'number' && bgScale > 0) {
      setCoverBgScale(bgScale);
      localStorage.setItem("draft:final:coverBgScale", String(bgScale));
    }
    setShowCoverEditor(false);
  }}
  onCancel={() => setShowCoverEditor(false)}
/>
    )}
  </div>
</BookPage>




<InsertButton after={pageCounterRef.current} />
{renderBlankPagesAfter(pageCounterRef.current)}

      {/* Sommaire */}
      <BookPage showFooter pageNumber={nextPageNumber()} bookTitle={bookTitle}>
        <h2 className="text-2xl font-serif mb-6 text-center">Sommaire</h2>
        <ul className="space-y-2 text-lg">
          {tableOfContents.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </BookPage>

<InsertButton after={pageCounterRef.current} />
{renderBlankPagesAfter(pageCounterRef.current)}


      {/* Préface: une seule page éditable (sans pagination live) */}
      <BookPage
        showFooter
        pageNumber={nextPageNumber()}
        bookTitle={bookTitle}
        onAddImage={() => { pendingImageTargetRef.current = -1; pendingChapterPageRef.current = 0; const input = inputFileRef.current; if (input) { try { (input as any).value = ""; } catch {} input.click(); } }}
      >
        <h2 className="text-2xl font-serif mb-6 text-center">Préface</h2>
        <EditableBlock
          html={`<div class='prose prose-neutral max-w-none'>${String(prefaceHtml || '').includes('<') ? String(prefaceHtml || '') : String(prefaceHtml || '').split("\n\n").map((para) => `<p>${para}</p>`).join("")}</div>`}
          onChange={(html) => {
            setPrefaceHtml(html);
          }}
          enableImageDelete
          className="ms-edit h-[780px] overflow-auto export-paginate"
        />
      </BookPage>
      <InsertButton after={pageCounterRef.current} />

      {conclusionImages.map((src, i) => (
        <BookPage
          key={`concl-img-${i}`}
          showFooter
          pageNumber={nextPageNumber()}
          bookTitle={bookTitle}
        >
          <div className="mt-6 flex justify-center group relative">
            <img
              src={typeof src === "string" ? src : src?.src}
              alt=""
              className="max-w-[80%] max-h-[820px] object-contain rounded-lg shadow-md border border-gray-200"
            />
            <button
              type="button"
              onClick={() => removeConclusionImage(i)}
              title="Supprimer l'image"
              aria-label="Supprimer l'image"
              className="absolute -top-2 right-10 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-full bg-white border shadow hover:bg-red-50 hover:text-red-600"
            >
              ×
            </button>
          </div>
        </BookPage>
        
      ))}
    

      {prefaceImages.map((src, i) => (
        <BookPage
          key={`preface-img-${i}`}
          showFooter
          pageNumber={nextPageNumber()}
          bookTitle={bookTitle}
        >
          <div className="mt-6 flex justify-center group relative">
            <img
              src={typeof src === "string" ? src : src?.src}
              alt=""
              className="max-w-[80%] max-h-[820px] object-contain rounded-lg shadow-md border border-gray-200"
            />
            <button
              type="button"
              onClick={() => removePrefaceImage(i)}
              title="Supprimer l'image"
              aria-label="Supprimer l'image"
              className="absolute -top-2 right-10 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-full bg-white border shadow hover:bg-red-50 hover:text-red-600"
            >
              ×
            </button>
          </div>
        </BookPage>
      ))}






      {/* Chapitres: une page par chapitre (sans pagination live) */}
      {chapters.map((ch, chIdx) => {
        const imgs = normalizeChapterImages(ch.images);
        return (
          <React.Fragment key={ch.id}>
            <BookPage
              showFooter
              pageNumber={nextPageNumber()}
              bookTitle={bookTitle}
              onAddImage={() => {
                pendingImageTargetRef.current = chIdx;
                pendingChapterPageRef.current = 0;
                const input = inputFileRef.current; if (input) { try { (input as any).value = ""; } catch {} input.click(); }
              }}
            >
              <div className="export-paginate h-[780px] overflow-hidden flex flex-col">
                <div className="mb-4">
                  <div className="text-xs tracking-[0.25em] uppercase text-gray-400">Chapitre {chIdx + 1}</div>
                  <EditableBlock
                    html={`<div class='mt-2 text-2xl font-serif'>${ch.title}</div>`}
                    onChange={(html) => updateChapter(chIdx, { title: html.replace(/<[^>]+>/g, "").trim() })}
                  />
                </div>

                <EditableBlock
                  html={`<div class='prose prose-neutral max-w-none'>${String(ch.text || '').includes('<') ? String(ch.text || '') : String(ch.text || '').split("\n\n").map((para) => `<p>${para}</p>`).join("")}</div>`}
                  onChange={(html) => {
                    updateChapter(chIdx, { text: html });
                  }}
                  className="ms-edit flex-1 overflow-auto"
                />
              </div>
            </BookPage>

            {/* Affichage des images du chapitre (toutes) */}
            {imgs.length > 0 && (
              <BookPage
                showFooter
                pageNumber={nextPageNumber()}
                bookTitle={bookTitle}
              >
                {imgs.map((img, i) => (
                  <div key={i} className="mt-6 flex justify-center group relative">
                    <img src={img.src} alt="" className="max-w-[80%] rounded-lg shadow-md border border-gray-200" />
                    <button
                      type="button"
                      onClick={() => {
                        setChapters((prev) => {
                          const next = [...prev];
                          const current = next[chIdx];
                          if (!current) return prev;
                          const curImgs = normalizeChapterImages(current.images);
                          if (i < 0 || i >= curImgs.length) return prev;
                          curImgs.splice(i, 1);
                          next[chIdx] = { ...current, images: curImgs };
                          pushHistory({ prefaceHtml, chapters: next, conclusionHtml });
                          return next;
                        });
                        debouncedSave();
                      }}
                      title="Supprimer l'image"
                      aria-label="Supprimer l'image"
                      className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-full bg-white border shadow hover:bg-red-50 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </BookPage>
            )}

            <InsertButton after={pageCounterRef.current} />
            {renderBlankPagesAfter(pageCounterRef.current)}
          </React.Fragment>
        );
      })}




      {/* Conclusion: une seule page éditable (sans pagination live) */}
      <BookPage
        showFooter
        pageNumber={nextPageNumber()}
        bookTitle={bookTitle}
        onAddImage={() => { pendingImageTargetRef.current = -2; pendingChapterPageRef.current = 0; const input = inputFileRef.current; if (input) { try { (input as any).value = ""; } catch {} input.click(); } }}
      >
        <h2 className="text-2xl font-serif mb-6 text-center">Conclusion</h2>
        <EditableBlock
          html={`<div class='prose prose-neutral max-w-none'>${String(conclusionHtml || '').includes('<') ? String(conclusionHtml || '') : String(conclusionHtml || '').split("\n\n").map((para) => `<p>${para}</p>`).join("")}</div>`}
          onChange={(html) => {
            setConclusionHtml(html);
          }}
          enableImageDelete
          className="ms-edit h-[780px] overflow-auto export-paginate"
        />
      </BookPage>
      
    </div>
    </>
  );
}
