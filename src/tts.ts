import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHARACTERS, type CharacterId } from "./config";
import { synthesize, transcribeWords } from "./fish";
import type { Word } from "./types";

const useFish = (): boolean => Boolean(process.env.FISH_API_KEY);

/** Identifies the voice configuration, for cache keys. */
export function voiceKey(speaker: CharacterId): string {
  const c = CHARACTERS[speaker];
  return useFish() ? c.voiceId : `edge:${c.edgeVoice}:${c.edgeRate}:${c.edgePitch}`;
}

/** Writes the mp3 to `audioPath`; returns real word timings when the engine provides them (else null). */
export async function speak(speaker: CharacterId, text: string, audioPath: string): Promise<Word[] | null> {
  const c = CHARACTERS[speaker];
  if (useFish()) {
    const audio = await synthesize(text, c.voiceId);
    writeFileSync(audioPath, audio);
    return transcribeWords(audio);
  }
  const metaPath = `${audioPath}.words.json`;
  execFileSync(
    process.env.PR_BRAINROT_PYTHON ?? "python",
    [path.resolve("src", "edge_tts_line.py"), c.edgeVoice, c.edgeRate, c.edgePitch, audioPath, metaPath],
    { input: text, stdio: ["pipe", "inherit", "inherit"] },
  );
  const words = JSON.parse(readFileSync(metaPath, "utf8")) as Word[];
  return words.length > 0 ? words : null;
}
