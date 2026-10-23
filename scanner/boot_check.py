"""Read-only birth check.

Looks for ASK.json, STOP.json, and BIRTH.md. Does not write a birth,
delete a file, copy a folder, or start an agent.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

TRIO = ("ASK.json", "STOP.json", "BIRTH.md")
LOADER_NAMES = frozenset({"loader.py", "start.bat", "gateway.py", "run.bat"})
LIVE_FILES = frozenset({"auth.json", "config.yaml"})
STOP_READ_LIMIT = 1_500_000


def _norm(path: str) -> str:
    text = os.path.normcase(os.path.normpath(path))
    prefix = os.path.normcase("\\\\?\\")
    if text.startswith(prefix):
        text = text[len(prefix) :]
    return text


def _real(path: Path) -> str:
    try:
        return _norm(os.path.realpath(path))
    except OSError:
        return ""


def _contains(root_norm: str, child_norm: str) -> bool:
    if not root_norm or not child_norm:
        return False
    try:
        return os.path.commonpath([root_norm, child_norm]) == root_norm
    except ValueError:
        return False


def _is_link(path: Path) -> bool:
    try:
        if path.is_symlink():
            return True
    except OSError:
        return True
    junction = getattr(path, "is_junction", None)
    try:
        return bool(junction and junction())
    except OSError:
        return True


def _reparse(path: Path) -> bool:
    """True for a symlink or junction. Does not open the target."""
    if _is_link(path):
        return True
    try:
        parent = os.path.realpath(path.parent)
        own = os.path.realpath(path)
    except OSError:
        return True
    if not parent or not own:
        return True
    expected = _norm(os.path.join(parent, path.name))
    return _norm(own) != expected


def _regular_file(path: Path) -> bool:
    if _is_link(path):
        return False
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode)


def _stays(root: Path, path: Path) -> bool:
    return _contains(_real(root), _real(path))


def _loader_name(name: str) -> bool:
    folded = name.casefold()
    if folded in LOADER_NAMES:
        return True
    stem = folded.split(".", 1)[0]
    return folded == "autostart" or stem == "autostart"


def _entries_look_live(entries) -> bool:
    for entry in entries:
        name = entry.name.casefold()
        if name in LIVE_FILES:
            return True
        if name != "sessions":
            continue
        try:
            if entry.is_dir(follow_symlinks=False):
                return True
        except OSError:
            return True
    return False


def _stop_says_loader_false(path: Path) -> bool:
    if _reparse(path) or not _regular_file(path):
        return False
    try:
        info = path.lstat()
    except OSError:
        return False
    if not stat.S_ISREG(info.st_mode) or info.st_size > STOP_READ_LIMIT:
        return False
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return False
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return False
    return isinstance(data, dict) and data.get("loader") is False


def check_birth(folder) -> dict:
    """Return ok, missing, loader_files, and outside. Reads no file body."""
    root = Path(folder)
    outside: list[str] = []
    if _is_link(root) or (_reparse(root) and root.exists()):
        outside = ["."]
        root_is_dir = False
    else:
        try:
            root_is_dir = root.is_dir()
        except OSError:
            root_is_dir = False
    if not root_is_dir:
        return {
            "ok": False,
            "missing": list(TRIO),
            "loader_files": [],
            "outside": outside,
        }

    root = Path(os.path.abspath(root))
    loaders: list[str] = []
    top: dict[str, Path] = {}
    seen: set[str] = set()
    stack = [root]
    while stack:
        current = stack.pop()
        current_id = _real(current) or _norm(os.path.abspath(current))
        if current_id in seen:
            continue
        if current != root and not _stays(root, current):
            continue
        seen.add(current_id)
        try:
            with os.scandir(current) as scan:
                entries = list(scan)
        except OSError:
            continue
        at_top = current_id == (_real(root) or _norm(os.path.abspath(root)))
        for entry in entries:
            path = Path(entry.path)
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                outside.append(entry.name)
                continue
            if rel == ".." or rel.startswith("../"):
                outside.append(rel)
                continue
            if at_top:
                top[entry.name] = path
            try:
                linked = bool(entry.is_symlink())
            except OSError:
                linked = True
            if not linked and _reparse(path):
                linked = True
            leaves = not _stays(root, path)
            if linked or leaves:
                if leaves:
                    outside.append(rel)
                if _loader_name(entry.name):
                    loaders.append(rel)
                continue
            if _loader_name(entry.name):
                loaders.append(rel)
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
            except OSError:
                continue
            # sessions marks a live home. Do not list or open what is inside.
            if is_dir and entry.name.casefold() == "sessions":
                continue
            if is_dir:
                stack.append(path)

    missing = []
    for name in TRIO:
        path = top.get(name)
        if path is None or not _regular_file(path) or not _stays(root, path):
            missing.append(name)
    return {
        "ok": not missing,
        "missing": missing,
        "loader_files": sorted(set(loaders), key=str.casefold),
        "outside": sorted(set(outside), key=str.casefold),
    }


def boot_report(folder) -> dict:
    """Report a birth folder. Writes nothing.

    auth.json, config.yaml, or a sessions directory means a live home.
    Those entries are not read. Otherwise report BIRTH.md, STOP.json,
    and whether STOP.json says loader false.
    """
    result = {
        "ok": False,
        "refusal": "",
        "BIRTH.md": False,
        "STOP.json": False,
        "loader_false": False,
    }
    root = Path(folder)
    try:
        linked_root = _is_link(root) or (root.exists() and _reparse(root))
    except OSError:
        linked_root = True
    if linked_root:
        result["refusal"] = "That path leaves the folder."
        return result
    try:
        if not root.is_dir():
            return result
    except OSError:
        return result
    try:
        with os.scandir(root) as scan:
            entries = list(scan)
    except OSError:
        return result
    if _entries_look_live(entries):
        result["refusal"] = "That folder is a live home."
        return result
    names = {entry.name: Path(entry.path) for entry in entries}
    birth = names.get("BIRTH.md")
    stop = names.get("STOP.json")
    birth_ok = bool(birth and _regular_file(birth) and _stays(root, birth) and not _reparse(birth))
    stop_ok = bool(stop and _regular_file(stop) and _stays(root, stop) and not _reparse(stop))
    result["BIRTH.md"] = birth_ok
    result["STOP.json"] = stop_ok
    # Read STOP.json only after BIRTH.md is a real file in this folder.
    if birth_ok and stop_ok:
        result["loader_false"] = _stop_says_loader_false(stop)
    result["ok"] = birth_ok and stop_ok and result["loader_false"]
    return result


def _format_report(birth: dict, home: dict) -> str:
    def shown(values: list[str]) -> str:
        return ", ".join(values) if values else "none"

    ok = bool(birth["ok"]) and home["refusal"] == ""
    lines = [
        f"ok: {str(ok).lower()}",
        f"missing: {shown(birth['missing'])}",
        f"loader_files: {shown(birth['loader_files'])}",
        f"outside: {shown(birth['outside'])}",
    ]
    if home["refusal"]:
        lines.append(f"refusal: {home['refusal']}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv if argv is None else argv)
    if len(args) != 2:
        print("usage: python scanner\\boot_check.py <folder>", file=sys.stderr)
        return 2
    folder = args[1]
    birth = check_birth(folder)
    home = boot_report(folder)
    print(_format_report(birth, home), end="")
    ok = bool(birth["ok"]) and home["refusal"] == ""
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
