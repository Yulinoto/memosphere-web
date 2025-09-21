// src/app/api/dg-token/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  const projectId = process.env.DEEPGRAM_PROJECT_ID;

  if (!apiKey) return NextResponse.json({ error: "Missing DEEPGRAM_API_KEY" }, { status: 500 });

  const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,      // clé maître (Owner/Admin)
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project_id: projectId,                 // optionnel mais OK si présent
      scopes: ["usage:write"],               // suffisant pour /listen
      ttl: 60,                               // 60s de validité
    }),
  });

  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!r.ok) {
    return NextResponse.json(
      { error: "grant_failed", status: r.status, body: data },
      { status: r.status }
    );
  }

  // Deepgram renvoie { access_token, expires_at, ... }
  if (!data?.access_token) {
    return NextResponse.json(
      { error: "no_access_token_in_response", body: data },
      { status: 500 }
    );
  }

  return NextResponse.json({ access_token: data.access_token, expires_at: data.expires_at });
}
