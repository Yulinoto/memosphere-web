export const DRAFT_STORAGE_KEY = "memosphere:draft:v1";

export function clearDraftStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
