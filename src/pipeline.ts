import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { copyImages, postAt, runSlugFor, type Topic } from "./chiefdelphi";
import { CHARACTERS, GAMEPLAY, type CharacterId } from "./config";
import { renderVideo } from "./render";
import { writeScript, type Script } from "./script";
import { disableFish, speak, useFish, voiceKey } from "./tts";
import type { Beat, PostView, VideoProps, Word } from "./types";

export interface GenerateOptions {
  readonly topic: Topic;
  readonly topicPath: string;
  /** Ignore a cached script.json and ask the model again. */
  readonly newScript: boolean;
  readonly render: boolean;
  /** Final mp4 location; the render goes to a temp name next to it first. */
  readonly output: string;
}

export interface GenerateResult {
  readonly script: Script;
  /** Absolute path, or null when rendering was skipped. */
  readonly video: string | null;
}

interface LineAudio {
  readonly durationMs: number;
  readonly words: readonly Word[];
}

function probeSeconds(file: string): number {
  const seconds = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return Number(seconds.trim());
}

/** Spreads the script's words over the clip, weighted by length, when real timings are unavailable. */
function estimateWords(text: string, durationMs: number): Word[] {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return words.map((word, i) => {
    const length = ((weights[i] ?? 0) / total) * durationMs;
    const result = { text: word, startMs: cursor, endMs: cursor + length };
    cursor += length;
    return result;
  });
}

async function voiceLine(runDir: string, index: number, text: string, speaker: CharacterId): Promise<{ audioFile: string } & LineAudio> {
  const key = createHash("sha256").update(`${voiceKey(speaker)}\n${text}`).digest("hex").slice(0, 10);
  const audioFile = `line-${index}-${key}.mp3`;
  const metaPath = path.join(runDir, `line-${index}-${key}.json`);
  if (existsSync(metaPath)) {
    return { audioFile, ...(JSON.parse(readFileSync(metaPath, "utf8")) as LineAudio) };
  }
  const audioPath = path.join(runDir, audioFile);
  const timed = await speak(speaker, text, audioPath);
  const probed = Math.round(probeSeconds(audioPath) * 1000);
  // edge-tts mp3s carry ~0.8 s of trailing silence; cut at the last word when real timings exist.
  const lastEnd = timed?.at(-1)?.endMs;
  const durationMs = lastEnd ? Math.min(probed, Math.round(lastEnd) + 250) : probed;
  const meta: LineAudio = { durationMs, words: timed ?? estimateWords(text, durationMs) };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { audioFile, ...meta };
}

function postView(topic: Topic, n: number, slug: string): PostView | null {
  const p = postAt(topic, n);
  if (!p) return null;
  return {
    index: n,
    user: p.user,
    avatar: p.avatar ? `runs/${slug}/${p.avatar}` : null,
    likes: p.likes,
    text: p.text,
    image: n === 0 && topic.op.image ? `runs/${slug}/${topic.op.image}` : null,
  };
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { topic } = options;
  const slug = runSlugFor(options.topicPath, topic);
  const runDir = path.join("public", "runs", slug);
  mkdirSync(runDir, { recursive: true });
  copyImages(options.topicPath, runDir);

  const scriptPath = path.join(runDir, "script.json");
  let script: Script;
  if (existsSync(scriptPath) && !options.newScript) {
    console.log(`Reusing ${scriptPath} (pass --new-script to rewrite it)`);
    script = JSON.parse(readFileSync(scriptPath, "utf8")) as Script;
  } else {
    script = await writeScript(topic);
    writeFileSync(scriptPath, JSON.stringify(script, null, 2));
  }
  console.log(`\n"${script.title}"`);
  for (const line of script.lines) console.log(`  ${CHARACTERS[line.speaker].name} [${line.post ?? "-"}]: ${line.text}`);
  console.log();

  const beats: Beat[] = [];
  for (const [index, line] of script.lines.entries()) {
    console.log(`Voicing line ${index + 1}/${script.lines.length}${useFish() ? " (Fish)" : " (edge-tts)"}`);
    let voiced;
    try {
      voiced = await voiceLine(runDir, index, line.text, line.speaker);
    } catch (error) {
      // No edge-tts fallback by default (owner: never publish edge-tts videos). Fail this video; the run skips it.
      if (!useFish() || process.env.ALLOW_EDGE_TTS !== "1") throw error;
      console.warn(`  Fish failed, ALLOW_EDGE_TTS=1 so using edge-tts for this video: ${error instanceof Error ? error.message : error}`);
      disableFish();
      return generate(options);
    }
    beats.push({
      speaker: line.speaker,
      text: line.text,
      audio: `runs/${slug}/${voiced.audioFile}`,
      durationMs: voiced.durationMs,
      words: voiced.words,
      post: line.post === null ? null : postView(topic, line.post, slug),
    });
  }

  const totalSeconds = beats.reduce((sum, b) => sum + b.durationMs, 0) / 1000;
  const spareSeconds = Math.max(0, GAMEPLAY.durationInSeconds - totalSeconds - 5);
  const props: VideoProps = {
    title: script.title,
    threadTitle: topic.title,
    threadLabel: `Chief Delphi › ${topic.category}`,
    stats: `\u{1F44D} ${topic.likes} · \u{1F4AC} ${topic.replies}`,
    beats,
    gameplay: GAMEPLAY,
    gameplayStartSeconds: spareSeconds >= 1 ? (topic.id * 37) % Math.floor(spareSeconds) : 0,
  };
  mkdirSync("out", { recursive: true });
  const propsPath = path.join("out", `${slug}.props.json`);
  writeFileSync(propsPath, JSON.stringify(props, null, 2));
  console.log(`Props: ${propsPath} (${totalSeconds.toFixed(1)}s of speech)`);

  if (!options.render) return { script, video: null };
  // Render to a temp name, then rename, so the feed never sees a half-written file.
  const output = path.resolve(options.output);
  mkdirSync(path.dirname(output), { recursive: true });
  const temp = output.replace(/\.mp4$/, ".partial.mp4");
  await renderVideo(props, temp);
  renameSync(temp, output);
  const megabytes = statSync(output).size / 1024 / 1024;
  console.log(`\nVideo: ${output} (${megabytes.toFixed(1)} MB)`);
  return { script, video: output };
}
