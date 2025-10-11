import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * ROUTE : /api/book/generate
 * Construit un texte biographique complet à partir des données brutes (entries + resolved),
 * pas à partir des résumés.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { blocks = [], style = "narratif", pointOfView = "first" } = body || {};

    if (!blocks || typeof blocks !== "object") {
      return NextResponse.json({ error: "Missing or invalid 'blocks' object" }, { status: 400 });
    }

    // 🧱 Étape 1 — Préparer la matière brute de chaque bloc
    const chapters = Object.values(blocks)
      .map((b: any) => {
        const title = b?.title || "Chapitre sans titre";

        // 🧩 Données structurées ("faits" canoniques)
        const facts =
          b?.resolved && typeof b.resolved === "object"
            ? Object.entries(b.resolved)
                .map(([k, v]: any) => `${k}: ${(v?.value ?? "").toString().trim()}`)
                .join("\n")
            : "Aucun fait spécifique enregistré.";

        // 💬 Entrées brutes (issues des réponses d’interview)
        const memories =
          b?.entries && Array.isArray(b.entries)
            ? b.entries
                .filter((e: any) => !!(e?.a || e?.q))
                .map((e: any) => `${e.q ? e.q + " — " : ""}${e.a}`)
                .join("\n")
            : "Aucun souvenir renseigné.";

        return `
### ${title}

Faits connus :
${facts}

Souvenirs racontés :
${memories}
`;
      })
      .join("\n\n");

    // 🧠 Étape 2 — Construire le prompt de génération
    const styleText =
      style === "poetique"
        ? "avec une plume poétique, sensorielle et émotionnelle."
        : style === "journalistique"
        ? "avec une narration claire, factuelle et fluide."
        : "avec un ton naturel, sincère et humain.";

    const povInstruction =
      pointOfView === "first"
        ? "Rédige à la première personne (utilise 'je')."
        : "Rédige à la troisième personne (utilise 'il' ou 'elle').";

    const prompt = `
Tu es un écrivain biographique professionnel.
Tu reçois les souvenirs bruts et les faits réels d'une personne.
N’invente rien qui ne soit pas présent dans les données.
Raconte ces éléments comme une histoire de vie fluide et cohérente.
Structure ton texte en chapitres clairs avec titres.
Rédige ${styleText}
${povInstruction}

Voici les données à partir desquelles écrire :
${chapters}
`.trim();

    // 🪄 Étape 3 — Appel au modèle
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Tu es un écrivain biographique professionnel et sensible.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    const json = await res.json();
    const bookText =
      json?.choices?.[0]?.message?.content?.trim() || "Erreur : aucune réponse générée.";

    // 🧾 Étape 4 — Réponse structurée
    return NextResponse.json({
      ok: true,
      text: bookText,
      style,
      pointOfView,
      tokenUsage: json?.usage ?? null,
    });
  } catch (e: any) {
    console.error("BOOK GENERATION ERROR:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erreur interne" },
      { status: 500 }
    );
  }
}
