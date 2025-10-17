"use client";
import React, { useState } from "react";

const colorOptions = ["#9DC8A5", "#6BA5C8", "#E8CBB1", "#EAD98B", "#B1A1E8", "#F6A5A5"];
function buildTextureDataUris() {
  const make = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const stripes = make(
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>
      <defs>
        <pattern id='p' patternUnits='userSpaceOnUse' width='10' height='10' patternTransform='rotate(45)'>
          <rect width='6' height='10' fill='#000000' fill-opacity='0.22'/>
        </pattern>
      </defs>
      <rect width='100%' height='100%' fill='url(#p)'/>
    </svg>`
  );
  const dots = make(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>
      <defs>
        <pattern id='d' patternUnits='userSpaceOnUse' width='12' height='12'>
          <circle cx='2' cy='2' r='1.4' fill='#000000' fill-opacity='0.22'/>
        </pattern>
      </defs>
      <rect width='100%' height='100%' fill='url(#d)'/>
    </svg>`
  );
  const grid = make(
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>
      <defs>
        <pattern id='g' width='20' height='20' patternUnits='userSpaceOnUse'>
          <path d='M20 0 L0 0 0 20' stroke='#000000' stroke-opacity='0.22' fill='none' stroke-width='1.2'/>
        </pattern>
      </defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
    </svg>`
  );
  return [stripes, dots, grid];
}
const imageOptions = buildTextureDataUris();
const textColorOptions = ["#FFFFFF", "#000000", "#222222", "#444444", "#EEEEEE", "#FFD700"];
const fontOptions = [
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Palatino", value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
];

type TextSize = "small" | "medium" | "large";

export function CoverEditor({
  initialBg,
  initialTitle,
  initialSubtitle,
  initialTitleFont = (typeof window !== 'undefined' ? (localStorage.getItem("draft:final:coverTitleFont") as string | null) : null) || "Georgia, serif",
  initialSubtitleFont = (typeof window !== 'undefined' ? (localStorage.getItem("draft:final:coverSubtitleFont") as string | null) : null) || "Georgia, serif",
  initialTitleSize = (typeof window !== 'undefined' ? (localStorage.getItem("draft:final:coverTitleSize") as TextSize | null) : null) || "medium",
  initialSubtitleSize = (typeof window !== 'undefined' ? (localStorage.getItem("draft:final:coverSubtitleSize") as TextSize | null) : null) || "medium",
  onSave,
  onCancel,
}: {
  initialBg: string;
  initialTitle: string;
  initialSubtitle: string;
  initialTitleFont?: string;
  initialSubtitleFont?: string;
  initialTitleSize?: TextSize;
  initialSubtitleSize?: TextSize;
  onSave: (
    bg: string,
    title: string,
    subtitle: string,
    textColor: string,
    titleSize: TextSize,
    subtitleSize: TextSize,
    titleFont: string,
    subtitleFont: string,
    bgImage?: string | null,
    bgScale?: number,
    fgImage?: string | null,
    fgScalePercent?: number,
    fgXPercent?: number,
    fgYPercent?: number
  ) => void;
  onCancel: () => void;
}) {
  const parseInitialBg = () => {
    try {
      const s = String(initialBg || "").trim();
      if (s.startsWith("url(")) {
        const inner = s.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
        return { bg: "#9DC8A5", bgImage: inner };
      }
      if (s.startsWith("data:")) {
        const inner = s;
        return { bg: "#9DC8A5", bgImage: inner };
      }
    } catch {}
    return { bg: initialBg, bgImage: null };
  };
  const __init = parseInitialBg();
  const [bg, setBg] = useState(__init.bg as string);
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle);
  const [bgImage, setBgImage] = useState<string | null>(__init.bgImage);
  const [textColor, setTextColor] = useState<string>(
    localStorage.getItem("draft:final:coverTextColor") || "#FFFFFF"
  );
  const [titleSize, setTitleSize] = useState<TextSize>(initialTitleSize);
  const [subtitleSize, setSubtitleSize] = useState<TextSize>(initialSubtitleSize);
  const [titleFont, setTitleFont] = useState<string>(initialTitleFont);
  const [subtitleFont, setSubtitleFont] = useState<string>(initialSubtitleFont);
  const [textureScale, setTextureScale] = useState<number>(
    Number(localStorage.getItem("draft:final:coverBgScale") || 40)
  );

  // Foreground image (logo/photo) state
  const [fgImage, setFgImage] = useState<string | null>(
    (typeof window !== 'undefined' ? localStorage.getItem("draft:final:coverFgImage") : null) || null
  );
  const [fgScale, setFgScale] = useState<number>(
    Number((typeof window !== 'undefined' ? localStorage.getItem("draft:final:coverFgScale") : null) || 40)
  );
  const [fgX, setFgX] = useState<number>(
    Number((typeof window !== 'undefined' ? localStorage.getItem("draft:final:coverFgX") : null) || 50)
  );
  const [fgY, setFgY] = useState<number>(
    Number((typeof window !== 'undefined' ? localStorage.getItem("draft:final:coverFgY") : null) || 50)
  );

  const titleSizeClass = titleSize === "large" ? "text-5xl" : titleSize === "small" ? "text-3xl" : "text-4xl";
  const subtitleSizeClass = subtitleSize === "large" ? "text-2xl" : subtitleSize === "small" ? "text-lg" : "text-xl";

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
      <div className="bg-white w-[90%] h-[90%] rounded-xl shadow-lg flex overflow-hidden">
        {/* Prévisualisation */}
        <div
          className="flex-1 relative flex flex-col items-center justify-center text-center overflow-hidden"
          style={{
            backgroundColor: bg,
            backgroundImage: bgImage ? `url(\"${bgImage}\")` : "none",
            backgroundSize: bgImage ? `${textureScale}px ${textureScale}px` : "cover",
            backgroundRepeat: bgImage ? "repeat" : "no-repeat",
            backgroundPosition: bgImage ? "top left" : "center",
            color: textColor,
          }}
        >
          {bgImage && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `url(\"${bgImage}\")`,
                backgroundRepeat: "repeat",
                backgroundSize: `${textureScale}px ${textureScale}px`,
                backgroundPosition: "top left",
                opacity: 1,
                zIndex: 0,
              }}
            />
          )}
          {fgImage && (
            <img
              src={fgImage}
              alt="cover"
              className="pointer-events-none"
              style={{
                position: 'absolute',
                left: fgX + '%',
                top: fgY + '%',
                width: fgScale + '%',
                height: 'auto',
                transform: 'translate(-50%, -50%)',
                zIndex: 2,
              }}
            />
          )}
          <div className="w-full max-w-[560px] px-6 break-words whitespace-normal">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`bg-transparent border-none ${titleSizeClass} leading-tight font-bold text-center outline-none drop-shadow-lg w-full`}
              style={{ color: textColor, fontFamily: titleFont }}
            />
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className={`bg-transparent border-none ${subtitleSizeClass} leading-snug italic mt-4 text-center outline-none drop-shadow w-full`}
              style={{ color: textColor, fontFamily: subtitleFont }}
            />
          </div>

          {/* Boutons flottants */}
          <div className="absolute bottom-8 flex gap-4">
            <button
              onClick={() => onCancel()}
              className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-800"
            >
              Annuler
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.setItem("draft:final:coverTextColor", textColor);
                  localStorage.setItem("draft:final:coverTitleSize", titleSize);
                  localStorage.setItem("draft:final:coverSubtitleSize", subtitleSize);
                  localStorage.setItem("draft:final:coverTitleFont", titleFont);
                  localStorage.setItem("draft:final:coverSubtitleFont", subtitleFont);
                  localStorage.setItem("draft:final:coverBg", bg);
                  localStorage.setItem("draft:final:coverBgScale", String(textureScale));
                  if (bgImage) {
                    localStorage.setItem("draft:final:coverBgImage", bgImage);
                  } else {
                    localStorage.removeItem("draft:final:coverBgImage");
                  }
                  if (fgImage) {
                    localStorage.setItem("draft:final:coverFgImage", fgImage);
                    localStorage.setItem("draft:final:coverFgScale", String(fgScale));
                    localStorage.setItem("draft:final:coverFgX", String(fgX));
                    localStorage.setItem("draft:final:coverFgY", String(fgY));
                  } else {
                    localStorage.removeItem("draft:final:coverFgImage");
                    localStorage.removeItem("draft:final:coverFgScale");
                    localStorage.removeItem("draft:final:coverFgX");
                    localStorage.removeItem("draft:final:coverFgY");
                  }
                } catch {}
                onSave(
                  bg,
                  title,
                  subtitle,
                  textColor,
                  titleSize,
                  subtitleSize,
                  titleFont,
                  subtitleFont,
                  bgImage || null,
                  textureScale,
                  fgImage || null,
                  fgScale,
                  fgX,
                  fgY
                );
              }}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
            >
              Sauvegarder
            </button>
          </div>
        </div>

        {/* Outils à droite */}
        <div className="w-[280px] p-4 border-l border-gray-200 flex flex-col gap-4 bg-gray-50 overflow-auto relative z-10">
          <h3 className="font-semibold text-gray-700">Couleur de fond</h3>
          <div className="grid grid-cols-3 gap-2">
            {colorOptions.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setBg(c);
                  setBgImage(null);
                }}
                className="w-10 h-10 rounded border"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <h3 className="font-semibold text-gray-700 mt-6">Image de couverture</h3>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const r = new FileReader();
                r.onload = () => setFgImage(String(r.result || ''));
                r.readAsDataURL(file);
              }}
            />
            {fgImage && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-100"
                onClick={() => setFgImage(null)}
              >
                Retirer
              </button>
            )}
          </div>
          {fgImage && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Taille (%)</label>
                <input type="range" min={10} max={100} step={1} value={fgScale} onChange={(e)=>setFgScale(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500">{fgScale}%</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position X (%)</label>
                <input type="range" min={0} max={100} step={1} value={fgX} onChange={(e)=>setFgX(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500">{fgX}%</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position Y (%)</label>
                <input type="range" min={0} max={100} step={1} value={fgY} onChange={(e)=>setFgY(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500">{fgY}%</div>
              </div>
            </div>
          )}

          <h3 className="font-semibold text-gray-700 mt-4">Image de fond</h3>
          <div className="grid grid-cols-2 gap-2">
            {imageOptions.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setBgImage((prev) => (prev === src ? null : src))}
                className={`w-24 h-24 rounded overflow-hidden border ${bgImage === src ? "ring-2 ring-blue-400" : ""}`}
                style={{ backgroundColor: bg }}
                aria-pressed={bgImage === src}
                title={bgImage === src ? "Retirer la texture" : "Appliquer la texture"}
              >
                <img src={src} alt="texture" className="object-cover w-full h-full" />
              </button>
            ))}
          </div>
          {bgImage && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Échelle de la texture</label>
              <input
                type="range"
                min={12}
                max={160}
                step={4}
                value={textureScale}
                onChange={(e) => setTextureScale(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500">Taille du motif: {textureScale}px</div>
            </div>
          )}

          <h3 className="font-semibold text-gray-700 mt-4">Couleur du texte</h3>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {textColorOptions.map((c) => (
              <button
                key={c}
                onClick={() => setTextColor(c)}
                className={`w-10 h-10 rounded border ${textColor === c ? "ring-2 ring-blue-400" : ""}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <input
            type="color"
            value={textColor}
            onChange={(e) => setTextColor(e.target.value)}
            className="w-full h-10 border rounded"
          />

          <h3 className="font-semibold text-gray-700 mt-4">Taille du titre</h3>
          <div className="grid grid-cols-3 gap-2">
            {(["small","medium","large"] as TextSize[]).map((s) => (
              <button
                key={s}
                onClick={() => setTitleSize(s)}
                className={`px-2 py-1 rounded border text-sm ${titleSize === s ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-100"}`}
              >
                {s === "small" ? "Petit" : s === "large" ? "Grand" : "Moyen"}
              </button>
            ))}
          </div>

          <h3 className="font-semibold text-gray-700 mt-4">Taille du sous-titre</h3>
          <div className="grid grid-cols-3 gap-2">
            {(["small","medium","large"] as TextSize[]).map((s) => (
              <button
                key={s}
                onClick={() => setSubtitleSize(s)}
                className={`px-2 py-1 rounded border text-sm ${subtitleSize === s ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-100"}`}
              >
                {s === "small" ? "Petit" : s === "large" ? "Grand" : "Moyen"}
              </button>
            ))}
          </div>

          <h3 className="font-semibold text-gray-700 mt-4">Police du titre</h3>
          <select
            className="w-full h-10 border rounded bg-white"
            value={titleFont}
            onChange={(e) => setTitleFont(e.target.value)}
          >
            {fontOptions.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>

          <h3 className="font-semibold text-gray-700 mt-4">Police du sous-titre</h3>
          <select
            className="w-full h-10 border rounded bg-white"
            value={subtitleFont}
            onChange={(e) => setSubtitleFont(e.target.value)}
          >
            {fontOptions.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>

        </div>
      </div>
    </div>
  );
}
