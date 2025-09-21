import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const k = process.env.DEEPGRAM_API_KEY || "";
  const pid = process.env.DEEPGRAM_PROJECT_ID || "";
  res.status(200).json({
    hasApiKey: Boolean(k),
    apiKeyPreview: k ? `dg_${k.slice(3, 9)}...(${k.length} chars)` : null,
    hasProjectId: Boolean(pid),
    projectIdPreview: pid ? `${pid.slice(0, 8)}...` : null,
  });
}
