import { NextRequest, NextResponse } from "next/server";
import { runInterviewTurn } from "@/server/llm/providers/agentsdk";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { blocks = [], style = "narratif", pointOfView = "first" } = body || {};


    // 🔍 On choisit le bloc avec le plus de texte (le plus représentatif)
    const bestBlock = blocks.sort(
      (a: any, b: any) =>
        (b.summary?.length || 0) + (b.entries?.join(" ")?.length || 0) -
        ((a.summary?.length || 0) + (a.entries?.join(" ")?.length || 0))
    )[0];

    if (!bestBlock) {
      return NextResponse.json({ text: "⚠️ Aucun contenu disponible pour générer un aperçu." });
    }

    const userContent = [
      bestBlock.summary || "",
      ...(bestBlock.entries || []),
    ]
      .join("\n\n")
      .trim();

    // 🧠 Le prompt d’aperçu
    const prompt = `
Tu es un rédacteur biographique.
Rédige un extrait représentatif du livre en adoptant le style "${style}".
Écris à la ${pointOfView === "first" ? "première" : "troisième"} personne.
Écris un seul paragraphe fluide et captivant à partir de ce contenu :
---
${userContent}
---
`.trim();

    const res: any = await (runInterviewTurn as any)(prompt, "preview-session", "preview-section", {
      depthBudget: 1,
    });

    const text = String(res?.say || "").trim();

    return NextResponse.json({
      text:
        text ||
        "⚠️ L’aperçu n’a pas pu être généré. Le contenu est peut-être trop court.",
      ok: true,
    });
  } catch (e: any) {
    console.error("Erreur /api/book/preview :", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erreur lors de la génération d’aperçu." },
      { status: 500 }
    );
  }
}
