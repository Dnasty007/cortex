"""Turn a sealed Cortex pack into Rocky text files. No network calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


class RockyError(Exception):
    """The pack failed a check, or a requested file could not be read."""


def header(pack: Path) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"Cortex Rocky Adapter\n{pack.resolve()} {stamp}\n"


def load_manifest(pack: Path) -> dict:
    path = pack / "manifest.json"
    if not pack.is_dir():
        raise RockyError(f"Pack directory not found: {pack}")
    if not path.is_file():
        raise RockyError(f"manifest.json is missing: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RockyError(f"manifest.json could not be read: {path}") from error
    if not isinstance(data, dict):
        raise RockyError(f"manifest.json is not a JSON object: {path}")
    return data


def birth_check(pack: Path) -> dict:
    """Verify a sealed pack before any output file is created."""
    manifest = load_manifest(pack)
    seal = manifest.get("pattern_sha256")
    if "pattern_sha256" not in manifest or not isinstance(seal, str) or not seal.strip():
        raise RockyError("Rocky only accepts sealed packs. manifest.json has no pattern_sha256 field.")
    for name in ("jobs", "profiles"):
        if (pack / name).is_dir():
            raise RockyError(f"Rocky refuses a pack that contains a {name} directory.")
    files = manifest.get("files")
    if not isinstance(files, list):
        raise RockyError("Birth check failed. manifest.files is missing.")
    for item in files:
        if not isinstance(item, dict):
            raise RockyError("Birth check failed. A manifest.files entry is not an object.")
        rel = str(item.get("path") or "")
        expect = str(item.get("sha256") or "")
        if not rel or not expect:
            raise RockyError("Birth check failed. A manifest.files entry has no path or sha256.")
        target = pack.joinpath(*rel.split("/"))
        if not target.is_file():
            raise RockyError(f"Birth check failed. Missing file: {rel}")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest.lower() != expect.lower():
            raise RockyError(f"Birth check failed. SHA-256 does not match: {rel}")
    return manifest


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise RockyError(f"Could not read {path}") from error


def present(pack: Path, names: tuple[str, ...]) -> list[str]:
    found = []
    for name in names:
        path = pack.joinpath(*name.split("/"))
        if path.is_file():
            found.append(read_text(path))
    return found


def write_text(out: Path, name: str, text: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / name).write_text(text, encoding="utf-8", newline="\n")


def joined(parts: list[str], separator: str) -> str:
    trimmed = [part[:-1] if part.endswith("\n") else part for part in parts]
    if not trimmed:
        return ""
    body = separator.join(trimmed)
    if not body.endswith("\n"):
        body += "\n"
    return body


def write_soul(pack: Path, out: Path) -> None:
    birth_check(pack)
    parts = present(pack, ("SOUL.md", "CLAUDE.md", "AGENTS.md"))
    text = header(pack) + "System prompt generated from Cortex pack\n" + joined(parts, "\n\n")
    write_text(out, "rocky_system_prompt.txt", text)


def write_memory(pack: Path, out: Path) -> None:
    birth_check(pack)
    parts = present(pack, ("memories/MEMORY.md", "memories/USER.md"))
    if not parts:
        print("warning: the pack has no memory", file=sys.stderr)
    text = header(pack) + "Session memory from Cortex pack\n" + joined(parts, "\n---\n")
    write_text(out, "rocky_memory_block.txt", text)


TRIGGER_LINE = re.compile(r"^(?:trigger|hotword):(.*)$")
FENCE = re.compile(r"^\s*```")
TRIGGER_WORD = re.compile(r"(?i)\btrigger\b")


def add_hotword(found: list[str], seen: set[str], value: str) -> None:
    cleaned = " ".join(value.split())
    if not cleaned:
        return
    key = cleaned.casefold()
    if key in seen:
        return
    seen.add(key)
    found.append(cleaned)


def hotwords_in(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    fenced = False
    for line in text.splitlines():
        if FENCE.match(line):
            fenced = not fenced
            continue
        match = TRIGGER_LINE.match(line)
        if match:
            add_hotword(found, seen, match.group(1))
        if not fenced or "##" not in line:
            continue
        phrase, comment = line.split("##", 1)
        if TRIGGER_WORD.search(comment):
            add_hotword(found, seen, phrase)
    return found


def collect_hotwords(pack: Path) -> list[str]:
    skills = pack / "skills"
    if not skills.is_dir():
        return []
    found: list[str] = []
    seen: set[str] = set()
    paths = sorted((path for path in skills.rglob("SKILL.md") if path.is_file()), key=lambda path: path.as_posix().casefold())
    for path in paths:
        for word in hotwords_in(read_text(path)):
            add_hotword(found, seen, word)
    found.sort(key=str.casefold)
    return found


def write_hotwords(pack: Path, out: Path) -> None:
    birth_check(pack)
    words = collect_hotwords(pack)
    if words:
        body = "".join(f"{word}\n" for word in words)
    else:
        print("warning: no hotwords found", file=sys.stderr)
        body = "no hotwords found\n"
    write_text(out, "rocky_hotwords.txt", header(pack) + body)


COMMANDS = {
    "soul": write_soul,
    "memory": write_memory,
    "hotwords": write_hotwords,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rocky_adapter")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        command = sub.add_parser(name)
        command.add_argument("--pack", required=True, type=Path)
        command.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        COMMANDS[args.command](args.pack, args.out)
    except RockyError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
