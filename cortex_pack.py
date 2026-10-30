#!/usr/bin/env python3
"""Pack a folder of SKILL.md files into a Cortex brain.

Usage: python cortex_pack.py <skills-folder>

Writes ./cortex-pack in the current directory. Reads the source. Does not
modify it. Refuses a destination that looks like a live agent folder, sits
inside one, or sits beside one.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scanner"))

from pack_brain import (  # noqa: E402
    BIRTH,
    GROW,
    beside_live_home,
    byte_hash,
    category_regions,
    cortex_fields,
    inside_live_home,
    is_drive_root,
    is_under,
    PackError,
    looks_like_home,
    normalized_text,
    record_text,
    residue,
    scrub,
    scrub_rel,
    secret_marker,
    stop_card,
)


def skill_description(text: str) -> str:
    raw = ""
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            raw = text[3:end]
            body = text[end + 4 :]
    line = ""
    for raw_line in raw.splitlines():
        if raw_line.startswith("description:"):
            line = raw_line.split(":", 1)[1].strip().strip("\"'")
            break
    if not line:
        for raw_line in body.splitlines():
            stripped = raw_line.strip()
            if stripped and not stripped.startswith("#") and not stripped.startswith(":::"):
                line = stripped
                break
    line = " ".join(line.split())[:200]
    if not line or residue(line):
        return ""
    return line


def pack_rel(source: Path, path: Path) -> Path:
    rel = path.relative_to(source)
    if not rel.parts or rel.parts[0] != "skills":
        rel = Path("skills") / rel
    return scrub_rel(rel)


def iter_skill_files(source: Path) -> list[Path]:
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(source, followlinks=False):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        if "SKILL.md" not in filenames:
            continue
        path = Path(dirpath) / "SKILL.md"
        if path.is_symlink() or not path.is_file():
            continue
        if not is_under(source, path):
            continue
        found.append(path)
    found.sort(key=lambda item: item.as_posix().casefold())
    return found


def snapshot(folder: Path) -> list[tuple[str, int, int]]:
    rows: list[tuple[str, int, int]] = []
    if not folder.exists():
        return rows
    for dirpath, dirnames, filenames in os.walk(folder, followlinks=False):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink() or not path.is_file():
                continue
            stat = path.stat()
            rel = path.relative_to(folder).as_posix()
            rows.append((rel, stat.st_size, stat.st_mtime_ns))
    rows.sort()
    return rows


def refuse(dest: Path, source: Path) -> str:
    if is_drive_root(dest) or is_drive_root(source):
        return "Choose a folder, not a drive root."
    try:
        same = dest.resolve() == source.resolve()
        nested = is_under(source, dest) or is_under(dest, source)
    except OSError:
        same, nested = False, False
    if same or nested:
        return "Choose a pack folder outside the source."
    if dest.exists() and any(dest.iterdir()):
        return "The pack folder already has files. Choose a new one."
    if looks_like_home(dest) or secret_marker(dest):
        return "That folder already looks like an agent home. Choose an empty one."
    if inside_live_home(dest):
        return "That folder sits inside a live agent home. Choose an empty one outside it."
    if beside_live_home(dest):
        return "That folder sits beside a live agent home. Choose an empty one away from it."
    return ""


def write_pack(source: Path, dest: Path) -> dict:
    paths = iter_skill_files(source)
    packed: list[tuple[str, str, int, str]] = []
    for path in paths:
        try:
            original = normalized_text(path).lstrip("\ufeff")
        except (OSError, PackError):
            continue
        text, counts = scrub(original)
        if residue(text):
            continue
        redactions = counts["secret"] + counts["email"] + counts["phone"]
        rel = pack_rel(source, path)
        packed.append((rel.as_posix(), text, redactions, skill_description(text)))
    if not packed:
        raise SystemExit("Nothing safe to pack.")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    regions = category_regions([item[0] for item in packed])
    files: list[dict] = []
    skills: list[dict] = []
    dest.mkdir(parents=True, exist_ok=True)
    try:
        for posix, text, redactions, description in packed:
            headed, row = record_text(posix, text, regions, date, redactions)
            target = dest / posix
            if not is_under(dest, target):
                raise SystemExit("pack path escaped")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(headed, encoding="utf-8", newline="\n")
            files.append(row)
            skills.append({
                "name": row["skill"],
                "path": row["path"],
                "sha256": row["sha256"],
                "brain-region": row["brain-region"],
                "version": row["version"],
                "date": row["date"],
                "dependencies": row["dependencies"],
                "description": description,
            })
        kept_body = "Kept notes, in order. Read each file under growth/accepted/.\n"
        kept, kept_row = record_text("growth/kept.md", kept_body, regions, date)
        (dest / "growth" / "pending").mkdir(parents=True, exist_ok=True)
        (dest / "growth" / "accepted").mkdir(parents=True, exist_ok=True)
        (dest / "growth" / "kept.md").write_text(kept, encoding="utf-8", newline="\n")
        files.append(kept_row)
        birth, birth_row = record_text("BIRTH.md", BIRTH, regions, date)
        (dest / "BIRTH.md").write_text(birth, encoding="utf-8", newline="\n")
        files.append(birth_row)
        grow, grow_row = record_text("GROW.md", GROW, regions, date)
        (dest / "GROW.md").write_text(grow, encoding="utf-8", newline="\n")
        files.append(grow_row)
        stop_meta = cortex_fields("STOP.json", "", regions, date)
        stop = stop_card("skills", [], 0, False, [], [], stop_meta)
        (dest / "STOP.json").write_text(stop, encoding="utf-8", newline="\n")
        files.append({
            "path": "STOP.json",
            "bytes": len(stop.encode("utf-8")),
            "sha256": byte_hash(stop.encode("utf-8")),
            "redactions": 0,
            "type": stop_meta["type"],
            "skill": stop_meta["skill"],
            "brain-region": stop_meta["brain-region"],
            "version": stop_meta["version"],
            "date": stop_meta["date"],
            "dependencies": list(stop_meta["dependencies"]),
        })
        region_files: dict[str, list[str]] = {}
        for item in files:
            region_files.setdefault(str(item["brain-region"]), []).append(str(item["path"]))
        manifest = {
            "format": "cortex-pack-2",
            "builder": "cortex_pack.py",
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "files": files,
            "regions": [{"id": key, "files": region_files[key]} for key in sorted(region_files)],
            "skills": skills,
            "growth": {"pending": [], "accepted": []},
            "jobs": [],
            "profiles": [],
            "read": "full-file",
            "note": "The source folder was not modified. Jobs and profiles were not copied. The pattern does not prove every secret was found.",
        }
        (dest / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        return manifest
    except BaseException:
        import shutil
        shutil.rmtree(dest, ignore_errors=True)
        raise


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python cortex_pack.py <skills-folder>", file=sys.stderr)
        return 2
    source = Path(argv[1]).resolve()
    if not source.is_dir() or source.is_symlink():
        print("That folder was not found.", file=sys.stderr)
        return 2
    dest = (Path.cwd() / "cortex-pack").resolve()
    reason = refuse(dest, source)
    if reason:
        print(reason, file=sys.stderr)
        return 2
    before = snapshot(source)
    manifest = write_pack(source, dest)
    after = snapshot(source)
    if before != after:
        import shutil
        shutil.rmtree(dest, ignore_errors=True)
        print("The source folder changed. The pack was removed.", file=sys.stderr)
        return 2
    region_ids = [item["id"] for item in manifest["regions"] if str(item["id"]).startswith("frontal")]
    skill_count = len(manifest["skills"])
    print(f"neurons: {skill_count}")
    print(f"skills: {skill_count}")
    print(f"regions: {len(region_ids)}")
    print("region_ids: " + ", ".join(region_ids))
    print(f"pack: {dest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except SystemExit as exc:
        if isinstance(exc.code, str):
            print(exc.code, file=sys.stderr)
            raise SystemExit(2)
        raise
