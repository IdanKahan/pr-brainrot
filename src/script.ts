import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CHARACTER_IDS, CHARACTERS, type CharacterId } from "./config";
import type { Topic } from "./chiefdelphi";

const ScriptSchema = z.object({
  title: z.string(),
  lines: z
    .array(
      z.object({
        speaker: z.enum(CHARACTER_IDS as [CharacterId, ...CharacterId[]]),
        text: z.string(),
        // 0 = the original post, 1..N = top_replies[N-1], null = nothing specific.
        // Plain number: integer bounds aren't supported by every structured-output backend.
        post: z.number().nullable(),
      }),
    )
    .min(2),
});

export type Script = z.infer<typeof ScriptSchema>;

// Draft-07 without "$schema": the claude CLI rejects the 2020-12 URI.
const { $schema: _, ...JSON_SCHEMA } = z.toJSONSchema(ScriptSchema, { target: "draft-07" });

export const PROVIDERS = ["anthropic", "openrouter", "claude-code"] as const;
export type Provider = (typeof PROVIDERS)[number];

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-opus-5-5",
  openrouter: "anthropic/claude-opus-5.5",
  "claude-code": "sonnet",
};

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** Explicit `PR_BRAINROT_PROVIDER`, else whichever API key is set, else the local Claude Code CLI. */
export function resolveProvider(): Provider {
  const explicit = process.env.PR_BRAINROT_PROVIDER;
  if (explicit) {
    if (!(PROVIDERS as readonly string[]).includes(explicit)) {
      throw new Error(`PR_BRAINROT_PROVIDER must be one of ${PROVIDERS.join(", ")}`);
    }
    return explicit as Provider;
  }
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "claude-code";
}

const FALLBACK_RULES = `You write scripts for 30 to 60 second vertical "brainrot" videos about FRC (FIRST Robotics Competition) Chief Delphi threads.
Two Family Guy characters talk over Minecraft parkour footage. The top half of the screen shows the forum post being discussed.
Rules:
- 8 to 14 short lines, 100 to 160 words total. Stewie explains, Peter is confused. Line 1 is a hook. End with a punchline.
- Cover the original post and 2 or 3 top replies by username ("and then some guy named truher said...").
- FRC terms must be correct; if unsure, stay vague. Jokes target ideas, rules and robots, never people. PG.
- Spoken-friendly: spell out numbers, no URLs, no markdown, no emoji.
- "title" is at most 8 words.`;

/** The owner's tunable prompt at pipeline/prompts/script.md (two levels above the fork root) if present. */
function loadRules(): string {
  const file = path.resolve("..", "..", "pipeline", "prompts", "script.md");
  return existsSync(file) ? readFileSync(file, "utf8") : FALLBACK_RULES;
}

function buildPrompt(topic: Topic): string {
  const cast = CHARACTER_IDS.map((id) => `- "${id}": ${CHARACTERS[id].persona}`).join("\n");
  const posts = [
    { post: 0, role: "original post", ...topic.op },
    ...topic.top_replies.map((r, i) => ({ post: i + 1, role: "top reply", ...r })),
  ].map((p) => ({ post: p.post, role: p.role, user: p.user, likes: p.likes, text: p.text.slice(0, 1500) }));
  return `${loadRules()}

---
Output format override (follow this instead of any output format above): a JSON object {"title": string, "lines": [{"speaker": "peter" | "stewie", "text": string, "post": number | null}]}.
HARD LIMIT: aim for 120 to 140 words across all lines, never more than 150 (the video must stay under 60 seconds); keep every line under 18 words and use at most 11 lines.
"title" replaces "hook": a short punchy video title, at most 8 words.
"post" says which post the line is about, so the screen can show it: 0 = the original post, 1..${topic.top_replies.length} = the matching entry in "posts" below, null = nothing specific. Set it on every line that discusses a post, and keep it matching what the line says.

Cast:
${cast}

Thread: ${topic.title}
Category: ${topic.category}. ${topic.likes} likes, ${topic.replies} replies.

posts:
${JSON.stringify(posts, null, 1)}`;
}

async function viaAnthropic(prompt: string, model: string): Promise<Script> {
  const client = new Anthropic();
  const useFallbacks = FALLBACK_MODELS.has(model);
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort: "medium", format: betaZodOutputFormat(ScriptSchema) },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to write the script: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (!response.parsed_output) throw new Error(`Claude returned no script (stop reason: ${response.stop_reason})`);
  return response.parsed_output;
}

async function viaOpenRouter(prompt: string, model: string): Promise<Script> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/c-ehrlich/pr-brainrot",
      "X-Title": "pr-brainrot",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "script", strict: true, schema: JSON_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`OpenRouter returned no content: ${JSON.stringify(body).slice(0, 500)}`);
  return ScriptSchema.parse(JSON.parse(content));
}

function viaClaudeCode(prompt: string, model: string): Script {
  const output = execFileSync(
    "claude",
    ["-p", "--model", model, "--output-format", "json", "--tools", "", "--json-schema", JSON.stringify(JSON_SCHEMA)],
    // Run outside any repo so project instructions don't leak into the prompt.
    { cwd: tmpdir(), input: prompt, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const response = JSON.parse(output) as { is_error: boolean; result: string; structured_output: unknown };
  if (response.is_error) throw new Error(`claude failed: ${response.result}`);
  return ScriptSchema.parse(response.structured_output);
}

function validate(script: Script, topic: Topic): Script {
  const max = topic.top_replies.length;
  const words = script.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  if (script.lines.length < 6 || script.lines.length > 18) throw new Error(`bad line count ${script.lines.length}`);
  if (words < 80 || words > 160) throw new Error(`bad word count ${words}`);
  return {
    title: script.title.trim(),
    lines: script.lines.map((l) => ({ ...l, post: l.post !== null && Number.isInteger(l.post) && l.post >= 0 && l.post <= max ? l.post : null })),
  };
}

export async function writeScript(topic: Topic): Promise<Script> {
  const provider = resolveProvider();
  const model = process.env.PR_BRAINROT_MODEL || DEFAULT_MODELS[provider];
  console.log(`Writing script with ${provider} (${model})…`);
  const prompt = buildPrompt(topic);
  const run = async (): Promise<Script> => {
    switch (provider) {
      case "anthropic":
        return viaAnthropic(prompt, model);
      case "openrouter":
        return viaOpenRouter(prompt, model);
      case "claude-code":
        return viaClaudeCode(prompt, model);
    }
  };
  try {
    return validate(await run(), topic);
  } catch (error) {
    console.warn(`Script attempt failed (${error instanceof Error ? error.message : String(error)}); retrying once`);
    return validate(await run(), topic);
  }
}
