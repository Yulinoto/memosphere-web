// src/data/blocks.ts
export type Entry =
  | { type: "texte"; q: string; a: string; ts: number }
  | { type: "audio"; q: string; a: string; ts: number; audioUrl?: string }
  | { type: "photo"; caption?: string; url: string; ts: number };

export type SlotStatus = "present" | "partial" | "missing" | "conflict";

export type ChecklistEntry = {
  status: SlotStatus;
  confidence: number;           // 0..1
  evidenceEntryIdx?: number[];  // indices d'entries liées (optionnel)
  lastUpdated?: number;
  manualOverride?: SlotStatus;  // si l’utilisateur force
  notes?: string;
};

export type Block = {
  id: string;                     // ex: "identite"
  title: string;                  // ex: "Identité"
  progress: number;               // 0..100 (calculé depuis checklist sinon heuristique)
  entries: Entry[];
  summary?: string | null;        // résumé IA éditable
  content?: string;               // récit brut (mémoire)
  pinnedQuestions?: string[];     // questions fixes (interview guidée)
  checklist?: Record<string, ChecklistEntry>; // contrôleur de complétude
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
      "Qui formait ta famille proche ?"
    ]
  },
  enfance: {
    id: "enfance",
    title: "Enfance",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Décris la maison/l’endroit de ton enfance.",
      "Un souvenir marquant d’enfance ?",
      "Une personne clé et une anecdote avec elle ?"
    ]
  },
  adolescence: {
    id: "adolescence",
    title: "Adolescence",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Une passion ou activité qui te prenait tout le temps ?",
      "Un moment charnière au collège/lycée ?",
      "Un ami important, une histoire ?"
    ]
  },
  debuts_adultes: {
    id: "debuts_adultes",
    title: "Débuts adultes",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Études ou premier boulot : comment ça a commencé ?",
      "Un choix qui a orienté ta vie ?",
      "Une première fois importante (ville, appart, voyage…) ?"
    ]
  },
  metier: {
    id: "metier",
    title: "Métier / vocation",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Ton métier/vocation : d’où vient le déclic ?",
      "Une fierté et une épreuve qui t’ont marqué ?",
      "Qu’est-ce que tu aimes transmettre ?"
    ]
  },
  valeurs: {
    id: "valeurs",
    title: "Valeurs & croyances",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Ce qui compte pour toi aujourd’hui ?",
      "Une valeur héritée (ou rejetée) de ta famille ?",
      "Une leçon tirée d’une épreuve ?"
    ]
  },
  anecdotes: {
    id: "anecdotes",
    title: "Anecdotes",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Une histoire courte, drôle ou marquante ?",
      "Un raté devenu bon souvenir ?",
      "Un moment improbable / inattendu ?"
    ]
  },
  lieux: {
    id: "lieux",
    title: "Lieux marquants",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Un lieu qui te revient souvent en tête (décris-le) ?",
      "Un voyage transformant ?",
      "Un endroit où tu aimerais retourner, pourquoi ?"
    ]
  },
  heritage: {
    id: "heritage",
    title: "Héritage / message",
    progress: 0,
    entries: [],
    pinnedQuestions: [
      "Un message pour tes proches ?",
      "Ce que tu aimerais laisser / transmettre ?",
      "Un conseil à toi-même plus jeune ?"
    ]
  }
};
