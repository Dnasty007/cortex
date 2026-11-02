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
# These overlap almost every file. They never count as a skill match.
STOP_WORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "if",
        "is",
        "are",
        "was",
        "be",
        "to",
        "of",
        "in",
        "on",
        "for",
        "with",
        "use",
        "local",
    }
)


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
        """Return the text of skills that share a content word with the query."""
        return "\n\n".join(skill["text"] for skill in self._rank(query))

    def best_match(self, query: str) -> str | None:
        """Return the loaded skill title with the strongest content-word overlap."""
        ranked = self._rank(query)
        if not ranked:
            return None
        return str(ranked[0]["name"])

    def _rank(self, query: str) -> list[dict]:
        wanted = _content_tokens(query)
        if not wanted:
            return []
        ranked: list[tuple[int, int, dict]] = []
        for index, skill in enumerate(self._skills):
            score = len(wanted & skill["tokens"])
            if score < 1:
                continue
            ranked.append((score, -index, skill))
        ranked.sort(reverse=True)
        return [skill for _, _, skill in ranked]

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
            title, description = _title_and_description(name, text)
            tokens = _content_tokens(f"{name}\n{title}\n{description}")
            skills.append({"name": name, "text": text, "tokens": tokens})
        return skills


def _content_tokens(text: str) -> set[str]:
    """Keep tokens that can identify a skill. Stop words are dropped."""
    return {token for token in _TOKEN.findall(text.lower()) if token not in STOP_WORDS}


def _title_and_description(name: str, text: str) -> tuple[str, str]:
    """Title is the skill name. Description is the frontmatter line, or the body."""
    title = name
    body = text
    description = ""
    if text.startswith("---\n"):
        end = text.find("\n---", 3)
        if end != -1:
            raw = text[4:end]
            body = text[end + 4 :]
            if body.startswith("\n"):
                body = body[1:]
            for line in raw.splitlines():
                if line.startswith("description:"):
                    description = line.split(":", 1)[1].strip().strip("\"'")
                elif line.startswith("name:"):
                    found = line.split(":", 1)[1].strip().strip("\"'")
                    if found:
                        title = found
    header = body.find(":::cortex\n")
    if 0 <= header <= 4000:
        close = body.find("\n:::\n", header)
        if close != -1:
            body = body[:header] + body[close + 5 :]
    if not description:
        description = body.strip()
    return title, description
