import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { VideoProps } from "./types";

const TARGET_BYTES = 15 * 1024 * 1024;
const AUDIO_KBPS = 96;
/** 720×1280: the post panel stays legible, unlike 540×960. */
const COMPACT_SCALE = 2 / 3;

/** Two-pass H.264 Main / yuv420p + AAC encode to a fixed size, with +faststart. */
function encodeCompact(input: string, output: string, seconds: number): void {
  const videoKbps = Math.floor((TARGET_BYTES * 8) / 1000 / seconds) - AUDIO_KBPS;
  const passLog = path.join(tmpdir(), `pr-brainrot-${process.pid}`);
  const video = [
    ["-vf", "fps=30,scale=out_range=tv,format=yuv420p", "-color_range", "tv"],
    ["-c:v", "libx264", "-profile:v", "main", "-preset", "slow", "-b:v", `${videoKbps}k`],
    ["-passlogfile", passLog],
  ].flat();
  const ffmpeg = (args: readonly string[]): void => {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, ...args], { stdio: "inherit" });
  };
  console.log(`\nEncoding at ${videoKbps} kb/s…`);
  ffmpeg([...video, "-pass", "1", "-an", "-f", "mp4", process.platform === "win32" ? "NUL" : "/dev/null"]);
  ffmpeg([
    ...video,
    ["-pass", "2", "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ar", "48000"],
    ["-video_track_timescale", "90000", "-movflags", "+faststart", "-brand", "mp42", output],
  ].flat());
  rmSync(`${passLog}-0.log`, { force: true });
  rmSync(`${passLog}-0.log.mbtree`, { force: true });
}

export async function renderVideo(props: VideoProps, outputLocation: string): Promise<void> {
  console.log("Bundling…");
  const serveUrl = await bundle({ entryPoint: path.resolve("src/remotion/index.ts") });
  const composition = await selectComposition({ serveUrl, id: "Brainrot", inputProps: props });
  const master = outputLocation.replace(/\.mp4$/, ".master.mp4");

  let lastPercent = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: master,
    inputProps: props,
    scale: COMPACT_SCALE,
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        process.stdout.write(`Rendering ${percent}%\r`);
      }
    },
  });

  encodeCompact(master, outputLocation, composition.durationInFrames / composition.fps);
  rmSync(master);
}
