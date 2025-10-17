"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * PaginatedEditor.tsx
 * - Editeur WYSIWYG paginé "façon Word"
 * - Usage: <PaginatedEditor initialHtml={...} onChange={(html)=>...} />
 *
 * Principes :
 * - Pages = tableau de fragments HTML (chaque page a un div contentEditable)
 * - Lorsqu'une page déborde (scrollHeight > clientHeight) on coupe les noeuds en trop
 *   et on les colle au début de la page suivante (création si nécessaire).
 * - Lorsqu'une page a de la place et que la suivante contient du texte, on remonte
 *   progressivement du contenu depuis la page suivante (reflow).
 * - Gestion du caret (focus) : on préserve le caret en fin quand on crée/insère.
 *
 * Remarques :
 * - Le split se base sur les noeuds enfants (paragraphes / blocs). Ça marche bien pour
 *   du texte structuré en <p>, <div>, <img> blocs. Si tu veux split caractère-par-caractère,
 *   c'est plus complexe (mais faisable).
 * - Déjà robuste contre les boucles via flags _processing sur chaque élément.
 */

type Props = {
  initialHtml?: string;
  onChange?: (html: string) => void;
  pageWidth?: number;
  pageHeight?: number; // totale incl. paddings
  innerPadding?: number;
};

function Page({
  children,
  pageNumber,
  pageWidth,
  pageHeight,
  innerPadding,
  onAddImage,
  floats,
  onFloatsChange,
}: {
  children: React.ReactNode;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  innerPadding: number;
  onAddImage?: () => void;
  floats?: { id: string; src: string; x: number; y: number; w: number; h: number }[];
  onFloatsChange?: (items: { id: string; src: string; x: number; y: number; w: number; h: number }[]) => void;
}) {
  const innerHeight = pageHeight - innerPadding * 2;
  return (
    <div
      className="paginated-page"
      style={{
        width: `${pageWidth}px`,
        height: `${pageHeight}px`,
        background: "#fdfaf6",
        borderRadius: 12,
        boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
        border: "1px solid rgba(0,0,0,0.06)",
        margin: "24px auto",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: innerPadding,
          overflow: "hidden",
          fontFamily:
            'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
          fontSize: 15,
          lineHeight: 1.9,
          color: "#111827",
        }}
      >
        {children}
        {/* Floating image layer */}
        <div
          className="relative"
          style={{ width: "100%", height: innerHeight, pointerEvents: "none" }}
        >
          {(floats || []).map((it) => (
            <FloatingItemView
              key={it.id}
              item={it}
              bounds={{ w: pageWidth - innerPadding * 2, h: innerHeight }}
              onChange={(next) => {
                const arr = (floats || []).map((x) => (x.id === next.id ? next : x));
                onFloatsChange && onFloatsChange(arr);
              }}
              onDelete={() => {
                const arr = (floats || []).filter((x) => x.id !== it.id);
                onFloatsChange && onFloatsChange(arr);
              }}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 12,
          right: 12,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "#6b7280",
          pointerEvents: "none",
        }}
      >
        <div>MemoSphere</div>
        <div style={{ pointerEvents: "none" }}>{pageNumber}</div>
      </div>

      {onAddImage && (
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", pointerEvents: "auto" }}>
          <button onClick={onAddImage} style={{ fontSize: 12, padding: "6px 10px" }}>
            ➕ Image
          </button>
        </div>
      )}
    </div>
  );
}

function FloatingItemView({
  item,
  bounds,
  onChange,
  onDelete,
}: {
  item: { id: string; src: string; x: number; y: number; w: number; h: number };
  bounds: { w: number; h: number };
  onChange: (next: { id: string; src: string; x: number; y: number; w: number; h: number }) => void;
  onDelete: () => void;
}) {
  const dragRef = React.useRef<{ x0: number; y0: number; startX: number; startY: number } | null>(null);
  const resizeRef = React.useRef<{ x0: number; y0: number; startW: number; startH: number } | null>(null);

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (dragRef.current) {
        const { x0, y0, startX, startY } = dragRef.current;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        let nx = Math.max(0, Math.min(bounds.w - item.w, Math.round(startX + dx)));
        let ny = Math.max(0, Math.min(bounds.h - item.h, Math.round(startY + dy)));
        onChange({ ...item, x: nx, y: ny });
      } else if (resizeRef.current) {
        const { x0, y0, startW, startH } = resizeRef.current;
        const dx = e.clientX - x0;
        const dy = e.clientY - y0;
        let nw = Math.max(40, Math.min(bounds.w - item.x, Math.round(startW + dx)));
        let nh = Math.max(40, Math.min(bounds.h - item.y, Math.round(startH + dy)));
        onChange({ ...item, w: nw, h: nh });
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.cursor = "auto";
      document.body.style.userSelect = "auto";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [bounds.w, bounds.h, item, onChange]);

  return (
    <div
      className="group"
      style={{
        position: "absolute",
        left: item.x,
        top: item.y,
        width: item.w,
        height: item.h,
        pointerEvents: "auto",
        cursor: "grab",
        userSelect: "none",
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.getAttribute("data-role") === "resize" || target.getAttribute("data-role") === "delete") return;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        dragRef.current = { x0: (e as any).clientX, y0: (e as any).clientY, startX: item.x, startY: item.y };
      }}
    >
      <img
        src={item.src}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.15)", border: "1px solid rgba(0,0,0,0.08)" }}
        draggable={false}
      />
      <button
        type="button"
        data-role="delete"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Supprimer l'image"
        aria-label="Supprimer l'image"
        className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-full bg-white border shadow hover:bg-red-50 hover:text-red-600"
      >
        ×
      </button>
      <div
        data-role="resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "nwse-resize";
          document.body.style.userSelect = "none";
          resizeRef.current = { x0: (e as any).clientX, y0: (e as any).clientY, startW: item.w, startH: item.h };
        }}
        title="Redimensionner"
        className="absolute right-0 bottom-0 w-3 h-3 bg-white border rounded-tl cursor-nwse-resize opacity-0 group-hover:opacity-100"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
      />
    </div>
  );
}
/**
 * Helpers caret utilities
 */
function setCaretToEnd(el: HTMLElement) {
  try {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    // ignore
  }
}

function htmlFromPages(pages: string[]) {
  return pages.join("\n\n");
}

/**
 * Main component
 */
export default function PaginatedEditor({
  initialHtml = "<p></p>",
  onChange,
  pageWidth = 720,
  pageHeight = 1020,
  innerPadding = 56,
}: Props) {
  const innerHeight = pageHeight - innerPadding * 2;
  // store pages as HTML strings; initial split into first page containing everything
  const [pages, setPages] = useState<string[]>(() => {
    // simple initial split: try to split into paragraphs
    const text = (initialHtml || "").replace(/<\/?(br|hr)[^>]*>/gi, "\n");
    const paras = text.replace(/<[^>]+>/g, "").split(/\n\n+/).filter(Boolean);
    if (paras.length === 0) return [initialHtml || "<p></p>"];
    // naive: group paragraphs until approximate height by characters -> one page
    let cur: string[] = [];
    const result: string[][] = [];
    let approx = 0;
    for (const p of paras) {
      approx += p.length;
      cur.push(`<p>${p}</p>`);
      if (approx > 1500) {
        result.push(cur);
        cur = [];
        approx = 0;
      }
    }
    if (cur.length) result.push(cur);
    return result.map((r) => r.join(""));
  });

  // refs to the page contentEditable elements
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // processing flags to avoid reentrancy
  const processingRef = useRef<Record<number, boolean>>({});
  // floating images state
  const fileRef = useRef<HTMLInputElement | null>(null);
  const targetPageRef = useRef<number | null>(null);
  const [floatsByPage, setFloatsByPage] = useState<Record<number, { id: string; src: string; x: number; y: number; w: number; h: number }[]>>({});

  // effect: whenever pages change, emit combined HTML
  useEffect(() => {
    if (onChange) {
      onChange(htmlFromPages(pages));
    }
  }, [pages, onChange]);

  // ensure refs array matches pages length
  useEffect(() => {
    pageRefs.current = pageRefs.current.slice(0, pages.length);
  }, [pages.length]);

  // split overflow from page index -> moves overflowing nodes to next page
  function splitOverflowFromPage(index: number) {
    const el = pageRefs.current[index];
    if (!el) return;
    if (processingRef.current[index]) return;
    processingRef.current[index] = true;

    try {
      // measure
      const scrollH = el.scrollHeight;
      const clientH = el.clientHeight;
      if (scrollH <= clientH) {
        processingRef.current[index] = false;
        return;
      }

      // gather children nodes (we assume block-level paragraphs/images are children)
      const children = Array.from(el.childNodes);
      let total = 0;
      let splitIndex = children.length;
      for (let i = 0; i < children.length; i++) {
        const node = children[i] as HTMLElement;
        // create temporary wrapper to measure incremental height
        const wrapper = document.createElement("div");
        wrapper.style.position = "absolute";
        wrapper.style.visibility = "hidden";
        wrapper.style.width = `${pageWidth - innerPadding * 2}px`;
        wrapper.appendChild(node.cloneNode(true));
        document.body.appendChild(wrapper);
        const h = wrapper.scrollHeight;
        document.body.removeChild(wrapper);
        total += h;
        if (total > clientH * 0.95) {
          splitIndex = i;
          break;
        }
      }

      if (splitIndex >= children.length) {
        // fallback: nothing to move
        processingRef.current[index] = false;
        return;
      }

      // build overflow HTML from remaining nodes
      const remaining = children.slice(splitIndex);
      const temp = document.createElement("div");
      remaining.forEach((n) => temp.appendChild(n.cloneNode(true)));
      const overflowHtml = temp.innerHTML;

      // remove overflowing nodes from current el (destructive to DOM)
      for (let i = splitIndex; i < children.length; i++) {
        const node = children[i];
        if (node.parentNode === el) el.removeChild(node);
      }

      // update page content in state for current page
      const currentHtml = el.innerHTML;
      setPages((prev) => {
        const next = prev.slice();
        next[index] = currentHtml;
        // ensure next page exists
        if (next.length <= index + 1) {
          next.push(overflowHtml);
        } else {
          // prepend overflowHtml to next page content
          next[index + 1] = overflowHtml + next[index + 1];
        }
        return next;
      });

      // after DOM update, focus the next page if caret was at end
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0);
          if (r && r.endContainer && el.contains(r.endContainer)) {
            // move caret to beginning of newly created content in next page
            const nextEl = pageRefs.current[index + 1];
            if (nextEl) {
              // place caret at start of nextEl
              nextEl.focus();
              const range = document.createRange();
              range.selectNodeContents(nextEl);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        }
      }, 40);
    } catch (err) {
      console.warn("splitOverflow error", err);
    } finally {
      processingRef.current[index] = false;
    }
  }

  // try to pull content from next page into this page if space allows
  function tryPullFromNext(index: number) {
    const el = pageRefs.current[index];
    const nextEl = pageRefs.current[index + 1];
    if (!el || !nextEl) return;

    if (processingRef.current[index] || processingRef.current[index + 1]) return;
    processingRef.current[index] = true;
    processingRef.current[index + 1] = true;

    try {
      // while there's space on current and next has nodes, move the first node of next to end of current
      let safety = 0;
      while (safety++ < 50) {
        const curScroll = el.scrollHeight;
        const curClient = el.clientHeight;
        if (curScroll >= curClient * 0.95) break; // no space
        const nextChildren = Array.from(nextEl.childNodes);
        if (!nextChildren.length) break;
        const first = nextChildren[0];
        // measure first's height when appended to current
        const wrapper = document.createElement("div");
        wrapper.style.position = "absolute";
        wrapper.style.visibility = "hidden";
        wrapper.style.width = `${pageWidth - innerPadding * 2}px`;
        wrapper.appendChild(first.cloneNode(true));
        document.body.appendChild(wrapper);
        const h = wrapper.scrollHeight;
        document.body.removeChild(wrapper);

        if (curScroll + h > curClient * 0.95) break; // not enough space
        // move node from nextEl to el
        const moved = nextEl.removeChild(first);
        el.appendChild(moved);
        // update state HTMLs
        setPages((prev) => {
          const next = prev.slice();
          next[index] = el.innerHTML;
          next[index + 1] = nextEl.innerHTML;
          // if next becomes empty, remove the next page
          if (next[index + 1].trim() === "") {
            next.splice(index + 1, 1);
          }
          return next;
        });
      }
    } catch (err) {
      console.warn("tryPullFromNext err", err);
    } finally {
      processingRef.current[index] = false;
      processingRef.current[index + 1] = false;
    }
  }

  // handle input in a page -> update state and then check overflows/reflow
  function onPageInput(index: number, e: React.FormEvent<HTMLDivElement>) {
    const el = e.target as HTMLDivElement;
    // store the html
    const html = el.innerHTML;
    setPages((prev) => {
      const next = prev.slice();
      next[index] = html;
      return next;
    });

    // small timeout to let DOM update, then check
    setTimeout(() => {
      // if overflow -> split
      const elRef = pageRefs.current[index];
      if (elRef && elRef.scrollHeight > elRef.clientHeight) {
        splitOverflowFromPage(index);
      } else {
        // maybe we freed space -> try pull from next
        if (pages.length > index + 1) {
          tryPullFromNext(index);
        }
      }
    }, 30);
  }

  // effect: whenever page elements mount/changes, re-check overflow for all pages (initial render)
  useEffect(() => {
    // microtask after mount
    const t = setTimeout(() => {
      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i];
        if (!el) continue;
        if (el.scrollHeight > el.clientHeight) {
          splitOverflowFromPage(i);
        } else {
          tryPullFromNext(i);
        }
      }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helpers to add/remove pages manually
  function insertPageAfter(index: number) {
    const id = Date.now();
    setPages((prev) => {
      const next = prev.slice();
      next.splice(index + 1, 0, "<p></p>");
      return next;
    });
    // focus next page after render
    setTimeout(() => {
      const el = pageRefs.current[index + 1];
      if (el) setCaretToEnd(el);
    }, 80);
  }

  function deletePage(index: number) {
    if (pages.length === 1) {
      // clear content instead
      setPages(["<p></p>"]);
      return;
    }
    setPages((prev) => {
      const next = prev.slice();
      // if deleting page and it has content, append to previous
      if (index > 0) {
        next[index - 1] = next[index - 1] + "\n\n" + (next[index] || "");
      } else if (index === 0 && next[1]) {
        // merge with next if it's the first page
        next[1] = (next[0] || "") + "\n\n" + next[1];
      }
      next.splice(index, 1);
      return next;
    });
    setTimeout(() => {
      const focusIndex = Math.max(0, index - 1);
      const el = pageRefs.current[focusIndex];
      if (el) setCaretToEnd(el);
    }, 60);
  }

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        ref={fileRef}
        style={{ display: "none" }}
        onChange={(e) => {
          const pageIndex = targetPageRef.current;
          targetPageRef.current = null;
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file || pageIndex == null) return;
          const reader = new FileReader();
          reader.onload = () => {
            const src = String(reader.result || "");
            setFloatsByPage((prev) => {
              const arr = prev[pageIndex] ? [...prev[pageIndex]] : [];
              arr.push({ id: String(Date.now() + Math.random()), src, x: 16, y: 16, w: 240, h: 160 });
              return { ...prev, [pageIndex]: arr };
            });
          };
          reader.readAsDataURL(file);
          try { (e.target as HTMLInputElement).value = ""; } catch {}
        }}
      />
      <div style={{ display: "flex", gap: 12, justifyContent: "center", margin: "12px 0" }}>
        <button
          onClick={() => {
            insertPageAfter(0);
          }}
        >
          ➕ Nouvelle page après première
        </button>
        <button
          onClick={() => {
            // export combined html to console
            console.log("EXPORT HTML:", htmlFromPages(pages));
            alert("HTML copié dans la console (voir log).");
          }}
        >
          📤 Export HTML (console)
        </button>
      </div>

      <div>
        {pages.map((pHtml, idx) => (
          <Page
            key={idx}
            pageNumber={idx + 1}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            innerPadding={innerPadding}
            onAddImage={() => {
              targetPageRef.current = idx;
              const input = fileRef.current; if (input) { try { (input as any).value = ""; } catch {} input.click(); }
            }}
            floats={floatsByPage[idx] || []}
            onFloatsChange={(items) => setFloatsByPage((prev) => ({ ...prev, [idx]: items }))}
          >
            <div
              ref={(r) => { pageRefs.current[idx] = r; }}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => onPageInput(idx, e)}
              // ensure scroll container sized to innerHeight
              style={{
                width: "100%",
                height: `${innerHeight}px`,
                overflowY: "auto",
                boxSizing: "border-box",
                paddingRight: 8,
                outline: "none",
                whiteSpace: "normal",
              }}
              dangerouslySetInnerHTML={{ __html: pHtml }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
              <button
                onClick={() => {
                  insertPageAfter(idx);
                }}
                style={{ fontSize: 12 }}
              >
                ➕ Insérer page après
              </button>
              <button
                onClick={() => {
                  deletePage(idx);
                }}
                style={{ fontSize: 12, color: "crimson" }}
              >
                🗑 Supprimer cette page
              </button>
            </div>
          </Page>
        ))}
      </div>
    </div>
  );
}
