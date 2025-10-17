"use client";
import React, { useEffect, useRef } from "react";

export default function SimplePageEditor({
  id,
  initialHtml,
  onChange,
  maxHeight = 780,
}: {
  id: string;
  initialHtml?: string;
  onChange: (html: string) => void;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    // n'écrase pas le focus si l'utilisateur édite
    if (document.activeElement !== ref.current) {
      ref.current.innerHTML = initialHtml ?? "<p></p>";
    }
  }, [initialHtml]);

  // Petite fonction utilitaire: supprime le dernier caractère/élément si on dépasse
  function rollbackLastInput(el: HTMLDivElement) {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        // Efface la sélection active (best-effort)
        sel.getRangeAt(0).deleteContents();
      } else {
        // fallback: supprime le dernier noeud textuel s'il existe
        const last = el.lastChild;
        if (last) {
          if (last.nodeType === Node.TEXT_NODE) {
            const text = last.textContent ?? "";
            last.textContent = text.slice(0, Math.max(0, text.length - 1));
          } else {
            el.removeChild(last);
          }
        }
      }
    } catch (e) {
      // noop
    }
  }

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;

    // Si le contenu dépasse visuellement la hauteur, on annule la dernière insertion
    if (el.scrollHeight > maxHeight) {
      rollbackLastInput(el);
      // remets le scroll à la fin utile
      el.scrollTop = el.scrollHeight;
      // renvoie l'état actuel (après rollback)
      onChange(el.innerHTML);
      return;
    }

    // sinon on envoie le HTML normal
    onChange(el.innerHTML);
  };

  // Empêche certaines combinaisons qui insèrent de l'HTML non textuel (pâte riche)
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  return (
    <div
      id={id}
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onPaste={handlePaste}
      className="outline-none"
      style={{
        height: `${maxHeight}px`,
        overflowY: "auto",
        boxSizing: "border-box",
        padding: 0,
        whiteSpace: "pre-wrap",
      }}
    />
  );
}
