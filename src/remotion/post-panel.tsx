import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { PANEL_HEIGHT, WIDTH } from "../config";
import type { PostView } from "../types";
import { UI_FONT } from "./fonts";
import type { TimedBeat } from "./timeline";

const HEADER_HEIGHT = 96;
const PAD = 44;
/** Bottom strip kept free for the captions that overlap the panel edge. */
const CAPTION_CLEARANCE = 150;
const CARD_TOP = HEADER_HEIGHT + 150;
const CARD_HEIGHT = PANEL_HEIGHT - CARD_TOP - CAPTION_CLEARANCE;
const IMAGE_HEIGHT = 250;
const MAX_FONT = 54;
const MIN_FONT = 40;
const LINE_RATIO = 1.3;
/** Average glyph width relative to font size for Inter. */
const CHAR_RATIO = 0.53;

/** Largest font size at which the text fits `height`, or MIN_FONT (the rest is faded out). */
function fontSizeFor(text: string, width: number, height: number): number {
  for (let size = MAX_FONT; size > MIN_FONT; size -= 2) {
    const perLine = Math.floor(width / (size * CHAR_RATIO));
    const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    if (lines * size * LINE_RATIO <= height) return size;
  }
  return MIN_FONT;
}

const Avatar: React.FC<{ post: PostView }> = ({ post }) =>
  post.avatar ? (
    <Img src={staticFile(post.avatar)} style={{ width: 84, height: 84, borderRadius: 42, objectFit: "cover", flexShrink: 0 }} />
  ) : (
    <div
      style={{
        width: 84, height: 84, borderRadius: 42, flexShrink: 0, background: "#3b82f6", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, fontWeight: 800,
      }}
    >
      {post.user.charAt(0).toUpperCase()}
    </div>
  );

const PostCard: React.FC<{ post: PostView; since: number }> = ({ post, since }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame - since, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const showImage = post.image !== null;
  const textWidth = WIDTH - 2 * PAD - 2 * 36;
  const textHeight = CARD_HEIGHT - 84 - 36 - 36 - 24 - (showImage ? IMAGE_HEIGHT + 20 : 0);
  const fontSize = fontSizeFor(post.text, textWidth, textHeight);
  const overflowing = fontSize === MIN_FONT && fontSizeFor(post.text, textWidth, 1e9) === MIN_FONT &&
    post.text.length * MIN_FONT * CHAR_RATIO * LINE_RATIO / textWidth > textHeight;
  return (
    <div
      style={{
        position: "absolute", top: CARD_TOP, left: PAD, right: PAD, height: CARD_HEIGHT,
        background: "#1f2937", border: "2px solid #374151", borderRadius: 28, padding: 36,
        boxSizing: "border-box", opacity: t, transform: `translateX(${(1 - t) * 120}px)`,
        display: "flex", flexDirection: "column", gap: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Avatar post={post} />
        <div style={{ fontSize: 46, fontWeight: 800, color: "#ffffff", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {post.user}
          {post.index === 0 && <span style={{ fontSize: 30, color: "#fbbf24", marginLeft: 16 }}>OP</span>}
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#fb7185", whiteSpace: "nowrap" }}>{"❤"} {post.likes}</div>
      </div>
      <div
        style={{
          flex: 1, minHeight: 0, overflow: "hidden", position: "relative", fontSize, lineHeight: LINE_RATIO,
          color: "#f9fafb", whiteSpace: "pre-wrap", wordBreak: "break-word", fontWeight: 500,
        }}
      >
        {post.text}
        {overflowing && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, background: "linear-gradient(to bottom, rgba(31,41,55,0), #1f2937)" }} />
        )}
      </div>
      {showImage && post.image && (
        <Img src={staticFile(post.image)} style={{ height: IMAGE_HEIGHT, width: "100%", objectFit: "cover", borderRadius: 16, flexShrink: 0 }} />
      )}
    </div>
  );
};

const TitleCard: React.FC<{ title: string; stats: string }> = ({ title, stats }) => (
  <div
    style={{
      position: "absolute", top: CARD_TOP, left: PAD, right: PAD, height: CARD_HEIGHT, display: "flex",
      flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 40,
    }}
  >
    <div style={{ fontSize: 70, fontWeight: 900, lineHeight: 1.15, color: "#ffffff" }}>{title}</div>
    <div style={{ fontSize: 50, fontWeight: 700, color: "#fbbf24" }}>{stats}</div>
  </div>
);

export const PostPanel: React.FC<{
  title: string;
  threadLabel: string;
  stats: string;
  timeline: readonly TimedBeat[];
  active: number;
}> = ({ title, threadLabel, stats, timeline, active }) => {
  const post = timeline[active]?.post ?? null;
  // Frame at which the current run of beats showing this same post began.
  let since = timeline[active]?.from ?? 0;
  for (let i = active - 1; i >= 0 && post && timeline[i]?.post?.index === post.index; i--) since = timeline[i]?.from ?? since;
  const [site, ...rest] = threadLabel.split(" › ");
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b1220", fontFamily: UI_FONT }}>
      <div
        style={{
          height: HEADER_HEIGHT, background: "#111827", borderBottom: "3px solid #f59e0b", display: "flex",
          alignItems: "center", padding: `0 ${PAD}px`, gap: 20, boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 900, color: "#f59e0b" }}>{site}</div>
        <div style={{ fontSize: 32, color: "#cbd5e1", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {rest.join(" › ")}
        </div>
      </div>
      {post && (
        <div
          style={{
            position: "absolute", top: HEADER_HEIGHT, left: PAD, right: PAD, height: 150, display: "flex", alignItems: "center",
            fontSize: 44, fontWeight: 800, lineHeight: 1.15, color: "#ffffff", overflow: "hidden",
          }}
        >
          <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{title}</div>
        </div>
      )}
      {post ? <PostCard key={post.index} post={post} since={since} /> : <TitleCard title={title} stats={stats} />}
    </div>
  );
};
