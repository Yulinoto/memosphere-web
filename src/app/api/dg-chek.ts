import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const apiKey = process.env.DEEPGRAM_API_KEY || "";
  const projectId = process.env.DEEPGRAM_PROJECT_ID || "";

  if (!apiKey || !projectId) {
    return res.status(500).json({ ok: false, why: "missing env", hasApiKey: !!apiKey, hasProjectId: !!projectId });
  }

  // On cible le projet directement
  const url = `https://api.deepgram.com/v1/projects/${projectId}`;

  // Essai 1: Token
  let r = await fetch(url, { headers: { Authorization: `Token ${apiKey}` } });
  if (r.status === 401 || r.status === 403) {
    // Essai 2: Bearer (certaines orgs/SDK l’acceptent)
    r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  }

  const text = await r.text();
  return res.status(200).json({ tried: url, status: r.status, body: text.slice(0, 300) });
}
