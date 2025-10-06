export type NameParts = { prenom?: string; nom?: string };

const LOWER_PARTICLES = new Set([
  "de","du","des","le","la","les","van","von","der","den","del","della","di","da","dos","do","bin","ibn","al","el"
]);

/**
 * Essaie de séparer un « prénom nom » raisonnablement :
 * - gère prénoms composés (Jean-Baptiste, Anne-Marie…)
 * - garde les particules dans le nom : "van der Meer", "de la Rosa"…
 * - si on ne peut pas, met tout côté prénom (plutôt que de casser un nom rare)
 */
export function extractNameParts(input: string): NameParts {
  const raw = (input || "").trim().replace(/\s+/g, " ");
  if (!raw) return {};

  // Si l’utilisateur a mis une virgule "Nom, Prénom"
  if (raw.includes(",")) {
    const [left, right] = raw.split(",").map((s) => s.trim());
    if (left && right) return { prenom: right, nom: left };
  }

  const tokens = raw.split(" ");
  if (tokens.length === 1) {
    // Un seul mot – on suppose prénom
    return { prenom: tokens[0] };
  }

  // Heuristique : premier token = prénom (garde prénoms composés avec '-')
  // Le reste = nom (en conservant particules en minuscules)
  const first = tokens[0];
  const rest = tokens.slice(1);

  // Cas fréquents : prénoms composés "Jean-Baptiste", "Marie-Lou"
  // On ne touche pas, on prend tel quel comme prenom si first comporte '-'.

  // Recolle le nom en gardant les particules en minuscules
  const nomParts: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    const lower = t.toLowerCase();
    if (LOWER_PARTICLES.has(lower)) nomParts.push(lower);
    else nomParts.push(t);
  }

  const nom = nomParts.join(" ");
  const prenom = first;

  // Si le "nom" est très court et ne ressemble qu'à une particule,
  // on re-bascule tout en prénom (sécurité)
  if (!nom || LOWER_PARTICLES.has(nom.toLowerCase())) {
    return { prenom: raw };
  }

  return { prenom, nom };
}
