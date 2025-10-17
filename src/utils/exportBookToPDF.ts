// src/utils/exportBookToPDF.ts
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Patch universel pour ignorer les fonctions CSS de couleur non supportées
 * (lab(), lch(), oklab(), color(), display-p3(), etc.)
 */
function patchColorParser() {
  if (typeof window === "undefined") return;
  const g: any = window as any;
  const Color = g.Color;
  if (!Color || typeof Color.parse !== "function") return;

  const oldParse = Color.parse.bind(Color);
  Color.parse = (value: string) => {
    try {
      return oldParse(value);
    } catch {
      if (
        typeof value === "string" && /(oklab|oklch|lab|lch|color|display-p3)/i.test(value)
      ) {
        console.warn("Ignored unsupported color:", value);
        return { type: "rgb", values: [0, 0, 0, 1] };
      }
      throw value;
    }
  };
}

// Force computed RGB/hex colors inside html2canvas' cloned document to avoid
// failing on unsupported CSS color functions (oklab, oklch, lch, display-p3, color()).
function buildOncloneSanitizer(opts: { background?: string; coverTextColor?: string }) {
  return (doc: Document) => {
    try {
      const win = doc.defaultView || window;
      const elements = Array.from(doc.querySelectorAll<HTMLElement>("*"));
      const colorProps: Array<keyof CSSStyleDeclaration> = [
        "color",
        "backgroundColor",
        "borderColor",
        "borderTopColor",
        "borderRightColor",
        "borderBottomColor",
        "borderLeftColor",
        "outlineColor",
        "textDecorationColor",
        "columnRuleColor",
        "caretColor",
        // Not standard in TS typings yet in some envs but supported in CSS
        // as property name mapping
        // @ts-ignore
        "accentColor",
      ];

      const hasUnsupported = (v: string | null | undefined) =>
        typeof v === "string" && /(oklab|oklch|lch\(|lab\(|display-p3|color\()/i.test(v);

      for (const el of elements) {
        const cs = win.getComputedStyle(el);

        // Remove complex backgrounds/shadows that may embed unsupported colors
        // but preserve background images for the special cover node and its descendants
        const isCoverRoot = el.id === "pdf-cover-for-export";
        const insideCover = !isCoverRoot && !!(el as any).closest && !!(el as any).closest("#pdf-cover-for-export");
        const hasKeepBgAttr = el.hasAttribute && el.hasAttribute("data-keep-bg");
        const keepBgImage = isCoverRoot || insideCover || hasKeepBgAttr;

        if (keepBgImage) {
          const bgImg = cs.backgroundImage;
          if (bgImg && bgImg !== "none") (el.style as any).backgroundImage = bgImg;
        } else {
          el.style.backgroundImage = "none";
        }
        el.style.filter = "none";
        el.style.textShadow = "none";
        el.style.boxShadow = "none";

        for (const prop of colorProps) {
          const v = (cs as any)[prop] as string | undefined;
          if (!v) continue;
          if (hasUnsupported(v)) {
            // Fallback to computed RGB if available or safe default
            (el.style as any)[prop] = v.startsWith("rgb") || v.startsWith("#") ? v : "rgb(0,0,0)";
          } else {
            (el.style as any)[prop] = v;
          }
        }
      }

      // Ensure page background is solid to avoid transparency issues
      if (opts.background) {
        (doc.body.style as any).background = opts.background;
        (doc.documentElement.style as any).background = opts.background;
      }

      // If the special cover node exists in the cloned document, make it visible
      const cover = doc.getElementById("pdf-cover-for-export") as HTMLElement | null;
      if (cover) {
        cover.style.opacity = "1";
        cover.style.zIndex = "1";
        cover.style.pointerEvents = "auto";
        if (opts.coverTextColor) {
          cover.style.setProperty("color", opts.coverTextColor, "important");
        }
      }

      // Realign floating layers in the cloned DOM to their editable containers
      try {
        const layers = Array.from(doc.querySelectorAll('[data-ms-float-layer="1"]')) as HTMLDivElement[];
        layers.forEach((layer) => {
          const host = layer.parentElement as HTMLElement | null;
          if (!host) return;
          // Prefer a body editor (export-paginate) over small title editors
          const prefer = host.querySelector('.export-paginate') as HTMLElement | null;
          const container = prefer || (host.querySelector('[contenteditable="true"]') as HTMLElement | null);
          if (!container) return;
          // Size and position the layer to match the editable area in the clone (exclude padding)
          const rectC = (container as any).getBoundingClientRect ? (container as any).getBoundingClientRect() : null;
          const rectH = (host as any).getBoundingClientRect ? (host as any).getBoundingClientRect() : null;
          layer.style.position = 'absolute';
          const v = doc.defaultView || window;
          const cs = v.getComputedStyle(container as HTMLElement);
          const padL = parseFloat(cs.paddingLeft || '0') || 0;
          const padT = parseFloat(cs.paddingTop || '0') || 0;
          const padR = parseFloat(cs.paddingRight || '0') || 0;
          const padB = parseFloat(cs.paddingBottom || '0') || 0;
          if (rectC && rectH) {
            layer.style.left = (rectC.left - rectH.left + padL) + 'px';
            layer.style.top = (rectC.top - rectH.top + padT) + 'px';
          } else {
            layer.style.left = '0px';
            layer.style.top = '0px';
          }
          layer.style.width = String((container as HTMLElement).clientWidth - padL - padR) + 'px';
          layer.style.height = String((container as HTMLElement).clientHeight - padT - padB) + 'px';
          layer.style.pointerEvents = 'none';

          // Inside each layer, fix wrapper height to the image natural ratio and avoid stretching
          const imgs = Array.from(layer.querySelectorAll('img')) as HTMLImageElement[];
          imgs.forEach((img) => {
            const wrap = img.parentElement as HTMLElement | null;
            if (!wrap) return;
            const nw = img.naturalWidth || 0;
            const nh = img.naturalHeight || 0;
            if (nw > 0 && nh > 0) {
              const ratio = nw / nh;
              const wrapW = wrap.clientWidth || 0;
              if (wrapW > 0) {
                const wrapH = Math.round(wrapW / ratio);
                wrap.style.height = wrapH + 'px';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
              }
            } else {
              // Fallback: keep contain to avoid stretch even without ratio
              img.style.objectFit = 'contain';
            }
          });
        });
      } catch {}
    } catch (e) {
      console.warn("onclone sanitizer failed", e);
    }
  };
}

// Pick the most relevant editable container inside a page host.
// Preference order: element with class ".export-paginate"; otherwise, the largest contentEditable.
function findBestEditable(host: HTMLElement, rootDoc: Document = document): HTMLElement | null {
  try {
    const prefer = host.querySelector('.export-paginate') as HTMLElement | null;
    if (prefer) return prefer;
    const editors = Array.from(host.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
    if (!editors.length) return null;
    let best: HTMLElement = editors[0];
    let bestArea = best.clientWidth * best.clientHeight;
    for (let i = 1; i < editors.length; i++) {
      const el = editors[i];
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best;
  } catch {
    return null;
  }
}

// Realign all floating image layers to their editable containers
function realignFloatLayersInDOM() {
  try {
    const layers = document.querySelectorAll('[data-ms-float-layer="1"]');
    layers.forEach((node) => {
      const layer = node as HTMLDivElement;
      const host = layer.parentElement as HTMLElement | null;
      if (!host) return;
      const container = findBestEditable(host, document);
      if (!container) return;
      const cr = container.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      const cs = window.getComputedStyle(container as HTMLElement);
      const padL = parseFloat(cs.paddingLeft || '0') || 0;
      const padT = parseFloat(cs.paddingTop || '0') || 0;
      const padR = parseFloat(cs.paddingRight || '0') || 0;
      const padB = parseFloat(cs.paddingBottom || '0') || 0;
      layer.style.position = 'absolute';
      layer.style.left = (cr.left - hr.left + padL) + 'px';
      layer.style.top = (cr.top - hr.top + padT) + 'px';
      layer.style.width = (container.clientWidth - padL - padR) + 'px';
      layer.style.height = (container.clientHeight - padT - padB) + 'px';
      layer.style.pointerEvents = 'none';
    });
  } catch {}
}


export async function exportBookToPDF(filename = "memosphere_book.pdf") {
 patchColorParser();
  realignFloatLayersInDOM();

  const pages = Array.from(document.querySelectorAll<HTMLElement>(".book-page"));
  if (!pages.length) {
    alert("Aucune page détectée pour l’export PDF.");
    return;
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const scale = 2;
  const savedCoverBg = localStorage.getItem("draft:final:coverBg") || "#9DC8A5";
  const savedCoverBgImage = localStorage.getItem("draft:final:coverBgImage");
  const coverIsImage = !!savedCoverBgImage;

  const coverDiv = document.getElementById("pdf-cover-for-export");
  let firstPageUsed = false;

  if (coverDiv) {
    // Capture de la couverture: couleurs de texte héritées via onclone
  const coverCanvas = await html2canvas(coverDiv as HTMLElement, {
    scale: 2,
    useCORS: true,
    backgroundColor: savedCoverBg,
    scrollY: 0,
    onclone: buildOncloneSanitizer({
      background: savedCoverBg,
      coverTextColor:
        (localStorage.getItem("draft:final:coverTextColor") as string | null) || undefined,
    }),
  });

    const imgData = coverCanvas.toDataURL("image/png");
    const canvasW = coverCanvas.width;
    const canvasH = coverCanvas.height;
    const ratio = Math.min(pdfW / canvasW, pdfH / canvasH);
    const renderW = canvasW * ratio;
    const renderH = canvasH * ratio;
    const x = (pdfW - renderW) / 2;
    const y = (pdfH - renderH) / 2;

    pdf.addImage(imgData, "PNG", x, y, renderW, renderH);
    firstPageUsed = true;
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const SAFE_ATTR = "data-html2canvas-safe-root";

    // clone pour ne pas modifier le DOM d’origine
    const clone = page.cloneNode(true) as HTMLElement;
    clone.setAttribute(SAFE_ATTR, "1");
    const isCover = clone.querySelector('[data-keep-bg="1"]') !== null;

    // Si une couverture export dédiée existe, éviter de re-capturer la page de couverture
    if (isCover && coverDiv) {
      continue;
    }
    if (isCover) {
      // Ne pas casser les positions absolues existantes; on insère un fond sous-jacent
      clone.style.backgroundColor = "transparent";
      clone.style.position = clone.style.position || "relative";

      const bgDiv = document.createElement("div");
      bgDiv.style.position = "absolute";
      bgDiv.style.top = "0";
      bgDiv.style.left = "0";
      bgDiv.style.right = "0";
      bgDiv.style.bottom = "0";
      bgDiv.style.background = savedCoverBg;
      bgDiv.style.zIndex = "0";
      bgDiv.style.pointerEvents = "none";
      clone.insertBefore(bgDiv, clone.firstChild);
    }

    // Fige la taille et isole le clone pour une capture stable
    const { width: pageW, height: pageH } = page.getBoundingClientRect();
    clone.style.width = `${pageW}px`;
    clone.style.height = `${pageH}px`;
    clone.style.maxWidth = "none";
    clone.style.maxHeight = "none";
    clone.style.transform = "none";
    clone.style.position = "fixed";
    clone.style.left = "-10000px";
    clone.style.top = "0";

    clone.classList.add("html2canvas-safe");
    document.body.appendChild(clone);

  let __handled = false;
  const __area = clone.querySelector<HTMLElement>('.export-paginate');
  if (__area) {
    const __rect = __area.getBoundingClientRect();
    // Slightly reduce slice height to avoid showing a partial last line
    const __sliceH = Math.max(10, Math.floor(__rect.height) - 6);
    __area.style.overflow = 'hidden';
    __area.style.maxHeight = `${__sliceH}px`;
    __area.style.height = `${__sliceH}px`;
    __area.style.position = 'relative';

    const __inner = document.createElement('div');
    while (__area.firstChild) __inner.appendChild(__area.firstChild);
    __inner.style.willChange = 'transform';
    __area.appendChild(__inner);

    __inner.style.transform = 'translateY(0)';
    const __total = __inner.getBoundingClientRect().height;

    // Improved slicing: snap to paragraph-level blocks when possible
    // Prefer a `.prose` container (our editors wrap paragraphs inside it)
    let __container: HTMLElement = __inner as HTMLElement;
    const __prose = __inner.querySelector('.prose') as HTMLElement | null;
    if (__prose && __prose.children && __prose.children.length > 0) {
      __container = __prose;
    } else if (__inner.children.length === 1 && __inner.children[0] instanceof HTMLElement) {
      __container = __inner.children[0] as HTMLElement;
    }
    const __blocks = Array.from(__container.children) as HTMLElement[];

    if (__blocks.length > 0) {
      // Add a tiny bottom mask to hide any possible fractional row at the bottom edge
      const __mask = document.createElement('div');
      __mask.style.position = 'absolute';
      __mask.style.left = '0';
      __mask.style.right = '0';
      __mask.style.bottom = '0';
      __mask.style.height = '6px';
      __mask.style.background = isCover ? savedCoverBg : '#fdfaf6';
      __mask.style.pointerEvents = 'none';
      __area.appendChild(__mask);
      let __start = 0;
      let __pageIndex = 0;
      let __safety = 0;
      while (__start < __total - 1 && __safety++ < 200) {
        // choose last block fully visible within [__start, __start + __sliceH]
        const __windowBottom = __start + __sliceH - 10; // extra safety to avoid half-lines due to rounding
        const __baseOffset = (__container as HTMLElement).offsetTop || 0;
        let __lastFitIndex = -1;
        for (let i = 0; i < __blocks.length; i++) {
          const b = __blocks[i];
          const top = __baseOffset + (b as HTMLElement).offsetTop;
          const bottom = top + (b as HTMLElement).offsetHeight;
          if (bottom <= __windowBottom && bottom > __start + 1) {
            __lastFitIndex = i;
          }
        }

        // Small top overlap from the previous slice (masked at previous bottom)
        const __overlap = 6;
        const __shift = Math.max(0, Math.floor(__start - (__pageIndex > 0 ? __overlap : 0)));
        __inner.style.transform = `translateY(-${__shift}px)`;
        // Apply same transform to floating layers in this clone
        try {
          const __layers = Array.from(clone.querySelectorAll('[data-ms-float-layer="1"]')) as HTMLDivElement[];
          __layers.forEach((l) => { (l.style as any).transform = __inner.style.transform; });
        } catch {}

        const canvas = await html2canvas(clone, {
          scale,
          useCORS: true,
          scrollY: 0,
          backgroundColor: isCover ? savedCoverBg : "#fdfaf6",
          logging: false,
          width: Math.round(pageW),
          height: Math.round(pageH),
          windowWidth: Math.max(document.documentElement.clientWidth || 0, Math.round(pageW)),
          windowHeight: Math.max(document.documentElement.clientHeight || 0, Math.round(pageH)),
          onclone: buildOncloneSanitizer({ background: isCover ? savedCoverBg : "#fdfaf6" }),
        });

        const imgData = canvas.toDataURL("image/png");
        const canvasW = canvas.width;
        const canvasH = canvas.height;

        if (firstPageUsed) {
          pdf.addPage();
        } else {
          firstPageUsed = true;
        }

        const ratio = Math.min(pdfW / canvasW, pdfH / canvasH);
        const renderW = canvasW * ratio;
        const renderH = canvasH * ratio;
        const x = (pdfW - renderW) / 2;
        const y = (pdfH - renderH) / 2;
        pdf.addImage(imgData, "PNG", x, y, renderW, renderH);

        if (__lastFitIndex >= 0) {
          const last = __blocks[__lastFitIndex] as HTMLElement;
          const lastBottom = __baseOffset + last.offsetTop + last.offsetHeight;
          __start = lastBottom; // next slice starts after this block (including header before container)
        } else {
          // fallback: advance by viewport height to avoid infinite loop (block taller than slice)
          __start += __sliceH;
        }
        __pageIndex++;
      }
    } else {
      // Fallback to original equal slices when no block-level children detected
      const __slices = Math.max(1, Math.ceil(__total / __sliceH));
      for (let __s = 0; __s < __slices; __s++) {
        __inner.style.transform = `translateY(-${__s * __sliceH}px)`;
        // Apply same transform to floating layers in this clone
        try {
          const __layers = Array.from(clone.querySelectorAll('[data-ms-float-layer="1"]')) as HTMLDivElement[];
          __layers.forEach((l) => { (l.style as any).transform = __inner.style.transform; });
        } catch {}

        const canvas = await html2canvas(clone, {
          scale,
          useCORS: true,
          scrollY: 0,
          backgroundColor: isCover ? savedCoverBg : "#fdfaf6",
          logging: false,
          width: Math.round(pageW),
          height: Math.round(pageH),
          windowWidth: Math.max(document.documentElement.clientWidth || 0, Math.round(pageW)),
          windowHeight: Math.max(document.documentElement.clientHeight || 0, Math.round(pageH)),
          onclone: buildOncloneSanitizer({ background: isCover ? savedCoverBg : "#fdfaf6" }),
        });

        const imgData = canvas.toDataURL("image/png");
        const canvasW = canvas.width;
        const canvasH = canvas.height;

        if (firstPageUsed) {
          pdf.addPage();
        } else {
          firstPageUsed = true;
        }

        const ratio = Math.min(pdfW / canvasW, pdfH / canvasH);
        const renderW = canvasW * ratio;
        const renderH = canvasH * ratio;
        const x = (pdfW - renderW) / 2;
        const y = (pdfH - renderH) / 2;
        pdf.addImage(imgData, "PNG", x, y, renderW, renderH);
      }
    }

    document.body.removeChild(clone);
    __handled = true;
  }

  if (!__handled) {
  const canvas = await html2canvas(clone, {
    scale,
    useCORS: true,
    scrollY: 0,
    backgroundColor: isCover ? savedCoverBg : "#fdfaf6",
    logging: false,
    width: Math.round(pageW),
    height: Math.round(pageH),
    windowWidth: Math.max(document.documentElement.clientWidth || 0, Math.round(pageW)),
    windowHeight: Math.max(document.documentElement.clientHeight || 0, Math.round(pageH)),
    onclone: buildOncloneSanitizer({ background: isCover ? savedCoverBg : "#fdfaf6" }),
  });

    // Nettoyage du clone après capture
    document.body.removeChild(clone);

    const imgData = canvas.toDataURL("image/png");
    const canvasW = canvas.width;
    const canvasH = canvas.height;

    // Si la première page du PDF est déjà utilisée (couverture), ajouter une nouvelle page
    if (firstPageUsed) {
      pdf.addPage();
    } else {
      firstPageUsed = true;
    }

    // Centre l'image dans la page PDF en conservant le ratio
    const ratio = Math.min(pdfW / canvasW, pdfH / canvasH);
    const renderW = canvasW * ratio;
    const renderH = canvasH * ratio;
    const x = (pdfW - renderW) / 2;
    const y = (pdfH - renderH) / 2;
    pdf.addImage(imgData, "PNG", x, y, renderW, renderH);
  }
  }

  pdf.save(filename);
}
