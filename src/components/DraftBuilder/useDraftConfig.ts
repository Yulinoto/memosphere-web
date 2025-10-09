import { useState } from "react";
import { DraftConfig } from "../../types";

export function useDraftConfig(initial: DraftConfig = { blocks: [] }): [DraftConfig, (updater: Partial<DraftConfig>) => void] {
  const [config, setConfig] = useState<DraftConfig>(initial);

  const updateConfig = (updater: Partial<DraftConfig>) => {
    setConfig((prev: DraftConfig) => ({ ...prev, ...updater }));
  };

  return [config, updateConfig];
}
