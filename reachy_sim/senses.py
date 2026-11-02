"""Ears, voice, and one camera frame for Hermes's body.

The sim hears text and writes a placeholder picture. The same functions are
what a later 4-mic array, speaker, and head camera will call. Nothing here
asks Hermes or calls Buildium.
"""

from __future__ import annotations

import re
import struct
import sys
import threading
import zlib
from datetime import datetime
from pathlib import Path


_PHOTO_WORD = re.compile(r"\b(?:photo|picture)s?\b", re.IGNORECASE)
_PLAYER = None


def current_time() -> datetime:
    return datetime.now()


def read_utterances(source: Path | str) -> list[str]:
    """Read non-empty lines from a file, or from stdin when source is '-'."""
    if str(source) == "-":
        text = sys.stdin.read()
    else:
        text = Path(source).read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines() if line.strip()]


def speak(text: str, player=None) -> None:
    """Print the reply and play it. The beep stays outside the Hermes wait."""
    spoken = text.strip()
    if not spoken:
        return
    print(f"SPEAK: {spoken}")
    chosen = player if player is not None else _PLAYER
    if chosen is not None:
        try:
            chosen(spoken)
            return
        except Exception:
            pass
    _beep()


def use_speaker(player) -> None:
    """Remember the real robot speaker. speak() uses it on the next reply."""
    global _PLAYER
    _PLAYER = player


def wants_photo(action: str, reply: str) -> bool:
    """A Buildium reply that asks for a photo or a picture."""
    return action == "buildium" and _PHOTO_WORD.search(reply or "") is not None


def capture_frame(pack: Path, *, camera=None) -> Path:
    """Save one frame in photos/ next to the pack. camera() supplies later bytes."""
    moment = current_time()
    folder = Path(pack).parent / "photos"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"photo-{moment.strftime('%Y%m%d-%H%M%S')}.png"
    path = folder / name
    if path.exists():
        name = f"photo-{moment.strftime('%Y%m%d-%H%M%S')}-{moment.microsecond:06d}.png"
        path = folder / name
    payload = camera() if camera is not None else solid_png()
    path.write_bytes(payload)
    return path


def solid_png(rgb: tuple[int, int, int] = (46, 92, 138)) -> bytes:
    """A small solid-color PNG. No image library is required."""
    width, height = 8, 8
    row = b"\x00" + bytes(rgb) * width
    raw = row * height

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _beep() -> None:
    """A short tone. It runs aside so the body does not wait on the speaker."""

    def play() -> None:
        try:
            import winsound

            winsound.Beep(880, 60)
        except Exception:
            try:
                sys.stdout.write("\a")
                sys.stdout.flush()
            except Exception:
                return

    threading.Thread(target=play, name="reachy-beep", daemon=True).start()
