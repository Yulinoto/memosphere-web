// src/data/BLOCK_GUIDES.ts
export const BLOCK_GUIDES: Record<
  string,
  { objectives: string[]; relances: string[] }
> = {
  identite: {
    objectives: [
      "Nom, prénom, surnoms",
      "Date et lieu de naissance",
      "Contexte familial à la naissance",
    ],
    relances: [
      "On t’appelait comment quand tu étais petit ?",
      "Ton prénom, il a une histoire particulière ?",
      "Tu sais pourquoi tes parents ont choisi ce prénom ?",
    ],
  },
  enfance: {
    objectives: [
      "Maison ou environnement d’enfance",
      "École primaire, premiers souvenirs scolaires",
      "Jeux et amis proches",
      "Relations avec parents/fratrie",
    ],
    relances: [
      "Tu te souviens de ta toute première maîtresse ?",
      "Comment était ta chambre à cette époque ?",
      "Avec qui tu jouais le plus souvent ?",
    ],
  },
  adolescence: {
    objectives: [
      "Passions, activités marquantes",
      "Collège/lycée : moments forts",
      "Amitiés importantes, anecdotes",
    ],
    relances: [
      "Tu écoutais quel genre de musique à l’époque ?",
      "C’était qui ton meilleur pote au lycée ?",
      "Un souvenir marquant des cours ?",
    ],
  },
  debuts_adultes: {
    objectives: [
      "Études ou premiers boulots",
      "Décisions importantes",
      "Expériences de premières fois (ville, appart, voyage…)",
    ],
    relances: [
      "Tu te rappelles ton premier appart ?",
      "C’était quoi ton tout premier job ?",
      "Un choix marquant à ce moment-là ?",
    ],
  },
  metier: {
    objectives: [
      "Métier ou vocation : origine",
      "Fiertés et épreuves professionnelles",
      "Ce que tu transmets ou enseignes",
    ],
    relances: [
      "Qu’est-ce qui t’a donné envie de faire ce métier ?",
      "Un moment où tu as été particulièrement fier de toi ?",
      "Une difficulté qui t’a marqué au travail ?",
    ],
  },
  valeurs: {
    objectives: [
      "Ce qui compte aujourd’hui",
      "Valeurs héritées (ou rejetées) de la famille",
      "Leçons tirées d’épreuves",
    ],
    relances: [
      "Tu dirais que tu tiens quelle valeur de tes parents ?",
      "Qu’est-ce qui te guide dans tes choix aujourd’hui ?",
      "Une épreuve qui t’a appris une grande leçon ?",
    ],
  },
  anecdotes: {
    objectives: [
      "Histoires drôles ou marquantes",
      "Ratés devenus bons souvenirs",
      "Moments inattendus ou improbables",
    ],
    relances: [
      "Une anecdote qui fait toujours rire tes proches ?",
      "Une gaffe que tu racontes encore aujourd’hui ?",
      "Un moment totalement improbable ?",
    ],
  },
  lieux: {
    objectives: [
      "Lieux qui reviennent souvent en mémoire",
      "Voyages transformants",
      "Endroits où retourner, pourquoi",
    ],
    relances: [
      "Décris-moi un lieu qui te reste en tête.",
      "Un voyage qui a changé quelque chose en toi ?",
      "Un endroit où tu rêves de revenir ?",
    ],
  },
  heritage: {
    objectives: [
      "Messages pour les proches",
      "Ce que tu aimerais transmettre",
      "Conseils à ton “toi plus jeune”",
    ],
    relances: [
      "Quel message voudrais-tu laisser à tes enfants ou proches ?",
      "Qu’est-ce que tu aimerais qu’on retienne de toi ?",
      "Un conseil que tu donnerais à ton toi d’il y a 20 ans ?",
    ],
  },
};
