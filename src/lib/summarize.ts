import type { Block, Entry } from "@/data/blocks";

export async function summarizeBlockLLM(block: Block): Promise<string> {
  const entries = (block.entries || [])
    .filter((e): e is Extract<Entry, { type: "texte" } | { type: "audio" }> => "q" in e && "a" in e)
    .map(e => ({ q: (e as any).q, a: (e as any).a, ts: (e as any).ts }));

  const res = await fetch("/api/llm/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blockId: block.id,
      title: block.title,
      content: block.content || "",
      entries
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} — ${txt.slice(0, 200)}`);
  }

  const json = await res.json().catch(() => ({}));
  if (!json?.ok || !json?.summary) {
    throw new Error("Réponse LLM invalide");
  }
  return String(json.summary);
}
