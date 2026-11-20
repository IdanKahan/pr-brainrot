import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadTopic, runSlugFor, type Topic } from "./chiefdelphi";
import { generate } from "./pipeline";

const USAGE = `Usage: npx tsx src/cli.ts <path-to-topic.json> [options]

  --new-script     ask the model for a new script instead of reusing the cached one
  --no-render      stop after writing out/<slug>.props.json
  --out=<dir>      output folder (default ../../feed/videos)`;

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`;
}

/** Erin sidecar: title, caption (HTML) and link. */
function sidecar(topic: Topic): object {
  const replies = topic.top_replies.slice(0, 3).map((r) => `${escapeHtml(r.user)} (❤ ${r.likes}): ${escapeHtml(clip(r.text, 120 - r.user.length - 8))}`);
  const caption = [
    `\u{1F44D} ${topic.likes} · \u{1F4AC} ${topic.replies} · Chief Delphi › ${escapeHtml(topic.category)}`,
    "<b>Top replies</b>",
    ...replies,
    `<a href="${escapeHtml(topic.url)}">Read the thread on Chief Delphi</a>`,
  ].join("<br>");
  return { video_title: topic.title, video_caption: caption, video_link: topic.url };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Optional: keys can also come from the shell environment.
  }
  const args = process.argv.slice(2);
  const topicPath = args.find((a) => !a.startsWith("--"));
  if (!topicPath) {
    console.error(USAGE);
    process.exit(1);
  }
  const outDir = path.resolve(args.find((a) => a.startsWith("--out="))?.slice(6) ?? path.join("..", "..", "feed", "videos"));
  const topic = loadTopic(topicPath);
  const slug = runSlugFor(topicPath, topic);
  const result = await generate({
    topic,
    topicPath,
    newScript: args.includes("--new-script"),
    render: !args.includes("--no-render"),
    output: path.join(outDir, `${slug}.mp4`),
  });
  if (!result.video) return;
  writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(sidecar(topic), null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
