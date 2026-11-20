"""Synthesize one line with edge-tts; write mp3 plus word boundaries (ms) as JSON.
Usage: python edge_tts_line.py VOICE RATE PITCH OUT_MP3 OUT_JSON   (text on stdin, UTF-8)"""
import asyncio
import json
import sys

import edge_tts


async def main(voice, rate, pitch, mp3, meta):
    text = sys.stdin.buffer.read().decode("utf-8")
    words = []
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    with open(mp3, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                start = ch["offset"] / 10000
                words.append({"text": ch["text"], "startMs": start, "endMs": start + ch["duration"] / 10000})
    with open(meta, "w", encoding="utf-8") as f:
        json.dump(words, f)


asyncio.run(main(*sys.argv[1:6]))
