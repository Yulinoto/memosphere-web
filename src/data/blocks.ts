// src/data/blocks.ts
export type Entry =
  | { type: "texte"; q: string; a: string; ts: number }
  | { type: "audio"; q: string; a: string; ts: number; audioUrl?: string }
  | { type: "photo"; caption?: string; url: string; ts: number };

export type Block = {
  id: string;                     // ex: "identite"
  title: string;                  // ex: "Identité"
  progress: number;               // 0..100 (approx)
  entries: Entry[];
  summary?: string | null;        // rempli plus tard par IA
  pinnedQuestions?: string[];     // questions fixes pour le proto (optionnel)

  // ⬇️ NOUVEAU: texte narratif cumulé (réponses reformulées ajoutées à la suite)
  content?: string;
};

export type BlocksState = Record<string, Block>;

export const DEFAULT_BLOCKS: BlocksState = {
  identite: {
    id: "identite",
    title: "Identité",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Ton nom complet ?",
      "Où et quand es-tu né·e ?",
      "Qui formait ta famille proche ?",
    ],
    content: "", // ⬅️ facultatif mais propre
  },
  enfance: {
    id: "enfance",
    title: "Enfance",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Décris la maison/l’endroit de ton enfance.",
      "Un souvenir marquant d’enfance ?",
      "Une personne clé et une anecdote avec elle ?",
    ],
    content: "",
  },
  adolescence: {
    id: "adolescence",
    title: "Adolescence",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Une passion ou activité qui te prenait tout le temps ?",
      "Un moment charnière au collège/lycée ?",
      "Un ami important, une histoire ?",
    ],
    content: "",
  },
  debuts_adultes: {
    id: "debuts_adultes",
    title: "Débuts adultes",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Études ou premier boulot : comment ça a commencé ?",
      "Un choix qui a orienté ta vie ?",
      "Une première fois importante (ville, appart, voyage…) ?",
    ],
    content: "",
  },
  metier: {
    id: "metier",
    title: "Métier / vocation",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Ton métier/vocation : d’où vient le déclic ?",
      "Une fierté et une épreuve qui t’ont marqué ?",
      "Qu’est-ce que tu aimes transmettre ?",
    ],
    content: "",
  },
  valeurs: {
    id: "valeurs",
    title: "Valeurs & croyances",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Ce qui compte pour toi aujourd’hui ?",
      "Une valeur héritée (ou rejetée) de ta famille ?",
      "Une leçon tirée d’une épreuve ?",
    ],
    content: "",
  },
  anecdotes: {
    id: "anecdotes",
    title: "Anecdotes",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Une histoire courte, drôle ou marquante ?",
      "Un raté devenu bon souvenir ?",
      "Un moment improbable / inattendu ?",
    ],
    content: "",
  },
  lieux: {
    id: "lieux",
    title: "Lieux marquants",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Un lieu qui te revient souvent en tête (décris-le) ?",
      "Un voyage transformant ?",
      "Un endroit où tu aimerais retourner, pourquoi ?",
    ],
    content: "",
  },
  heritage: {
    id: "heritage",
    title: "Héritage / message",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Un message pour tes proches ?",
      "Ce que tu aimerais laisser / transmettre ?",
      "Un conseil à toi-même plus jeune ?",
    ],
    content: "",
  },
};
