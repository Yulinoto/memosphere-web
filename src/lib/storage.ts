// src/lib/storage.ts
import localforage from "localforage";
import type { BlocksState } from "@/data/blocks";
import { DEFAULT_BLOCKS } from "@/data/blocks";

const STORE_KEY = "memosphere.blocks.v1";

localforage.config({
  name: "memosphere",
  storeName: "blocks",
  description: "Blocs biographiques en local (proto)",
});

export async function loadBlocks(): Promise<BlocksState> {
  const data = await localforage.getItem<BlocksState>(STORE_KEY);
  if (data && typeof data === "object") return data;

  await localforage.setItem(STORE_KEY, DEFAULT_BLOCKS);
  return DEFAULT_BLOCKS;
}

export async function saveBlocks(next: BlocksState): Promise<void> {
  await localforage.setItem(STORE_KEY, next);
}

export async function resetBlocks(): Promise<BlocksState> {
  await localforage.setItem(STORE_KEY, DEFAULT_BLOCKS);
  return DEFAULT_BLOCKS;
}
