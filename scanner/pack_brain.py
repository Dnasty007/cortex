"""Build a portable Cortex pack from a Hermes home. Does not modify that home.

The pack copies skills, user rules, soul, and memory. Secrets, emails, and
phone numbers are stripped. Sessions, jobs, profiles, config, and transcripts
stay behind. Installing a pack refuses a folder that already looks like a
live Hermes home.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

SECRET = re.compile(
    r"(?i)(api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+"
    r"|token\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._\-]{12,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9]{12,}"
    r"|xai-[a-z0-9]{12,}|bws_[a-z0-9_\-]{8,}|AKIA[0-9A-Z]{16})"
)
EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\b\d{10,11}\b")
SKIP_NAME = re.compile(r"(?i)(auth\.json|\.env$|credential|google_token|client_secret)")

FORMAT = "cortex-pack-2"
MAX_BYTES = 1_500_000
MEMORY_FILES = ("memories/USER.md", "memories/MEMORY.md", "SOUL.md")
GENERATED = {"BIRTH.md", "START.md", "GROW.md", "ASK.md", "ASK.json", "STOP.json"}
REQUIRED = {"BIRTH.md"}
GROWTH_ROOT = "growth"
SECRET_MARKS = {
    "auth.json",
    ".env",
    ".env.local",
    "credentials.json",
    "client_secret.json",
    "secrets.json",
    "id_ed25519",
}
BIRTH = """Cortex transplant

This folder is a transplant, not the source runtime.
Do not start a gateway.
Do not read a home outside this folder.
These lines are advice. This file does not stop a skill, a gateway, or a read.
STOP.json does not stop a tool. If it names a tool file, that file binds only the agent that reads it.
Read STOP.json, then this file, then the soul, the memory, and the skills.
The soul is SOUL.md. Memory is memories/USER.md and memories/MEMORY.md. Each skill is only its SKILL.md.
Files beside a skill, other than SKILL.md, stayed in the original folder. If the task needs one, stop and ask.
do_not_schedule names a skill a job used. Do not start that job. You may open that skill when the person names it.
STOP.json does not stop a send, a push, or a delete.
The trust boundary is the computer that built the pack.
At install, the bytes are checked against the packing list.
After install, a rewritten list can hide an edit. There is no loader.
Secrets the pattern cannot see may remain.
A skill runs only when a person names its title. Nothing starts itself.
"""

START_WHO = {
    "hermes": "Hermes",
    "claude": "Claude",
    "cursor": "Cursor",
    "agents": "Codex",
    "skills": "the agent",
}


def open_line(kind: str) -> str:
    return {
        "hermes": "In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.",
        "claude": "In the Claude desktop app, open the Code tab, select the top entry in the Local group, then on the project folder control select Open folder…, and choose this folder. Read the Cortex note at the top of CLAUDE.md. That note is the instruction.",
        "cursor": "Open Cursor, click File, then Open Folder, and select this folder. Read the Cortex note at the top of the rule or AGENTS.md. That note is the instruction.",
        "agents": "Change into this folder in a terminal, then run codex. Read the Cortex note at the top of AGENTS.md first. That note is the instruction.",
        "skills": "Change into this folder in a terminal, then start the agent from this folder.",
    }.get(kind, "Change into this folder in a terminal, then start the agent from this folder.")


READ_GROWTH = "Read GROW.md, then read the files named in growth/kept.md. Those files are in growth/accepted/."


def start_text(kind: str) -> str:
    who = START_WHO.get(kind, "the agent")
    return (
        f"Point {who} at this folder as a new session.\n"
        f"{open_line(kind)}\n"
        "This is a birth, not the live agent.\n"
        "Do not copy these files onto an agent that is already running.\n"
        f"{READ_GROWTH}\n"
        "Read STOP.json, then BIRTH.md, then the soul, the memory, and the skills.\n"
        "The soul is SOUL.md. Memory is memories/USER.md and memories/MEMORY.md. Each skill is only its SKILL.md.\n"
        "STOP.json does not stop a send, a push, or a delete. Nothing starts itself.\n"
    )


GROW = f"""This folder is a downloaded brain.

Point another AI at this folder. It reads this file, then START.md, then STOP.json, then BIRTH.md, then the soul, the memory, and the skills.
The soul is SOUL.md. Memory is memories/USER.md and memories/MEMORY.md. Each skill is only its SKILL.md.
Keys, chats, and jobs stayed in the original folder. Do not copy this folder onto an AI that is already running. Nothing starts itself.

{READ_GROWTH}
To grow, write one note as a new file in growth/pending/. One note per file. The person accepts or rejects it in Cortex.
An accepted note is kept in growth/accepted/. The names are listed in growth/kept.md. Read those after memory. A rejected note is closed. You cannot accept your own note.
Do not edit memories/MEMORY.md. Do not start a job. If a task needs a file that is not here, stop and ask.
"""


GATE_REL = {
    "claude": ".claude/settings.json",
    "cursor": ".cursor/sandbox.json",
    "agents": ".codex/rules/cortex-stop.rules",
}


def gate_body(kind: str) -> str | None:
    if kind == "claude":
        payload = {"permissions": {"deny": ["Bash(git push *)", "Bash(rm *)"]}}
        return json.dumps(payload, indent=2) + "\n"
    if kind == "cursor":
        payload = {
            "networkPolicy": {
                "default": "deny",
                "deny": ["github.com", "*.github.com", "gitlab.com", "*.gitlab.com"],
            }
        }
        return json.dumps(payload, indent=2) + "\n"
    if kind == "agents":
        return (
            "prefix_rule(\n"
            "    pattern = [\"git\", \"push\"],\n"
            "    decision = \"forbidden\",\n"
            "    justification = \"Stop and ask before a push. This rule does not stop a send.\",\n"
            "    match = [\"git push\", \"git push origin main\"],\n"
            "    not_match = [\"git status\"],\n"
            ")\n"
            "prefix_rule(\n"
            "    pattern = [\"rm\"],\n"
            "    decision = \"forbidden\",\n"
            "    justification = \"Stop and ask before a delete. A shell string can still hide one.\",\n"
            "    match = [\"rm -rf build\"],\n"
            "    not_match = [\"git status\"],\n"
            ")\n"
        )
    return None


def gate_record(kind: str) -> dict:
    body = {
        "claude": {
            "file": GATE_REL["claude"],
            "binds": "Claude Code reads permissions.deny in this folder. The list names a Bash command that starts with git push or rm. It does not stop every push or every delete.",
            "does_not": "It does not stop git -C, a quoted push, /bin/rm, or bash -c. It does not stop a send. It does not bind Cursor, Codex, or Hermes.",
        },
        "cursor": {
            "file": GATE_REL["cursor"],
            "binds": "Cursor reads this sandbox file for this workspace. Network default is deny while the sandbox is on. Turning the sandbox off leaves the file unread.",
            "does_not": "It does not stop a delete. It does not stop a push that never uses the network. The sandbox can be turned off. It does not bind Claude, Codex, or Hermes.",
        },
        "agents": {
            "file": GATE_REL["agents"],
            "binds": "Codex loads this rules file only after the project .codex layer is trusted. Until then the file does nothing.",
            "does_not": "Until that layer is trusted, the file does nothing. It does not stop a send. It does not bind Claude, Cursor, or Hermes.",
        },
    }.get(kind)
    if body:
        return body
    return {
        "file": "",
        "binds": "This birth has no tool file. Hermes and a generic agent do not read a deny list from this folder.",
        "does_not": "Stop and ask before you send, push, or delete. This file does not stop those tools.",
    }


def loaded_note(kind: str, titles: set[str], held: list[str], jobs: int, rules_only: bool) -> str:
    shown = sorted({item for item in titles if item}, key=str.casefold)[:40]
    kept = [item for item in held if item][:40]
    where = {
        "hermes": "This note is at the top of SOUL.md. Hermes loads this file.",
        "claude": "This note is at the top of CLAUDE.md. Claude loads this file.",
        "agents": "This note is at the top of AGENTS.md. Codex loads this file.",
        "cursor": "This note is at the top of the file Cursor loads.",
    }.get(kind, "This note is at the top of the file this agent loads.")
    memory = "Memory stayed in the original folder." if rules_only else "Memory was copied when memories/USER.md or memories/MEMORY.md was in the original folder."
    title_line = ", ".join(shown) if shown else "none"
    held_line = ", ".join(kept) if kept else "none"
    return (
        "Cortex note.\n"
        f"{where}\n"
        "This folder is a transplant. Keys, chats, jobs, and config are not here.\n"
        f"{READ_GROWTH}\n"
        f"Skill titles in this folder: {title_line}.\n"
        "Each skill is only its SKILL.md. Files beside a skill stayed in the original folder. If the task needs one, stop and ask.\n"
        f"Held back: {held_line}. Do not fetch a held title.\n"
        f"{memory}\n"
        f"Jobs left behind: {jobs}. Their names are not here. If the task needs one, stop and ask.\n"
        "Stop and ask a person before a send, a push, or a delete. Nothing in this folder stops those.\n"
        "Nothing starts itself. Do not start a gateway. Do not read a home outside this folder.\n"
        "\n"
    )


def loads_on_open(kind: str, posix: str) -> bool:
    table = {
        "hermes": {"SOUL.md"},
        "claude": {"CLAUDE.md"},
        "agents": {"AGENTS.md"},
        "cursor": {"AGENTS.md"},
    }
    if posix in table.get(kind, set()):
        return True
    return kind == "cursor" and posix.startswith(".cursor/rules/") and posix.endswith((".md", ".mdc"))


def stamp_loaded(text: str, note: str) -> str:
    if text.startswith("Cortex note."):
        return text
    body = text.lstrip("\ufeff")
    if body.startswith("---"):
        end = body.find("\n---", 3)
        if end != -1:
            insert_at = end + 4
            return text[:insert_at] + "\n\n" + note + text[insert_at:]
    return note + text


def strip_note(text: str) -> str:
    if text.startswith("Cortex note.\n"):
        mark = text.find("\n\n")
        return "" if mark == -1 else text[mark + 2 :]
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            insert_at = end + 4
            rest = text[insert_at:]
            if rest.startswith("\n\nCortex note.\n"):
                mark = rest.find("\n\n", 2)
                if mark != -1:
                    return text[:insert_at] + rest[mark + 2 :]
    return text


def restamp_loaded(out: Path, kind: str, files: list[dict], note: str) -> None:
    if residue(note):
        raise PackError("The loaded note still matches the secret pattern.")
    for item in files:
        rel = str(item.get("path") or "")
        if not loads_on_open(kind, rel):
            continue
        path = out / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if not text.strip() and rel not in {"SOUL.md", "CLAUDE.md", "AGENTS.md"}:
            continue
        stamped = stamp_loaded(text, note)
        data = stamped.encode("utf-8")
        path.write_bytes(data)
        item["bytes"] = len(data)
        item["sha256"] = byte_hash(data)


def voice_line(text: str) -> str:
    body = text.lstrip("\ufeff")
    if body.startswith("---"):
        end = body.find("\n---", 3)
        if end == -1:
            return ""
        body = body[end + 4 :]
    for raw in body.splitlines():
        line = raw.strip().strip("\"'")
        if not line or line.startswith("#"):
            continue
        if len(line) > 140:
            return ""
        cleaned, counts = scrub(line)
        if any(counts.values()) or cleaned != line or residue(cleaned):
            return ""
        return line
    return ""


def ask_text(kind: str, titles: set[str], notes: list[str], redactions: int, jobs: int, rules_only: bool = False, held: list[str] | None = None, voice: str = "") -> str:
    shown: list[str] = []
    for title in titles:
        label = " ".join(title.split())[:80]
        if not label or SECRET.search(label) or EMAIL.search(label) or PHONE.search(label):
            label = "redacted title"
        if label not in shown:
            shown.append(label)
    shown.sort(key=str.casefold)
    if len(shown) > 80:
        extra = len(shown) - 80
        shown = shown[:80]
        shown.append(f"{extra} more titles are in this folder")
    lines = []
    if voice:
        lines.append(voice)
    lines.extend([
        open_line(kind),
        "Do not copy these files into the agent you are already running.",
        READ_GROWTH,
        "Read STOP.json, then BIRTH.md, then the soul, the memory, and the skills. Open a skill only when its title is the task. Nothing starts itself. There is no loader.",
        "The soul is SOUL.md. Memory is memories/USER.md and memories/MEMORY.md. Each skill is only its SKILL.md.",
        "do_not_schedule names a skill a job used. Do not start that job. You may open that skill when the person names it.",
        "Files beside a skill, other than SKILL.md, stayed in the original folder. If the task needs one, stop and ask.",
        "Memory was not copied. If the task needs a past decision, stop and ask." if rules_only else "Memory in this folder is listed under instruction files. A decision that was not packed is not here.",
        f"Jobs left behind: {jobs}. Their names are not in this folder. If the task needs one of them, stop and ask.",
        f"Lines stripped: {redactions}.",
        "Instruction files:",
    ])
    named = [mask_secret_path(name) for name in sorted(set(notes))]
    lines.extend(f"- {name}" for name in named)
    if not named:
        lines.append("- none")
    lines.append("Skill titles:")
    lines.extend(f"- {title}" for title in shown)
    if not shown:
        lines.append("- none")
    kept: list[str] = []
    for title in held or []:
        label = " ".join(str(title).split())[:80]
        if not label or SECRET.search(label) or EMAIL.search(label) or PHONE.search(label):
            label = "redacted title"
        if label not in kept:
            kept.append(label)
    lines.append("Held back:")
    lines.extend(f"- {title}" for title in kept)
    if not kept:
        lines.append("- none")
    lines.append("Do not fetch a held title. Do not reconstruct it.")
    record = gate_record(kind)
    if record.get("file"):
        lines.append(record["does_not"])
    else:
        lines.append("This birth has no tool file.")
    lines.append("STOP.json does not stop a send, a push, or a delete.")
    lines.append("ASK.json is this same note in a form you can parse.")
    lines.append("")
    return "\n".join(lines)


def ask_card(kind: str, titles: set[str], notes: list[str], redactions: int, jobs: int, rules_only: bool = False, held: list[str] | None = None, voice: str = "") -> str:
    who = START_WHO.get(kind, "the agent")
    shown: list[str] = []
    for title in titles:
        label = " ".join(str(title).split())[:80]
        if not label or SECRET.search(label) or EMAIL.search(label) or PHONE.search(label):
            label = "redacted title"
        if label not in shown:
            shown.append(label)
    shown.sort(key=str.casefold)
    kept: list[str] = []
    for title in held or []:
        label = " ".join(str(title).split())[:80]
        if not label or SECRET.search(label) or EMAIL.search(label) or PHONE.search(label):
            label = "redacted title"
        if label not in kept:
            kept.append(label)
    payload = {
        "advice": open_line(kind) + " Do not copy these files into the agent you are already running. Open a skill only when its title is the task. Nothing starts itself. There is no loader.",
        "for": who,
        "format": "cortex-ask-1",
        "held": kept[:80],
        "home": kind if kind in START_WHO else "agent",
        "instruction_files": [mask_secret_path(name) for name in sorted(set(notes))][:40],
        "jobs_left_behind": jobs if type(jobs) is int else 0,
        "lines_stripped": redactions if type(redactions) is int else 0,
        "loader": False,
        "rules_only": bool(rules_only),
        "skill_titles": shown[:80],
        "titles_more": max(0, len(shown) - 80),
    }
    if voice:
        payload["voice"] = voice
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if residue(text):
        raise PackError("The ask card still matches the secret pattern.")
    return text


def stop_card(kind: str, holes: list[dict], jobs: int, rules_only: bool, held: list[str], scheduled: list[str]) -> str:
    who = START_WHO.get(kind, "the agent")
    shown_holes = []
    for item in holes[:80]:
        if isinstance(item, dict):
            row = dict(item)
            row["path"] = mask_secret_path(row.get("path"))
            shown_holes.append(row)
        else:
            shown_holes.append(item)
    payload = {
        "do_not_schedule": scheduled[:40],
        "for": who,
        "format": "cortex-stop-1",
        "held": held[:80],
        "holes": shown_holes,
        "jobs_left_behind": jobs if type(jobs) is int else 0,
        "gate": gate_record(kind),
        "loader": False,
        "refuse": (
            "Do not fill a hole from this chat, from memory, or from the live home. "
            "do_not_schedule names a skill a job used. Do not start that job. You may open that skill when the person names it. "
            "Do not copy this folder into the home you were already using. "
            "Do not fetch or reconstruct a held title. "
            "Do not start a gateway. Do not read a home outside this folder. There is no loader. "
            "Stop and ask before you send, push, or delete. This file does not stop those tools."
        ),
        "stops_tools": False,
        "rules_only": bool(rules_only),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if residue(text):
        raise PackError("The stop card still matches the secret pattern.")
    return text

INSTALL = """Cortex transplant

This folder is skills, user rules, soul, and memory.
The pattern in this program stripped matches it could see.
That pattern does not prove every secret was found.
Transcripts, jobs, profiles, config, and job names stayed in the original home.

BIRTH.md is advice. It does not enforce itself.
At install, the bytes are checked. This program does not keep checking after that.
Place this pack into an empty folder that is not inside or beside a live agent home.
Hermes, Claude, Codex, and Cursor each keep their own file names.
Config, MCP, and chats stay in the original home.
Do not copy this pack onto a live agent home.
Read STOP.json, then BIRTH.md, then the soul, the memory, and the skills.
Read GROW.md, then read the files named in growth/kept.md. Those files are in growth/accepted/.
The soul is SOUL.md. Memory is memories/USER.md and memories/MEMORY.md. Each skill is only its SKILL.md.
STOP.json does not stop a send, a push, or a delete.
A new file under growth/ is growth. The report is not a loader.
Any other new file is reported as takeover.
A changed packed file is tamper.
"""


class PackError(Exception):
    pass


def is_under(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def is_drive_root(path: Path) -> bool:
    resolved = path.resolve()
    return resolved.parent == resolved


def scrub(text: str) -> tuple[str, dict[str, int]]:
    counts = {"secret": 0, "email": 0, "phone": 0}
    text, counts["secret"] = SECRET.subn("[redacted]", text)
    text, counts["email"] = EMAIL.subn("[email]", text)
    text, counts["phone"] = PHONE.subn("[phone]", text)
    return text, counts


def add_counts(total: dict[str, int], extra: dict[str, int]) -> None:
    for key, value in extra.items():
        total[key] = total.get(key, 0) + value


def normalized_text(path: Path) -> str:
    if path.stat().st_size > MAX_BYTES:
        raise PackError("too large")
    raw = path.read_bytes()
    if b"\0" in raw:
        raise PackError("binary")
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")


def read_scrubbed(path: Path) -> tuple[bytes, dict[str, int]]:
    cleared, counts = scrub(normalized_text(path))
    return cleared.encode("utf-8"), counts


def scrub_rel(rel: Path) -> Path:
    parts = []
    for part in rel.parts:
        if SECRET.search(part) or EMAIL.search(part) or PHONE.search(part):
            digest = hashlib.sha256(part.encode("utf-8")).hexdigest()[:8]
            parts.append(f"redacted-{digest}")
        else:
            parts.append(part)
    cleaned = Path(*parts)
    text = cleaned.as_posix()
    if not residue(text):
        return cleaned
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
    token = f"redacted-{digest}"
    if text.endswith("/SKILL.md") and text.startswith(".claude/skills/"):
        return Path(".claude") / "skills" / token / "SKILL.md"
    if text.endswith("/SKILL.md") and text.startswith(".agents/skills/"):
        return Path(".agents") / "skills" / token / "SKILL.md"
    if text.endswith("/SKILL.md") and text.startswith("skills/"):
        return Path("skills") / token / "SKILL.md"
    if text.startswith(".cursor/rules/") and text.endswith(".mdc"):
        return Path(".cursor") / "rules" / f"{token}.mdc"
    if text.startswith(".cursor/rules/") and text.endswith(".md"):
        return Path(".cursor") / "rules" / f"{token}.md"
    return Path(token)


ALLOWED_DOT = {".claude", ".cursor", ".agents", ".codex"}


def safe_rel(rel: Path) -> bool:
    parts = rel.parts
    if not parts:
        return False
    for part in parts:
        if part in ("..", ""):
            return False
        if part.startswith(".") and part not in ALLOWED_DOT:
            return False
    return True


def assert_separate(home: Path, out: Path) -> None:
    if is_drive_root(home) or is_drive_root(out):
        raise PackError("Choose a folder, not a whole drive.")
    if is_under(home, out) or is_under(out, home):
        raise PackError("The pack folder has to sit outside the Hermes home.")


def iter_skill_files(home: Path, root_rel: str = "skills") -> tuple[list[tuple[Path, Path]], list[dict]]:
    skills_root = home.joinpath(*Path(root_rel).parts)
    found: list[tuple[Path, Path]] = []
    skipped: list[dict] = []
    if not skills_root.is_dir():
        return found, skipped
    seen: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(skills_root, followlinks=True):
        current = Path(dirpath)
        real = os.path.realpath(dirpath)
        if real in seen:
            dirnames[:] = []
            continue
        seen.add(real)
        if not is_under(home, current):
            dirnames[:] = []
            skipped.append({"path": "skills", "reason": "link outside the home"})
            continue
        kept = []
        for name in dirnames:
            if name.startswith("."):
                continue
            child = current / name
            if child.is_symlink() and not is_under(home, child):
                skipped.append({"path": str(child.relative_to(home)), "reason": "link outside the home"})
                continue
            kept.append(name)
        dirnames[:] = kept
        if "SKILL.md" not in filenames:
            continue
        path = current / "SKILL.md"
        if SKIP_NAME.search(path.name) or not is_under(home, path):
            skipped.append({"path": "skills", "reason": "left behind"})
            continue
        try:
            rel = Path(root_rel) / path.resolve().relative_to(skills_root.resolve())
        except ValueError:
            skipped.append({"path": "skills", "reason": "link outside the home"})
            continue
        if not safe_rel(rel):
            skipped.append({"path": "skills", "reason": "unsafe path"})
            continue
        found.append((path, scrub_rel(rel)))
    return found, skipped


def write_file(out: Path, rel: Path, text: str) -> None:
    if not safe_rel(rel):
        raise PackError("unsafe pack path")
    dest = out / rel
    if not is_under(out, dest):
        raise PackError("pack path escaped")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8", newline="\n")


def residue(text: str) -> bool:
    return bool(SECRET.search(text) or EMAIL.search(text) or PHONE.search(text))


def byte_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pattern_text() -> str:
    return "\n".join((SECRET.pattern, EMAIL.pattern, PHONE.pattern))


def pattern_lock_path() -> Path:
    override = os.environ.get("CORTEX_PATTERN_LOCK", "").strip()
    if override:
        return Path(override)
    return Path.home() / ".cortex" / "pattern.lock"


def pattern_lock_hash() -> str:
    path = pattern_lock_path()
    if not path.is_file() or path.is_symlink():
        raise PackError("The pattern lock is not on this computer.")
    token = path.read_text(encoding="utf-8").strip().split()
    held = token[0] if token else ""
    if not re.fullmatch(r"[0-9a-f]{64}", held):
        raise PackError("The pattern lock is not a hash.")
    live = byte_hash(pattern_text().encode("utf-8"))
    if held != live:
        raise PackError("The pattern on this computer does not match the pattern lock.")
    return held


def assert_pattern_frozen() -> None:
    pattern_lock_hash()


def contract_body(manifest: dict) -> str:
    body = {
        "files": [
            {"path": item.get("path"), "bytes": item.get("bytes"), "sha256": item.get("sha256")}
            for item in manifest.get("files") or []
        ],
        "home": manifest.get("home"),
        "jobs_left_behind": manifest.get("jobs_left_behind") or 0,
        "pattern_sha256": manifest.get("pattern_sha256"),
        "read": manifest.get("read"),
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def contract_hash(manifest: dict) -> str:
    return byte_hash(contract_body(manifest).encode("utf-8"))


def skill_title(text: str, rel: Path) -> str:
    match = re.search(r"(?m)^name:\s*(.+)$", text)
    if not match:
        return rel.parent.name
    value = match.group(1).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value[:80]


def jobs_left_behind(home: Path, titles: set[str]) -> list[dict]:
    rows = []
    for job in load_jobs_local(home / "cron" / "jobs.json"):
        listed = job.get("skills") if isinstance(job.get("skills"), list) else []
        names = [str(item) for item in listed if isinstance(item, str)]
        if isinstance(job.get("skill"), str) and job["skill"] not in names:
            names.append(job["skill"])
        used = [name for name in names if name in titles]
        if not used:
            continue
        raw_name = str(job.get("name") or job.get("id") or "job")[:80]
        label, _counts = scrub(raw_name)
        if residue(label):
            label = "job"
        rows.append({"job": label, "skills": used[:8]})
        if len(rows) >= 40:
            break
    return rows


def load_jobs_local(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    jobs = data.get("jobs", []) if isinstance(data, dict) else data
    if isinstance(jobs, dict):
        jobs = list(jobs.values())
    return [job for job in jobs if isinstance(job, dict)]


def iter_rule_files(home: Path) -> tuple[list[tuple[Path, Path]], list[dict]]:
    root = home / ".cursor" / "rules"
    found: list[tuple[Path, Path]] = []
    skipped: list[dict] = []
    if not root.is_dir():
        return found, skipped
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        if not is_under(home, current):
            skipped.append({"path": ".cursor/rules", "reason": "link outside the home"})
            dirnames[:] = []
            continue
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        for name in filenames:
            if not name.endswith((".md", ".mdc")):
                continue
            path = current / name
            if path.is_symlink() or not is_under(home, path):
                skipped.append({"path": name, "reason": "link left behind"})
                continue
            try:
                rel = Path(".cursor") / "rules" / path.resolve().relative_to(root.resolve())
            except ValueError:
                skipped.append({"path": name, "reason": "link outside the home"})
                continue
            if not safe_rel(rel):
                skipped.append({"path": rel.as_posix(), "reason": "unsafe path"})
                continue
            found.append((path, scrub_rel(rel)))
    return found, skipped


def craft_plan(home: Path, kind: str) -> tuple[list[tuple[Path, Path]], list[dict], list[str]]:
    skill_roots = {
        "hermes": ["skills"],
        "claude": [".claude/skills", "skills"],
        "cursor": [],
        "agents": [".agents/skills", "skills"],
        "skills": ["skills"],
    }.get(kind, ["skills"])
    root_files = {
        "hermes": MEMORY_FILES,
        "claude": ("CLAUDE.md",),
        "cursor": ("AGENTS.md",),
        "agents": ("AGENTS.md",),
        "skills": (),
    }.get(kind, ())
    planned: list[tuple[Path, Path]] = []
    skipped: list[dict] = []
    missing: list[str] = []
    for root in skill_roots:
        found, skips = iter_skill_files(home, root)
        planned.extend(found)
        skipped.extend(skips)
    if kind == "cursor":
        found, skips = iter_rule_files(home)
        planned.extend(found)
        skipped.extend(skips)
    for rel_text in root_files:
        source = home / rel_text
        if source.is_file() and not source.is_symlink():
            planned.append((source, Path(rel_text)))
        elif source.is_symlink():
            skipped.append({"path": rel_text, "reason": "link left behind"})
        elif kind == "hermes":
            missing.append(rel_text)
    return planned, skipped, missing


def build_pack(home: Path, out: Path, label: str, rules_only: bool = False, hold: set[str] | None = None) -> dict:
    assert_pattern_frozen()
    home = home.resolve()
    out = out.resolve()
    if not home.is_dir():
        raise PackError("Agent home not found.")
    kind = home_kind(home)
    if not kind:
        raise PackError("That folder does not look like an agent home.")
    assert_separate(home, out)
    if out.exists() and any(out.iterdir()):
        raise PackError("The pack folder already has files. Choose a new one.")
    out.mkdir(parents=True, exist_ok=True)

    counts = {"secret": 0, "email": 0, "phone": 0}
    files: list[dict] = []
    missing: list[str] = []
    skipped: list[dict] = []

    try:
        planned, skill_skips, missing = craft_plan(home, kind)
        skipped.extend(skill_skips)

        titles: set[str] = set()
        notes: list[str] = []
        held_keys = {item.casefold() for item in (hold or set()) if str(item).strip()}
        held_shown: list[str] = []
        holes: list[dict] = []
        voice = ""
        standing = {"hermes": "SOUL.md", "claude": "CLAUDE.md", "cursor": "AGENTS.md", "agents": "AGENTS.md"}.get(kind, "")
        for source, rel in planned:
            if SKIP_NAME.search(source.name):
                skipped.append({"path": rel.as_posix(), "reason": "secret-shaped name"})
                continue
            try:
                original = normalized_text(source)
            except PackError as error:
                skipped.append({"path": rel.as_posix(), "reason": str(error)})
                continue
            text, file_counts = scrub(original)
            if residue(text):
                raise PackError("A file still had a secret or a contact after stripping.")
            posix = rel.as_posix()
            data = text.encode("utf-8")
            if rules_only and posix in {"memories/USER.md", "memories/MEMORY.md"}:
                skipped.append({"path": posix, "reason": "memory stayed behind"})
                continue
            if posix.endswith("/SKILL.md"):
                raw_title = skill_title(original, rel)
                title = skill_title(text, rel)
                if raw_title.casefold() in held_keys or title.casefold() in held_keys:
                    label_text = " ".join(raw_title.split())[:80]
                    if not label_text or residue(label_text):
                        label_text = "redacted title"
                    if label_text not in held_shown:
                        held_shown.append(label_text)
                    skipped.append({"path": posix, "reason": "held back"})
                    continue
                titles.add(title)
            write_file(out, rel, text)
            add_counts(counts, file_counts)
            if any(file_counts.values()):
                holes.append({
                    "path": posix,
                    "secret": file_counts.get("secret") or 0,
                    "email": file_counts.get("email") or 0,
                    "phone": file_counts.get("phone") or 0,
                })
            if posix == standing:
                voice = voice_line(source.read_text(encoding="utf-8"))
            if posix in INSTRUCTION_FILES or (posix.startswith(".cursor/rules/") and posix.endswith((".md", ".mdc"))):
                notes.append(posix)
            files.append({
                "path": rel.as_posix(),
                "bytes": len(data),
                "sha256": byte_hash(data),
                "redactions": sum(file_counts.values()),
            })

        if not files:
            raise PackError("Nothing safe to pack.")

        left_rows = jobs_left_behind(home, titles)
        left_behind = len(left_rows)
        scheduled: list[str] = []
        for row in left_rows:
            for name in row.get("skills") or []:
                label_text = " ".join(str(name).split())[:80]
                if not label_text or SECRET.search(label_text) or EMAIL.search(label_text) or PHONE.search(label_text):
                    label_text = "redacted title"
                if label_text not in scheduled:
                    scheduled.append(label_text)
        scheduled.sort(key=str.casefold)
        restamp_loaded(out, kind, files, loaded_note(kind, titles, held_shown, left_behind, rules_only))
        ask = ask_text(kind, titles, notes, sum(counts.values()), left_behind, rules_only, held_shown, voice)
        write_file(out, Path("ASK.md"), ask)
        ask_bytes = ask.encode("utf-8")
        card = ask_card(kind, titles, notes, sum(counts.values()), left_behind, rules_only, held_shown, voice)
        write_file(out, Path("ASK.json"), card)
        card_bytes = card.encode("utf-8")
        files.insert(0, {
            "path": "ASK.json",
            "bytes": len(card_bytes),
            "sha256": byte_hash(card_bytes),
            "redactions": 0,
        })
        files.insert(1, {
            "path": "ASK.md",
            "bytes": len(ask_bytes),
            "sha256": byte_hash(ask_bytes),
            "redactions": 0,
        })

        start = start_text(kind)
        write_file(out, Path("START.md"), start)
        start_bytes = start.encode("utf-8")
        files.insert(2, {
            "path": "START.md",
            "bytes": len(start_bytes),
            "sha256": byte_hash(start_bytes),
            "redactions": 0,
        })
        if residue(GROW):
            raise PackError("GROW.md still matches the secret pattern.")
        write_file(out, Path("GROW.md"), GROW)
        grow_bytes = GROW.encode("utf-8")
        files.insert(3, {
            "path": "GROW.md",
            "bytes": len(grow_bytes),
            "sha256": byte_hash(grow_bytes),
            "redactions": 0,
        })
        stop = stop_card(kind, holes, left_behind, rules_only, held_shown, scheduled)
        write_file(out, Path("STOP.json"), stop)
        stop_bytes = stop.encode("utf-8")
        files.insert(0, {
            "path": "STOP.json",
            "bytes": len(stop_bytes),
            "sha256": byte_hash(stop_bytes),
            "redactions": 0,
        })
        gate = gate_body(kind)
        if gate:
            if residue(gate):
                raise PackError("The tool file still matches the secret pattern.")
            rel = Path(GATE_REL[kind])
            write_file(out, rel, gate)
            gate_bytes = gate.encode("utf-8")
            files.append({
                "path": rel.as_posix(),
                "bytes": len(gate_bytes),
                "sha256": byte_hash(gate_bytes),
                "redactions": 0,
            })

        birth = BIRTH.encode("utf-8")
        write_file(out, Path("BIRTH.md"), BIRTH)
        files.append({
            "path": "BIRTH.md",
            "bytes": len(birth),
            "sha256": byte_hash(birth),
            "redactions": 0,
        })

        shown_label, _label_counts = scrub((label or "")[:80] or "Hermes")
        if residue(shown_label) or not shown_label.strip():
            shown_label = "Hermes"
        manifest = {
            "format": FORMAT,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "label": shown_label,
            "home": kind,
            "read": "full-file",
            "pattern_sha256": pattern_lock_hash(),
            "moves": ["skills", "instructions"] if rules_only else ["skills", "instructions", "memory"],
            "stays": (["memory"] if rules_only else []) + ["sessions", "transcripts", "jobs", "profiles", "config", "mcp", "vault", "auth"],
            "jobs_left_behind": left_behind,
            "rules_only": bool(rules_only),
            "held": held_shown,
            "files": files,
            "missing": [mask_secret_path(item) for item in missing],
            "skipped": [mask_skipped(item) for item in skipped[:80]],
            "redactions": counts,
            "note": "The source home was not modified. At install, the bytes are checked. The pattern does not prove every secret was found.",
        }
        manifest["contract"] = contract_hash(manifest)
        write_file(out, Path("manifest.json"), json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        write_file(out, Path("INSTALL.txt"), INSTALL)
        return manifest
    except Exception:
        shutil.rmtree(out, ignore_errors=True)
        raise


def allowed_install_rel(rel: str) -> bool:
    path = Path(rel)
    if not safe_rel(path):
        return False
    text = path.as_posix()
    if text in ("memories/USER.md", "memories/MEMORY.md", "SOUL.md", "BIRTH.md", "START.md", "GROW.md", "ASK.md", "ASK.json", "STOP.json", "CLAUDE.md", "AGENTS.md"):
        return True
    if text.startswith("skills/") and text.endswith("/SKILL.md"):
        return True
    if text.startswith(".claude/skills/") and text.endswith("/SKILL.md"):
        return True
    if text.startswith(".agents/skills/") and text.endswith("/SKILL.md"):
        return True
    if text.startswith(".cursor/rules/") and text.endswith((".md", ".mdc")):
        return True
    return text in set(GATE_REL.values())


def assert_pack_shape(manifest: dict) -> None:
    assert_pattern_frozen()
    if manifest.get("format") != FORMAT:
        raise PackError("This pack format is not supported.")
    if manifest.get("pattern_sha256") != pattern_lock_hash():
        raise PackError("This pack was built for a different pattern.")
    banned = ("left_behind", "seal", "residue", "clearance", "source_sha256", "pattern_version")
    if any(key in manifest for key in banned):
        raise PackError("This pack has a pack-1 shape.")
    if type(manifest.get("jobs_left_behind")) is not int:
        raise PackError("This pack has a pack-1 shape.")
    names = []
    for item in manifest.get("files") or []:
        if not isinstance(item, dict) or "source_sha256" in item:
            raise PackError("This pack has a pack-1 shape.")
        names.append(str(item.get("path") or ""))
    if not REQUIRED.issubset(names):
        raise PackError("The pack is missing BIRTH.md.")


def read_pack_files(pack: Path, manifest: dict) -> list[tuple[str, bytes]]:
    rows = []
    for item in manifest.get("files") or []:
        rel = str(item.get("path") or "")
        if not allowed_install_rel(rel):
            raise PackError("The pack listed a file that cannot be installed.")
        source = pack / rel
        if not regular_file(source) or not is_under(pack, source):
            raise PackError("The pack contains a link or a non-regular file.")
        data = source.read_bytes()
        if residue(data.decode("utf-8", errors="replace")):
            raise PackError("The pack still contains a secret or a contact.")
        expected = str(item.get("sha256") or "")
        if not re.fullmatch(r"[0-9a-f]{64}", expected) or byte_hash(data) != expected or len(data) != item.get("bytes"):
            raise PackError("A pack file does not match its manifest hash.")
        if rel == "BIRTH.md" and data != BIRTH.encode("utf-8"):
            raise PackError("BIRTH.md does not match the birth text this program requires.")
        if rel in set(GATE_REL.values()):
            expected = gate_body(str(manifest.get("home") or ""))
            if expected is None or rel != GATE_REL.get(str(manifest.get("home") or "")) or data != expected.encode("utf-8"):
                raise PackError("The tool file is not the gate this program writes.")
        rows.append((rel, data))
    if not rows:
        raise PackError("The pack has no files to install.")
    return rows


def install_pack(pack: Path, dest: Path) -> dict:
    pack = pack.resolve()
    dest = dest.resolve()
    manifest_path = pack / "manifest.json"
    if not manifest_path.is_file():
        raise PackError("That folder is not a Cortex pack.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert_pack_shape(manifest)
    sealed = str(manifest.get("contract") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", sealed) or sealed != contract_hash(manifest):
        raise PackError("The pack manifest does not match its packing list.")
    rows = read_pack_files(pack, manifest)
    if is_drive_root(dest) or is_under(pack, dest) or is_under(dest, pack):
        raise PackError("Choose an empty folder outside the pack.")
    if dest.exists() and is_link(dest):
        raise PackError("That folder is a link. Choose a real empty folder.")
    if looks_like_home(dest) or secret_marker(dest):
        raise PackError("That folder already looks like an agent home. Choose an empty one.")
    if inside_live_home(dest):
        raise PackError("That folder sits inside a live agent home. Choose an empty one outside it.")
    if beside_live_home(dest):
        raise PackError("That folder sits beside a live agent home. Choose an empty one away from it.")
    if dest.exists() and any(dest.iterdir()):
        raise PackError("The destination already has files. Choose an empty folder.")
    dest.mkdir(parents=True, exist_ok=True)
    try:
        for rel, data in rows:
            write_exact(dest, Path(rel), data)
            written = (dest / rel).read_bytes()
            if written != data:
                raise PackError("The bytes on disk do not match the pack.")
        write_file(dest, Path("manifest.json"), json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        install_path = pack / "INSTALL.txt"
        install_text = install_path.read_text(encoding="utf-8") if install_path.is_file() else INSTALL
        if not install_text.endswith("\n"):
            install_text += "\n"
        write_file(dest, Path("INSTALL.txt"), install_text)
        return {
            "ok": True,
            "files": len(rows),
            "contract": sealed,
            "home": manifest.get("home") or "",
            "receipt": public_receipt(manifest),
        }
    except Exception:
        shutil.rmtree(dest, ignore_errors=True)
        raise


def is_link(path: Path) -> bool:
    if path.is_symlink():
        return True
    junction = getattr(path, "is_junction", None)
    return bool(junction and junction())


def names_of(path: Path) -> set[str]:
    try:
        return {item.name.casefold() for item in path.iterdir()}
    except OSError:
        return set()


# Global ~/.claude and ~/.cursor are tool config. They do not make the user profile a project.
LIVE_DIR_NAMES = {".claude", ".cursor", ".agents", ".hermes"}


def is_real_dir(path: Path) -> bool:
    return path.is_dir() and not path.is_symlink()


def home_kind(path: Path) -> str:
    names = names_of(path)
    if "soul.md" in names or (
        "memories" in names and names_of(path / "memories").intersection({"memory.md", "user.md"})
    ):
        return "hermes"
    if (
        "claude.md" in names
        or is_real_dir(path / ".claude" / "skills")
        or is_real_dir(path / ".claude" / "commands")
    ):
        return "claude"
    if is_real_dir(path / ".cursor" / "rules") or (path / ".cursor" / "mcp.json").is_file():
        return "cursor"
    if "agents.md" in names or ".agents" in names:
        return "agents"
    if "skills" in names:
        return "skills"
    if names.intersection({"config.yaml", "profiles"}):
        return "hermes"
    return ""


def looks_like_home(path: Path) -> bool:
    return bool(home_kind(path))


def secret_marker(path: Path) -> bool:
    return bool(names_of(path).intersection(SECRET_MARKS))


def regular_file(path: Path) -> bool:
    if is_link(path) or not path.is_file():
        return False
    try:
        return path.stat().st_nlink == 1
    except OSError:
        return False


def inside_live_home(dest: Path) -> bool:
    current = dest.resolve().parent
    while current != current.parent:
        if current.name.casefold() in LIVE_DIR_NAMES or looks_like_home(current) or secret_marker(current):
            return True
        current = current.parent
    return False


def is_birth(path: Path) -> bool:
    if not path.is_dir() or path.is_symlink():
        return False
    manifest_path = path / "manifest.json"
    birth = path / "BIRTH.md"
    if not manifest_path.is_file() or manifest_path.is_symlink() or not birth.is_file() or birth.is_symlink():
        return False
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return isinstance(data, dict) and data.get("format") == FORMAT


def beside_live_home(dest: Path) -> bool:
    parent = dest.resolve().parent
    try:
        siblings = list(parent.iterdir())
    except OSError:
        return False
    resolved = dest.resolve()
    for item in siblings:
        try:
            if item.resolve() == resolved:
                continue
            if is_birth(item) and not secret_marker(item):
                continue
        except OSError:
            continue
        if looks_like_home(item) or secret_marker(item):
            return True
    return False


def write_exact(out: Path, rel: Path, data: bytes) -> None:
    if not safe_rel(rel):
        raise PackError("unsafe pack path")
    dest = out / rel
    if not is_under(out, dest):
        raise PackError("pack path escaped")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)


def cleared_hashes(home: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    planned, _skipped, _missing = craft_plan(home, home_kind(home) or "hermes")
    for source, _rel in planned:
        if SKIP_NAME.search(source.name):
            continue
        try:
            data, _counts = read_scrubbed(source)
        except (OSError, PackError):
            continue
        digest = byte_hash(data)
        counts[digest] = counts.get(digest, 0) + 1
    return counts


def extra_class(rel: str) -> str:
    parts = Path(rel).parts
    if len(parts) >= 2 and parts[0] == GROWTH_ROOT:
        return "growth"
    return "takeover"


def verify_pack(folder: Path, home: Path | None = None) -> dict:
    folder = folder.resolve()
    manifest_path = folder / "manifest.json"
    if not manifest_path.is_file():
        raise PackError("That folder has no pack manifest.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert_pack_shape(manifest)
    sealed = str(manifest.get("contract") or "")
    contract_ok = bool(re.fullmatch(r"[0-9a-f]{64}", sealed) and sealed == contract_hash(manifest))
    tamper: list[str] = []
    missing: list[str] = []
    listed: set[str] = set()
    listed_fold = set()
    matched = 0
    for item in manifest.get("files") or []:
        rel = str(item.get("path") or "")
        listed.add(rel)
        listed_fold.add(rel.casefold())
        source = folder / rel
        if not rel or not source.is_file() or is_link(source) or not is_under(folder, source):
            missing.append(rel or "file")
            continue
        data = source.read_bytes()
        expected = str(item.get("sha256") or "")
        if not re.fullmatch(r"[0-9a-f]{64}", expected) or byte_hash(data) != expected:
            tamper.append(rel)
        else:
            matched += 1
    growth: list[str] = []
    takeover: list[str] = []
    for path in folder.rglob("*"):
        if path.is_dir() and not is_link(path):
            continue
        rel = path.relative_to(folder).as_posix()
        if rel in ("manifest.json", "INSTALL.txt"):
            continue
        linked = is_link(path)
        try:
            escaped = not is_under(folder, path.resolve())
        except OSError:
            escaped = True
        if rel in listed or rel.casefold() in listed_fold:
            if linked or escaped:
                takeover.append(rel)
            continue
        if linked or escaped or extra_class(rel) == "takeover":
            takeover.append(rel)
        else:
            growth.append(rel)
        if len(growth) + len(takeover) >= 40:
            break
    stale = None
    stale_files: list[str] = []
    if home is not None:
        home = home.resolve()
        if not home.is_dir():
            raise PackError("Agent home not found.")
        live_map: dict[str, str] = {}
        kind_now = home_kind(home) or "hermes"
        fresh, _skipped, _missing = craft_plan(home, kind_now)
        for source, rel in fresh:
            if SKIP_NAME.search(source.name):
                continue
            name = rel.as_posix()
            if not name or name in GENERATED:
                continue
            try:
                data, _counts = read_scrubbed(source)
            except (OSError, PackError):
                continue
            live_map[name] = byte_hash(data)
        packed = {str(item.get("path") or "") for item in manifest.get("files") or []}
        changed: list[str] = []
        gone: list[str] = []
        for item in manifest.get("files") or []:
            rel = str(item.get("path") or "")
            if not rel or rel in GENERATED:
                continue
            expected = str(item.get("sha256") or "")
            if rel not in live_map:
                gone.append(rel)
                continue
            if loads_on_open(kind_now, rel):
                packed_path = folder / rel
                try:
                    packed_body = strip_note(packed_path.read_text(encoding="utf-8")).encode("utf-8")
                except OSError:
                    changed.append(rel)
                    continue
                if byte_hash(packed_body) != live_map[rel]:
                    changed.append(rel)
            elif live_map[rel] != expected:
                changed.append(rel)
        stale = len(changed) + len(gone)
        stale_files = (changed + gone)[:80]
        report_changed = changed[:80]
        report_gone = gone[:80]
        grew = [name for name in live_map if name not in packed][:80]
        report_grew = [mask_secret_path(name) for name in grew]
    else:
        report_grew = None
        report_changed = None
        report_gone = None
    ok = contract_ok and not tamper and not missing and not takeover and stale in (None, 0)
    report = {
        "ok": ok,
        "lock": "match" if contract_ok else "mismatch",
        "match": matched,
        "tamper": [mask_secret_path(item) for item in tamper],
        "missing": [mask_secret_path(item) for item in missing],
        "takeover": [mask_secret_path(item) for item in takeover],
        "growth": [mask_secret_path(item) for item in growth],
        "pattern_sha256": manifest.get("pattern_sha256") or "",
    }
    if stale is not None:
        report["stale"] = stale
        report["stale_files"] = [mask_secret_path(item) for item in stale_files]
    if report_grew is not None:
        report["grew"] = report_grew
        report["changed"] = [mask_secret_path(item) for item in report_changed]
        report["gone"] = [mask_secret_path(item) for item in report_gone]
    return report


SAFE_SKIP = {
    "secret-shaped name": "A file name looked like a secret and stayed behind.",
    "link outside the home": "A link pointed outside the folder and stayed behind.",
    "left behind": "A file stayed behind.",
    "link left behind": "A link stayed behind.",
    "unsafe path": "A path was unsafe and stayed behind.",
    "memory stayed behind": "Memory stayed behind. A past decision in that file was not copied.",
    "held back": "That skill was held back. It was not copied.",
}


def one_line(value: object) -> str:
    return str(value or "").replace("\r", "").replace("\n", "")


def mask_secret_path(value: object) -> str:
    raw = "" if value is None else str(value)
    flat = raw.replace("\r", "").replace("\n", "")
    if residue(raw) or residue(flat):
        return "hidden-path"
    return flat


def mask_skipped(item: object) -> object:
    if not isinstance(item, dict):
        return item
    row = dict(item)
    if str(row.get("reason") or "") == "secret-shaped name":
        row["path"] = ""
    elif "path" in row:
        row["path"] = mask_secret_path(row.get("path"))
    return row


def public_receipt(manifest: dict) -> dict:
    files = []
    for item in manifest.get("files") or []:
        if not isinstance(item, dict):
            continue
        path = mask_secret_path(item.get("path"))
        if not path:
            continue
        count = item.get("redactions") or 0
        files.append({"path": path, "redactions": count if type(count) is int else 0})
    skipped = []
    for item in (manifest.get("skipped") or [])[:40]:
        if not isinstance(item, dict):
            continue
        reason = str(item.get("reason") or "")
        note = SAFE_SKIP.get(reason, "A file stayed behind.")
        path = ""
        if reason in SAFE_SKIP and reason != "secret-shaped name":
            path = mask_secret_path(item.get("path"))
        skipped.append({"path": path, "note": note})
    jobs = manifest.get("jobs_left_behind") or 0
    missing = []
    for item in (manifest.get("missing") or [])[:20]:
        text = mask_secret_path(item)
        if text:
            missing.append(text)
    stays = [item for item in (manifest.get("stays") or []) if isinstance(item, str)]
    return {
        "home": one_line(manifest.get("home")),
        "files": files,
        "stays": stays,
        "jobs_left_behind": jobs if type(jobs) is int else 0,
        "missing": missing,
        "skipped": skipped,
        "rules_only": manifest.get("rules_only") is True,
        "held": [one_line(item) for item in (manifest.get("held") or []) if isinstance(item, str)][:40],
    }


INSTRUCTION_FILES = {"SOUL.md", "CLAUDE.md", "AGENTS.md", "memories/USER.md", "memories/MEMORY.md"}


def load_birth(path: Path) -> tuple[dict, Path]:
    path = path.resolve()
    if looks_like_home(path) and not is_birth(path):
        raise PackError("That folder is a live agent. Compare a birth, not the live agent.")
    if not is_birth(path):
        raise PackError("That folder is not a Cortex birth.")
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    assert_pack_shape(manifest)
    sealed = str(manifest.get("contract") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", sealed) or sealed != contract_hash(manifest):
        raise PackError("The pack manifest does not match its packing list.")
    if (path / "BIRTH.md").read_bytes() != BIRTH.encode("utf-8"):
        raise PackError("BIRTH.md does not match the birth text this program requires.")
    return manifest, path


def birth_side(folder: Path, manifest: dict) -> tuple[dict[str, dict], list[str]]:
    skills: dict[str, dict] = {}
    instructions: list[str] = []
    for item in manifest.get("files") or []:
        if not isinstance(item, dict):
            continue
        rel = str(item.get("path") or "").replace("\\", "/")
        if not rel or rel in GENERATED:
            continue
        if not allowed_install_rel(rel):
            raise PackError("That birth listed a file that cannot be compared.")
        source = folder / rel
        if not regular_file(source) or not is_under(folder, source):
            raise PackError("That birth is missing a packed file.")
        data = source.read_bytes()
        expected = str(item.get("sha256") or "")
        if byte_hash(data) != expected:
            raise PackError("That birth has been edited. Check it before comparing.")
        if rel in INSTRUCTION_FILES or (rel.startswith(".cursor/rules/") and rel.endswith((".md", ".mdc"))):
            instructions.append(rel)
            continue
        if not rel.endswith("/SKILL.md"):
            continue
        text = data.decode("utf-8", errors="replace")
        if residue(text):
            raise PackError("A packed skill still matches the secret pattern.")
        title = skill_title(text, Path(rel))
        if SECRET.search(title) or EMAIL.search(title) or PHONE.search(title):
            title = "redacted title"
        row = skills.setdefault(title.casefold(), {"title": title, "hashes": [], "paths": []})
        row["hashes"].append(expected)
        row["paths"].append(rel)
    return skills, instructions


def kin_report(left: Path, right: Path) -> dict:
    left_manifest, left_path = load_birth(left)
    right_manifest, right_path = load_birth(right)
    if left_path == right_path:
        raise PackError("Pick two different births.")
    left_skills, left_notes = birth_side(left_path, left_manifest)
    right_skills, right_notes = birth_side(right_path, right_manifest)
    same = []
    split = []
    only_left = []
    only_right = []
    for key in sorted(set(left_skills) | set(right_skills)):
        first = left_skills.get(key)
        second = right_skills.get(key)
        if first and second:
            row = {
                "title": first["title"],
                "first": [mask_secret_path(item) for item in first["paths"]],
                "second": [mask_secret_path(item) for item in second["paths"]],
            }
            if sorted(first["hashes"]) == sorted(second["hashes"]):
                same.append(row)
            else:
                split.append(row)
        elif first:
            only_left.append({"title": first["title"], "paths": [mask_secret_path(item) for item in first["paths"]]})
        elif second:
            only_right.append({"title": second["title"], "paths": [mask_secret_path(item) for item in second["paths"]]})
    instructions = [{"path": mask_secret_path(rel), "side": "first"} for rel in left_notes]
    instructions.extend({"path": mask_secret_path(rel), "side": "second"} for rel in right_notes)
    return {
        "ok": True,
        "first": mask_secret_path(left_manifest.get("home") or ""),
        "second": mask_secret_path(right_manifest.get("home") or ""),
        "same": same,
        "split": split,
        "only_left": only_left,
        "only_right": only_right,
        "instructions": instructions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build or install a Cortex pack.")
    parser.add_argument("--home")
    parser.add_argument("--out")
    parser.add_argument("--label", default="Hermes")
    parser.add_argument("--pack")
    parser.add_argument("--dest")
    parser.add_argument("--verify")
    parser.add_argument("--receipt")
    parser.add_argument("--kin", nargs=2, metavar=("LEFT", "RIGHT"))
    parser.add_argument("--rules-only", action="store_true")
    parser.add_argument("--hold", action="append", default=[])
    args = parser.parse_args()
    try:
        if args.kin:
            result = kin_report(Path(args.kin[0]), Path(args.kin[1]))
        elif args.receipt:
            pack = Path(args.receipt)
            manifest_path = pack / "manifest.json"
            if not manifest_path.is_file():
                raise PackError("That folder is not a Cortex pack.")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            assert_pack_shape(manifest)
            result = public_receipt(manifest)
            result["ok"] = True
            result["out"] = str(pack.resolve())
        elif args.verify:
            result = verify_pack(Path(args.verify), Path(args.home) if args.home else None)
        elif args.pack or args.dest:
            if not args.pack or not args.dest:
                raise PackError("Install needs both --pack and --dest.")
            result = install_pack(Path(args.pack), Path(args.dest))
        else:
            if not args.home or not args.out:
                raise PackError("Build needs --home and --out.")
            manifest = build_pack(Path(args.home), Path(args.out), args.label, rules_only=args.rules_only, hold=set(args.hold))
            result = {
                "ok": True,
                "files": len(manifest["files"]),
                "redactions": manifest["redactions"],
                "missing": manifest["missing"],
                "skipped": len(manifest["skipped"]),
                "home": manifest.get("home") or "",
                "jobs_left_behind": manifest.get("jobs_left_behind") or 0,
                "pattern_sha256": manifest.get("pattern_sha256") or "",
                "contract": manifest.get("contract") or "",
                "out": str(Path(args.out).resolve()),
                "receipt": public_receipt(manifest),
            }
    except PackError as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(result))


if __name__ == "__main__":
    main()
