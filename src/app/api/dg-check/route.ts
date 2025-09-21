import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, why: "no api key" }, { status: 500 });
  }

  const r = await fetch("https://api.deepgram.com/v1/projects", {
  headers: { Authorization: `Bearer ${process.env.DEEPGRAM_API_KEY}` },
  // @ts-ignore
  cache: "no-store",
});
  const text = await r.text();
  return NextResponse.json({ status: r.status, body: text });
}
