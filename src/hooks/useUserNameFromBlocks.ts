"use client";

import { useBlocks } from "@/hooks/useBlocks";

export function useUserNameFromBlocks(): string | undefined {
  const { blocks } = useBlocks();
  const identite = blocks?.["identite"];
  const resolved = identite?.resolved || {};

  const surnom = resolved["surnom"]?.value?.trim();
  const nickname = resolved["nickname"]?.value?.trim();
  const prenom = resolved["prenom"]?.value?.trim();

  return surnom || nickname || prenom || undefined;
}