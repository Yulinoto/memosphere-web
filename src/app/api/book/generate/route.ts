import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const {
      bookTitle = "Titre du livre",
      subtitle = "",
      style = "narratif",
      styleInstructions = "",
      introHint = "",
      conclusionHint = "",
      pointOfView = "first",
      blocks = [],
      model = "gpt-4o-mini", // modèle par défaut
    } = payload;

    // 🔍 filtrer les blocs vides
    const validBlocks = Array.isArray(blocks)
      ? blocks.filter((b) => b.summary && b.summary.trim() !== "")
      : [];

    if (!validBlocks.length) {
      return NextResponse.json(
        { error: "Aucun bloc valide pour la génération du livre." },
        { status: 400 }
      );
    }

    // 🧠 prompt principal
    const prompt = `
Tu es un écrivain biographe professionnel et bienveillant.
Ta mission est de rédiger un **livre complet, structuré et fluide**, à partir de données brutes issues d'une interview.

🎯 Objectif :
Produire un texte littéraire cohérent, profond et humain. Le style doit être fidèle aux paramètres ci-dessous.

────────────────────────────
📘 PARAMÈTRES DU LIVRE
Titre : ${bookTitle}
Sous-titre : ${subtitle}
Style de rédaction : ${style}
Point de vue : ${pointOfView === "first" ? "première personne (je)" : "troisième personne (il/elle)"}
Instructions de style : ${styleInstructions || "aucune précision"}
Indications d’introduction : ${introHint || "aucune"}
Indications de conclusion : ${conclusionHint || "aucune"}
────────────────────────────

🧩 DONNÉES À UTILISER :
Tu disposes de plusieurs blocs (chapitres) ordonnés, chacun avec un résumé :
${validBlocks
  .map(
    (b, i) => `
Chapitre ${i + 1} :
ID : ${b.id}
Titre proposé : ${b.title || "(à générer selon le contenu)"}
Résumé du bloc : ${b.summary}`
  )
  .join("\n")}

────────────────────────────
✍️ INSTRUCTIONS DE RÉDACTION :
1. Ne crée pas de chapitre pour les blocs vides.
2. Respecte l’ordre exact des blocs.
3. Rédige une introduction inspirante et engageante.
4. Développe chaque chapitre avec détails, émotions, transitions naturelles et un ton ${style}.
5. Utilise le ${pointOfView === "first" ? "je" : "il/elle"} constant.
6. Conclus le livre par un message fort et humain, cohérent avec le récit.
7. Chaque chapitre doit avoir un **titre clair**, au format markdown : "# Chapitre X — Titre".
8. Structure le texte en paragraphes aérés.
9. Si une information semble trop courte, enrichis-la naturellement par la narration.
10. N’ajoute aucune note technique, ni balise, ni rappel du prompt.

────────────────────────────
💡 FORMAT DE SORTIE :
Un texte markdown complet, contenant :
- une introduction,
- les chapitres (avec titres),
- une conclusion finale.

Aucune balise JSON ni explication — uniquement le texte final.
`;

    // 🧩 Appel OpenAI
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "Tu es un biographe empathique et expérimenté, spécialisé dans la rédaction de récits de vie captivants.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 6000,
    });

    const text = response.choices[0]?.message?.content?.trim();

    if (!text) {
      return NextResponse.json(
        { error: "Aucun texte généré par le modèle." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, text });
  } catch (error: any) {
    console.error("❌ Erreur génération livre :", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne du serveur." },
      { status: 500 }
    );
  }
}
