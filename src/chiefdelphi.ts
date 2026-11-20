import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Post {
  readonly user: string;
  readonly avatar: string | null;
  readonly likes: number;
  readonly text: string;
  readonly image?: string | null;
  readonly post_number?: number;
}

export interface Topic {
  readonly id: number;
  readonly slug: string;
  readonly url: string;
  readonly title: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly likes: number;
  readonly views: number;
  readonly replies: number;
  readonly created_at: string;
  readonly op: Post;
  readonly top_replies: readonly Post[];
}

/** `<date>-<id>-<slug>`, the date being the topic folder's parent directory name. */
export function runSlugFor(topicPath: string, topic: Topic): string {
  const date = path.basename(path.dirname(path.dirname(path.resolve(topicPath))));
  return `${date}-${topic.id}-${topic.slug}`;
}

export function loadTopic(topicPath: string): Topic {
  return JSON.parse(readFileSync(topicPath, "utf8")) as Topic;
}

/** Copies the topic's `img/` folder where Remotion's staticFile can serve it. */
export function copyImages(topicPath: string, runDir: string): void {
  const source = path.join(path.dirname(path.resolve(topicPath)), "img");
  if (!existsSync(source)) return;
  mkdirSync(path.join(runDir, "img"), { recursive: true });
  cpSync(source, path.join(runDir, "img"), { recursive: true });
}

/** Post 0 is the OP, 1..N are `top_replies`. */
export function postAt(topic: Topic, n: number): Post | null {
  return n === 0 ? topic.op : (topic.top_replies[n - 1] ?? null);
}
