'use client';

import React from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export default function TestCoverExport() {
  const exportCover = async () => {
    const node = document.getElementById("test-cover");
    if (!node) return;

    const canvas = await html2canvas(node, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#9DC8A5",
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
    const imgData = canvas.toDataURL("image/png");

    const pdfW = pdf.internal.pageSize.getWidth();
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const targetH = (canvasH * pdfW) / canvasW;

    pdf.addImage(imgData, "PNG", 0, 0, pdfW, targetH);
    pdf.save("test-cover.pdf");
  };

  return (
    <div className="p-8 space-y-4">
      <button
        onClick={exportCover}
        className="px-4 py-2 border rounded bg-blue-500 text-white"
      >
        Exporter la couverture
      </button>

      {/* ✅ Zone de test */}
      <div
        id="test-cover"
        style={{
          width: "720px",
          height: "1020px",
          backgroundColor: "#9DC8A5",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Georgia, serif",
          color: "white",
          fontSize: "32px",
          border: "2px dashed white",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "42px", textAlign: "center", padding: "0 40px" }}>
          Titre du livre
        </div>
        <div style={{ marginTop: "20px", fontStyle: "italic", textAlign: "center", padding: "0 40px" }}>
          Sous-titre
        </div>
        <div style={{ position: "absolute", bottom: "40px", fontSize: "14px" }}>
          MEMOSPHERE BOOK
        </div>
      </div>
    </div>
  );
}
