// src/app/blocks/page.tsx
"use client";

import Link from "next/link";
import { useBlocks } from "@/hooks/useBlocks";

export default function BlocksPage() {
  const { loading, blocks, clearAll, importBlocks } = useBlocks();

  if (loading || !blocks) return <div className="p-6">Chargement…</div>;

  const items = Object.values(blocks);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(blocks, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memosphere.blocks.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await importBlocks(data); // 🔒 persiste dans IndexedDB
      alert("Import réussi !");
    } catch {
      alert("Erreur de lecture du fichier.");
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Blocs biographiques</h1>
        <div className="flex items-center gap-2">
          {/* Import JSON */}
          <label className="px-3 py-2 text-sm border rounded hover:bg-gray-50 cursor-pointer">
            Importer
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const input = e.currentTarget; // on garde la ref
                const file = input.files?.[0];
                if (!file) return;
                try {
                  await handleImportFile(file);
                } finally {
                  // reset même si erreur → permet de réimporter le même fichier
                  input.value = "";
                }
              }}
            />
          </label>

          {/* Export JSON */}
          <button
            className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
            onClick={handleExport}
            title="Exporter les blocs en JSON"
          >
            Exporter
          </button>

          {/* Reset blocs */}
          <button
            className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
            onClick={() => {
              if (
                window.confirm("Voulez-vous vraiment réinitialiser tous les blocs ?")
              ) {
                clearAll();
              }
            }}
            title="Réinitialiser les blocs (local)"
          >
            Réinitialiser
          </button>

          {/* Lien Interview */}
          <Link
            href="/interview"
            className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
          >
            🎤 Interview
          </Link>
        </div>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((b) => (
          <li key={b.id} className="border rounded-xl p-4 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-medium">{b.title}</h2>
              <span className="text-xs text-gray-500">{b.progress}%</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {b.entries.length} entrée(s)
            </p>
            <Link
              href={`/blocks/${b.id}`}
              className="inline-block text-sm px-3 py-1 border rounded hover:bg-gray-50"
            >
              Ouvrir
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
