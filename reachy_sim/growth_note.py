"""Write a growth note when a decision has no usable local skill.

Notes go only to growth/pending. The robot does not accept them, and it does
not edit memories/MEMORY.md or any sealed file.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from reachy_sim.cortex_loader import CortexLoader


# One shared content word is not enough to skip a note. Two is a usable match.
USABLE_MATCH_SCORE = 2


def pending_dir(pack: Path) -> Path:
    return Path(pack) / "growth" / "pending"


def pending_count(pack: Path) -> int:
    folder = pending_dir(pack)
    if not folder.is_dir():
        return 0
    return sum(1 for path in folder.glob("*.md") if path.is_file())


def maybe_write_growth_note(pack: Path, loader: CortexLoader, utterance: str) -> Path | None:
    """Write one pending note for a real decision with no usable local match.

    The same utterance is not written twice. Idle cycles must not call this.
    """
    text = utterance.strip()
    score = loader.match_score(text)
    if not text or score is None or score >= USABLE_MATCH_SCORE:
        return None
    return _write_pending(pack, text, _note_body(text, score))


def write_work_note(
    pack: Path,
    utterance: str,
    *,
    ticket: str = "",
    contractor: str = "",
    photo: str = "",
) -> Path | None:
    """Record a Buildium result Hermes already handled.

    The same utterance is still written once. This does not call Buildium.
    """
    text = utterance.strip()
    if not text:
        return None
    lines = ["From: reachy-sim", f"Utterance: {text}"]
    if ticket.strip():
        lines.append(f"Ticket: {ticket.strip()}")
    if contractor.strip():
        lines.append(f"Contractor: {contractor.strip()}")
    if photo.strip():
        lines.append(f"Photo: {photo.strip()}")
    if len(lines) == 2:
        return None
    return _write_pending(pack, text, "\n".join(lines) + "\n")


def write_event_note(pack: Path, utterance: str, reason: str) -> Path | None:
    """Write one pending note for a Hermes timeout or error.

    The same utterance is still written once. This does not accept the note.
    """
    text = utterance.strip()
    line = reason.strip()
    if not text or not line:
        return None
    body = f"From: reachy-sim\nUtterance: {text}\n{line}\n"
    return _write_pending(pack, text, body)


def _write_pending(pack: Path, utterance: str, body: str) -> Path | None:
    folder = pending_dir(pack)
    if _already_noted(folder, utterance):
        return None
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{_note_id(utterance)}.md"
    if path.is_file():
        return None
    path.write_text(body, encoding="utf-8", newline="\n")
    return path


def _note_id(utterance: str) -> str:
    return hashlib.sha256(utterance.strip().encode("utf-8")).hexdigest()[:8]


def _already_noted(folder: Path, utterance: str) -> bool:
    if not folder.is_dir():
        return False
    for path in folder.glob("*.md"):
        if not path.is_file():
            continue
        try:
            body = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        if utterance in body:
            return True
    return False


def _note_body(utterance: str, score: int) -> str:
    if score == 0 and _looks_like_work(utterance):
        reason = "No local skill matched. Utterance looks like a work-order or contractor request."
    elif score == 0:
        reason = "No local skill matched."
    else:
        reason = f"Top local match scored {score}, below the usable line."
    return f"From: reachy-sim\nUtterance: {utterance.strip()}\n{reason}\n"


def _looks_like_work(utterance: str) -> bool:
    text = utterance.lower()
    return "work order" in text or "work-order" in text or "contractor" in text
