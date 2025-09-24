// src/lib/textClean.ts
export function cleanSpeechFillers(input: string) {
  if (!input) return "";
  let t = input;

  // Espace & ponctuation
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.;:!?])/g, "$1");

  // Tics oraux (FR) à enlever quand isolés
  const fillers = [
    "euh", "heu", "ben", "bah",
    "tu vois", "genre", "enfin", "quoi",
    "du coup", "voilà", "bref",
    "tu sais", "franchement", "hmm", "mmh"
  ];
  const re = new RegExp(`\\b(?:${fillers.join("|")})\\b`, "gi");
  t = t.replace(re, "");

  // Doubles espaces créés
  t = t.replace(/\s{2,}/g, " ").trim();

  // Répétitions immédiates (mot mot → mot)
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, "$1");

  // . , ! ? collés ou manquants → léger polish (on ne force pas trop)
  t = t.replace(/\s*([.?!])\s*/g, "$1 ");

  return t.trim();
}
