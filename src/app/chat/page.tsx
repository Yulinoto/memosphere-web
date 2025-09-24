// src/app/chat/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useBlocks } from "@/hooks/useBlocks";
import type { Entry } from "@/data/blocks";
import Link from "next/link";
import { useTTS } from "@/hooks/useTTS";

type Message = { role: "system" | "assistant" | "user"; text: string; ts: number };

export default function ChatPage() {
  const { loading, blocks, addTextEntry } = useBlocks();
  const items = useMemo(() => (blocks ? Object.values(blocks) : []), [blocks]);
  const [blockId, setBlockId] = useState<string>("");

  const block = blockId && blocks ? blocks[blockId] : null;
  const pinned = block?.pinnedQuestions ?? [];
  const [qIndex, setQIndex] = useState(0);

  const question = pinned.length
    ? pinned[qIndex % pinned.length]
    : "Raconte-moi un souvenir lié à ce thème.";

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  const { supported: ttsSupported, speak, stop } = useTTS({ lang: "fr-FR" });

  useEffect(() => {
    if (loading || !items.length) return;
    if (!blockId) setBlockId(items[0].id);
  }, [loading, items, blockId]);

  useEffect(() => {
    // Injecte la “question” comme message assistant à chaque changement
    if (!block) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.text === question) return;
    setMessages((prev) => [...prev, { role: "assistant", text: question, ts: Date.now() }]);
    try { speak(question); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, blockId]);

  if (loading || !blocks) return <div className="p-6">Chargement…</div>;

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Interview — Chat</h1>
        <Link href="/interview" className="text-sm text-gray-500 hover:underline">← Mode interview</Link>
      </header>

      <section className="flex gap-2 items-end">
        <div className="grow">
          <label className="text-sm font-medium">Bloc</label>
          <select
            className="w-full border rounded p-2 text-sm"
            value={blockId}
            onChange={(e) => setBlockId(e.target.value)}
          >
            {items.map((b) => (
              <option key={b.id} value={b.id}>{b.title}</option>
            ))}
          </select>
        </div>
        <button
          className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
          onClick={() => speak(question)}
          disabled={!ttsSupported}
          title="Relire la question"
        >
          ▶︎ Relire
        </button>
        <button
          className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
          onClick={() => stop()}
          disabled={!ttsSupported}
          title="Stop"
        >
          ■
        </button>
      </section>

      {/* Fil de conversation */}
      <section className="border rounded-xl p-3 bg-white space-y-2" style={{minHeight: 320}}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow
              ${m.role === "assistant" ? "bg-indigo-50 text-indigo-900" : "bg-gray-100 text-gray-900"}`}>
              {m.text}
            </div>
          </div>
        ))}
      </section>

      {/* Input utilisateur */}
      <section className="flex gap-2">
        <input
          className="flex-1 border rounded p-2 text-sm"
          placeholder="Écris ta réponse…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
          onClick={async () => {
            const clean = draft.trim();
            if (!clean || !block) return;
            setMessages((prev) => [...prev, { role: "user", text: clean, ts: Date.now() }]);
            await addTextEntry(block.id, question, clean);
            setDraft("");
            setQIndex((x) => x + 1);
          }}
        >
          Envoyer
        </button>
      </section>
    </main>
  );
}
