import type { CharacterId } from "./config";

/** A Chief Delphi post shown in the top panel. */
export interface PostView {
  /** 0 = OP, 1..N = top replies. */
  readonly index: number;
  readonly user: string;
  /** Path relative to `public/`, or null. */
  readonly avatar: string | null;
  readonly likes: number;
  readonly text: string;
  /** Path relative to `public/`, or null. */
  readonly image: string | null;
}

export interface Word {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface Beat {
  readonly speaker: CharacterId;
  readonly text: string;
  /** Path relative to `public/`. */
  readonly audio: string;
  readonly durationMs: number;
  readonly words: readonly Word[];
  readonly post: PostView | null;
}

export interface Gameplay {
  /** Path relative to `public/`. */
  readonly src: string;
  readonly durationInSeconds: number;
}

// A type alias rather than an interface: Remotion requires composition props
// to be assignable to Record<string, unknown>.
export type VideoProps = {
  readonly title: string;
  /** The Chief Delphi thread title (`title` is the short video hook). */
  readonly threadTitle: string;
  readonly threadLabel: string;
  readonly stats: string;
  readonly beats: readonly Beat[];
  readonly gameplay: Gameplay;
  readonly gameplayStartSeconds: number;
};
