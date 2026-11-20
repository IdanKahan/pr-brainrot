import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHARACTERS, type CharacterId } from "./config";
import { synthesize, transcribeWords } from "./fish";
import type { Word } from "./types";

// Fish = the real Peter/Stewie voices. edge-tts only when ALLOW_EDGE_TTS=1 (owner doesn't want edge-tts videos).
let fishFailed = false;
export const disableFish = (): void => { fishFailed = true; };
export const useFish = (): boolean => Boolean(process.env.FISH_API_KEY) && !fishFailed;
/** Fish speech-to-text is paid; off unless FISH_ASR=1. Without it captions use estimated word timings. */
const useFishAsr = (): boolean => process.env.FISH_ASR === "1";

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
    return useFishAsr() ? transcribeWords(audio) : null;
  }
  if (process.env.ALLOW_EDGE_TTS !== "1")
    throw new Error("FISH_API_KEY missing and ALLOW_EDGE_TTS is not 1: refusing to make an edge-tts video");
  const metaPath = `${audioPath}.words.json`;
  // edge-tts sometimes fails transiently (NoAudioReceived); retry with backoff before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(
        process.env.PR_BRAINROT_PYTHON ?? "python",
        [path.resolve("src", "edge_tts_line.py"), c.edgeVoice, c.edgeRate, c.edgePitch, audioPath, metaPath],
        { input: text, stdio: ["pipe", "inherit", "inherit"] },
      );
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      console.warn(`  edge-tts failed (attempt ${attempt}/4), retrying in ${attempt * 5}s`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
  const words = JSON.parse(readFileSync(metaPath, "utf8")) as Word[];
  return words.length > 0 ? words : null;
}
