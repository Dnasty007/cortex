"""Load a Cortex pack after the birth checksum check."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


class CortexLoadError(Exception):
    """The pack failed the birth check or a skill could not be read."""


_TOKEN = re.compile(r"[a-z0-9]{2,}")
_CLOSED = ("jobs", "profiles")


class CortexLoader:
    """Read one pack directory and answer skill questions from its files."""

    def __init__(self, pack: str | Path) -> None:
        self.pack = Path(pack)
        self._manifest = self._birth_check(self.pack)
        self._skills = self._load_skills(self.pack, self._manifest)

    def list_loaded_skills(self) -> list[str]:
        """Return skill names in manifest order."""
        return [skill["name"] for skill in self._skills]

    def get_skill_context(self, query: str) -> str:
        """Return the text of skills that share keywords with the query."""
        wanted = set(_TOKEN.findall(query.lower()))
        if not wanted:
            return ""
        ranked: list[tuple[int, int, str]] = []
        for index, skill in enumerate(self._skills):
            score = len(wanted & skill["tokens"])
            if score:
                ranked.append((score, -index, skill["text"]))
        ranked.sort(reverse=True)
        return "\n\n".join(text for _, _, text in ranked)

    def _birth_check(self, pack: Path) -> dict:
        """Verify manifest.files checksums and refuse a jobs or profiles directory."""
        if not pack.is_dir():
            raise CortexLoadError(f"Pack directory not found: {pack}")
        self._refuse_closed_directories(pack)
        manifest_path = pack / "manifest.json"
        if not manifest_path.is_file():
            raise CortexLoadError(f"manifest.json is missing: {manifest_path}")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise CortexLoadError(f"manifest.json could not be read: {manifest_path}") from error
        if not isinstance(manifest, dict):
            raise CortexLoadError(f"manifest.json is not a JSON object: {manifest_path}")
        files = manifest.get("files")
        if not isinstance(files, list):
            raise CortexLoadError("Birth check failed. manifest.files is missing.")
        root = pack.resolve()
        for item in files:
            if not isinstance(item, dict):
                raise CortexLoadError("Birth check failed. A manifest.files entry is not an object.")
            rel = str(item.get("path") or "")
            expect = str(item.get("sha256") or "")
            if not rel or not expect:
                raise CortexLoadError(
                    f"Birth check failed. A manifest.files entry has no path or sha256: {rel or '(blank)'}"
                )
            target = self._pack_file(root, rel)
            if not target.is_file():
                raise CortexLoadError(f"Birth check failed. Missing file: {rel}")
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            if digest.lower() != expect.lower():
                raise CortexLoadError(f"Birth check failed. SHA-256 does not match: {rel}")
        return manifest

    def _refuse_closed_directories(self, pack: Path) -> None:
        for directory in pack.rglob("*"):
            if directory.is_dir() and directory.name in _CLOSED:
                rel = directory.relative_to(pack).as_posix()
                raise CortexLoadError(
                    f"Birth check refused. The pack contains a {directory.name} directory: {rel}"
                )

    def _pack_file(self, root: Path, rel: str) -> Path:
        parts = Path(rel).parts
        if not parts or rel.startswith(("/", "\\")) or ".." in parts or "\\" in rel:
            raise CortexLoadError(f"Birth check failed. SHA-256 does not match: {rel}")
        target = root.joinpath(*parts)
        try:
            resolved = target.resolve()
        except OSError as error:
            raise CortexLoadError(f"Birth check failed. Missing file: {rel}") from error
        if resolved != root and root not in resolved.parents:
            raise CortexLoadError(f"Birth check failed. SHA-256 does not match: {rel}")
        return target

    def _load_skills(self, pack: Path, manifest: dict) -> list[dict]:
        skills = []
        root = pack.resolve()
        for item in manifest["files"]:
            rel = str(item.get("path") or "")
            name = str(item.get("skill") or "").strip()
            kind = str(item.get("type") or "")
            if not (name or kind == "skill" or rel.endswith("SKILL.md")):
                continue
            if not name:
                parent = Path(rel).parent.name
                name = parent or Path(rel).name
            target = self._pack_file(root, rel)
            try:
                text = target.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                raise CortexLoadError(f"Could not read skill file: {rel}") from error
            tokens = set(_TOKEN.findall(f"{name}\n{text}".lower()))
            skills.append({"name": name, "text": text, "tokens": tokens})
        return skills
