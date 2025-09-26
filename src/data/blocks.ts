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
  /** Mémoire narrative cumulée (toutes les réponses reformulées concaténées) */
  content?: string;
  summary?: string | null;        // rempli plus tard par IA
  pinnedQuestions?: string[];     // questions fixes pour le proto (optionnel)
};

export type BlocksState = Record<string, Block>;

export const DEFAULT_BLOCKS: BlocksState = {
  identite: {
    id: "identite",
    title: "Identité",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Ton nom complet ?",
      "Où et quand es-tu né·e ?",
      "Qui formait ta famille proche ?",
    ],
  },
  enfance: {
    id: "enfance",
    title: "Enfance",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Décris la maison/l’endroit de ton enfance.",
      "Un souvenir marquant d’enfance ?",
      "Une personne clé et une anecdote avec elle ?",
    ],
  },
  adolescence: {
    id: "adolescence",
    title: "Adolescence",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Une passion ou activité qui te prenait tout le temps ?",
      "Un moment charnière au collège/lycée ?",
      "Un ami important, une histoire ?",
    ],
  },
  debuts_adultes: {
    id: "debuts_adultes",
    title: "Débuts adultes",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Études ou premier boulot : comment ça a commencé ?",
      "Un choix qui a orienté ta vie ?",
      "Une première fois importante (ville, appart, voyage…) ?",
    ],
  },
  metier: {
    id: "metier",
    title: "Métier / vocation",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Ton métier/vocation : d’où vient le déclic ?",
      "Une fierté et une épreuve qui t’ont marqué ?",
      "Qu’est-ce que tu aimes transmettre ?",
    ],
  },
  valeurs: {
    id: "valeurs",
    title: "Valeurs & croyances",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Ce qui compte pour toi aujourd’hui ?",
      "Une valeur héritée (ou rejetée) de ta famille ?",
      "Une leçon tirée d’une épreuve ?",
    ],
  },
  anecdotes: {
    id: "anecdotes",
    title: "Anecdotes",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Une histoire courte, drôle ou marquante ?",
      "Un raté devenu bon souvenir ?",
      "Un moment improbable / inattendu ?",
    ],
  },
  lieux: {
    id: "lieux",
    title: "Lieux marquants",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Un lieu qui te revient souvent en tête (décris-le) ?",
      "Un voyage transformant ?",
      "Un endroit où tu aimerais retourner, pourquoi ?",
    ],
  },
  heritage: {
    id: "heritage",
    title: "Héritage / message",
    progress: 0,
    entries: [],
    content: "",
    pinnedQuestions: [
      "Un message pour tes proches ?",
      "Ce que tu aimerais laisser / transmettre ?",
      "Un conseil à toi-même plus jeune ?",
    ],
  },
};
