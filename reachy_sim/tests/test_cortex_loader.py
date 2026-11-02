"""Birth check and skill lookup for a Cortex pack."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from reachy_sim.cortex_loader import CortexLoadError, CortexLoader


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _write(pack: Path, rel: str, text: str) -> str:
    path = pack / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return _sha(text)


def _manifest(pack: Path, files: list[dict]) -> None:
    (pack / "manifest.json").write_text(
        json.dumps({"format": "cortex-pack-2", "files": files}),
        encoding="utf-8",
    )


def _good_pack(root: Path) -> Path:
    pack = root / "pack"
    walk = "Tripod gait moves alternating legs.\n"
    lease = "Philadelphia rental license renewal.\n"
    files = [
        {
            "path": "skills/walk/SKILL.md",
            "sha256": _write(pack, "skills/walk/SKILL.md", walk),
            "skill": "walk",
        },
        {
            "path": "skills/lease/SKILL.md",
            "sha256": _write(pack, "skills/lease/SKILL.md", lease),
            "skill": "lease",
        },
    ]
    _manifest(pack, files)
    return pack


def test_loader_lists_skills_and_ranks_context(tmp_path: Path) -> None:
    loader = CortexLoader(_good_pack(tmp_path))
    assert loader.list_loaded_skills() == ["walk", "lease"]
    assert loader.get_skill_context("rental license") == "Philadelphia rental license renewal.\n"
    assert "Tripod" in loader.get_skill_context("tripod gait")
    assert loader.get_skill_context("zzzz-unmatched") == ""


def test_corrupted_checksum_exits_nonzero(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    skill = pack / "skills" / "walk" / "SKILL.md"
    skill.write_text("Tampered gait text.\n", encoding="utf-8", newline="\n")
    root = Path(__file__).resolve().parents[2]
    completed = subprocess.run(
        [sys.executable, "-m", "reachy_sim.sim_runner", "--pack", str(pack)],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert completed.returncode != 0
    assert "skills/walk/SKILL.md" in completed.stderr


def test_birth_check_refuses_a_corrupted_file(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    skill = pack / "skills" / "walk" / "SKILL.md"
    skill.write_text("Tampered gait text.\n", encoding="utf-8", newline="\n")
    with pytest.raises(CortexLoadError, match="skills/walk/SKILL.md"):
        CortexLoader(pack)


def test_birth_check_refuses_jobs_directory(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    jobs = pack / "jobs"
    jobs.mkdir()
    (jobs / "night.txt").write_text("queue\n", encoding="utf-8")
    with pytest.raises(CortexLoadError, match="jobs"):
        CortexLoader(pack)


def test_birth_check_refuses_profiles_directory(tmp_path: Path) -> None:
    pack = _good_pack(tmp_path)
    (pack / "profiles").mkdir()
    with pytest.raises(CortexLoadError, match="profiles"):
        CortexLoader(pack)
