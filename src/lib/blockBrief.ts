// src/lib/blockBrief.ts
export type BlockBrief = {
  goal: string;          // objectif de collecte
  mustHave: string[];    // infos à couvrir si présentes
  style: string;         // ton et forme
};

export const BLOCK_BRIEFS: Record<string, BlockBrief> = {
  identite: {
    goal: "Présenter l'identité de la personne en quelques paragraphes clairs.",
    mustHave: [
      "nom et prénom", "surnoms éventuels",
      "date et lieu de naissance",
      "contexte familial à la naissance (parents, fratrie, origine)"
    ],
    style: "récit court, à la première personne si les réponses sont à la 1re, sinon à la 3e; ton chaleureux, simple; phrases courtes."
  },
  enfance: {
    goal: "Raconter l'ambiance de l'enfance et les souvenirs marquants.",
    mustHave: [
      "maison ou environnement d'enfance", "école primaire / maîtres",
      "amis proches et jeux", "souvenirs marquants", "relation aux parents / fratrie si mentionnée"
    ],
    style: "récit sensoriel, concret; éviter listes sèches; transitions douces."
  },
  adolescence: {
    goal: "Tracer les lignes de l'adolescence et des bascules.",
    mustHave: [
      "passions/activités dominantes", "moments charnières collège/lycée",
      "amitiés et influences", "premières libertés/contraintes"
    ],
    style: "récit introspectif, dynamique, sans jargon."
  },
  debuts_adultes: {
    goal: "Décrire l'entrée dans la vie adulte.",
    mustHave: [
      "études ou premier emploi", "choix décisifs", "premières fois importantes (ville, appart, voyage)"
    ],
    style: "récit chronologique souple; montrer causes → conséquences."
  },
  metier: {
    goal: "Présenter la vocation/métier et ce qu'elle signifie.",
    mustHave: [
      "déclic d'orientation", "fiertés", "épreuves et apprentissages", "transmission/valeurs de travail"
    ],
    style: "récit engagé mais sobre; éviter auto-promo."
  },
  valeurs: {
    goal: "Exprimer les valeurs actuelles et leur origine.",
    mustHave: [
      "ce qui compte aujourd'hui", "héritage accepté ou rejeté",
      "leçons tirées d'épreuves"
    ],
    style: "récit réfléchi; ancrer chaque idée dans un exemple si disponible."
  },
  anecdotes: {
    goal: "Raconter des scènes courtes qui révèlent la personne.",
    mustHave: [
      "histoires courtes/drôles/marquantes", "raté devenu souvenir positif",
      "moments inattendus"
    ],
    style: "scènes vivantes; peu d’explications, montrer plutôt que dire."
  },
  lieux: {
    goal: "Portrait en lieux: espaces marquants et pourquoi.",
    mustHave: [
      "lieu récurrent (description)", "voyage transformant",
      "endroit où retourner et raison"
    ],
    style: "récit descriptif, images concrètes, 1-3 paragraphes clairs."
  },
  heritage: {
    goal: "Formuler le message transmis et l'intention d'héritage.",
    mustHave: [
      "message aux proches", "ce qu'on souhaite laisser", "conseil au soi plus jeune"
    ],
    style: "récit adressé, bienveillant, sans pathos."
  },
};
