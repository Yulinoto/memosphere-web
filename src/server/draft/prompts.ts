import type { ContextPack, EvidenceBundle } from "./types";

export function buildOutlineMessages(ctx: ContextPack) {
  const system =
`You are a biography writer. Build a strictly chronological book outline ("Timeline" mode).

JSON CONTRACT (STRICT KEYS):
{
  "mode": "Timeline",
  "title": "string",
  "chapters": [
    {
      "title": "string",
      "summary": "string",
      "sections": [
        {
          "title": "string",
          "beats": [
            { "idea": "string", "evidence": [ { "block": "string", "entry": 0 } ] }
          ]
        }
      ]
    }
  ],
  "coverage": { "must_uncovered": ["string"] }
}

Rules:
- Use ONLY the given identity/blocks. No external facts.
- Each beat MUST reference evidence [{ "block": "<id>", "entry": <n> }].
- 6–10 chapters max; 1–3 sections per chapter.
- Output STRICT JSON ONLY.`;

  const user = JSON.stringify({
    mode: "Timeline",
    style: ctx.style,
    constraints: ctx.constraints,
    target: ctx.target,
    identity: ctx.identity,
    blocks: ctx.blocks
  });

  return { system, user };
}

// ====== Rédaction par section (FR, sans invention, SANS ancres) ======
export function buildSectionMessages(bundle: EvidenceBundle) {
  const system =
`You are a biography writer. Write ONE section in French as clean markdown paragraphs.

STRICT JSON OUTPUT (ONLY):
{
  "title": "string",
  "markdown": "string",
  "used_evidence": [ { "block": "string", "entry": 0 } ]
}

Grounding (MANDATORY):
- Use ONLY the provided evidence texts (they already contain the facts). No external facts or guesses.
- If a detail is missing in the evidence, simply omit it. Do NOT fabricate or fill with placeholders.
- No bullet lists. No tables. Return plain paragraphs in French.

Voice & Person:
- Use ONLY the person specified in style.person.
- If style.person = "je": strictly first person; never switch to third person; never use the proper name for the narrator.
- If style.person = "il"/"elle": strictly third person; never switch to "je".
- Mixing persons is forbidden.

Length & Style:
- Clear, warm tone.
- Default length: 120–220 words unless overridden by rules.length.
- Start with a concise lead sentence tied to the section idea.
- Output STRICT JSON ONLY (no prose outside JSON).`;

  const user = JSON.stringify({
    identity: bundle.identity,
    style: bundle.style,
    rules: bundle.rules,
    beats: bundle.beats
  });

  return { system, user };
}
