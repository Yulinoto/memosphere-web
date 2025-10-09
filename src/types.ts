export interface BlockData {
  id: string;
  summary: string;
  title?: string;
  style?: string;
  intro?: string;
  conclusion?: string;
}

export interface DraftConfig {
  id?: string;
  title?: string;
  subtitle?: string;
  style?: string;
  styleInstructions?: string;   // ✅ ajouté
  intro?: string;
  introHint?: string;           // ✅ ajouté
  conclusion?: string;
  conclusionHint?: string;      // ✅ ajouté
  blocks: BlockData[];
}
