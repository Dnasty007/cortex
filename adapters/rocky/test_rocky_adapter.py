"""Checks for the Rocky adapter. Uses a temp folder, never a live home."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scanner"))

from pack_brain import build_pack  # noqa: E402

ADAPTER = Path(__file__).resolve().parent / "rocky_adapter.py"
PATTERN_LOCK = "b171a331b51288424e50c57f3e8b52a1c0b60e2dac0041be270d88b9dff0a19f"
TRIGGER = "lantern"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


class RockyAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="rocky-adapter-"))
        self.home = self.tmp / "home"
        self.pack = self.tmp / "pack"
        self.out = self.tmp / "out"
        self.lock = self.tmp / "pattern.lock"
        self.lock.write_text(PATTERN_LOCK + "\n", encoding="utf-8", newline="\n")
        self._old_lock = os.environ.get("CORTEX_PATTERN_LOCK")
        os.environ["CORTEX_PATTERN_LOCK"] = str(self.lock)
        write(self.home / "SOUL.md", "Voice stays plain.\n")
        write(self.home / "memories" / "MEMORY.md", "token: abcdefghijklmnop\nThe work continues.\n")
        write(self.home / "memories" / "USER.md", "Reach ray@example.com or 215-555-0199.\n")
        write(
            self.home / "skills" / "general" / "demo" / "SKILL.md",
            "---\nname: demo\n---\nUse key sk-abcdefghijklmnopqrstuvwxyz.\ntrigger: lantern\n",
        )
        build_pack(self.home, self.pack, "Rocky")

    def tearDown(self) -> None:
        if self._old_lock is None:
            os.environ.pop("CORTEX_PATTERN_LOCK", None)
        else:
            os.environ["CORTEX_PATTERN_LOCK"] = self._old_lock
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_adapter(self, command: str, pack: Path, out: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(ADAPTER), command, "--pack", str(pack), "--out", str(out)],
            capture_output=True,
            text=True,
        )

    def test_three_commands_read_the_sealed_pack(self) -> None:
        for command in ("soul", "memory", "hotwords"):
            result = self.run_adapter(command, self.pack, self.out)
            self.assertEqual(result.returncode, 0, result.stderr)
        prompt = (self.out / "rocky_system_prompt.txt").read_text(encoding="utf-8")
        self.assertTrue(prompt.strip())
        self.assertIn("Voice stays plain.", prompt)
        self.assertTrue(prompt.startswith("Cortex Rocky Adapter\n"))
        memory = (self.pack / "memories" / "MEMORY.md").read_text(encoding="utf-8").rstrip("\n")
        user = (self.pack / "memories" / "USER.md").read_text(encoding="utf-8").rstrip("\n")
        block = (self.out / "rocky_memory_block.txt").read_text(encoding="utf-8")
        self.assertIn(memory + "\n---\n" + user, block)
        hot = (self.out / "rocky_hotwords.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(sum(1 for line in hot if line == TRIGGER), 1)

    def test_a_bad_checksum_writes_nothing(self) -> None:
        bad = self.tmp / "bad-pack"
        shutil.copytree(self.pack, bad)
        manifest_path = bad / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        target = manifest["files"][0]["path"]
        manifest["files"][0]["sha256"] = "0" * 64
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8", newline="\n")
        for command in ("soul", "memory", "hotwords"):
            out = self.tmp / f"untouched-{command}"
            out.mkdir()
            marker = out / "keep.txt"
            marker.write_text("keep\n", encoding="utf-8")
            result = self.run_adapter(command, bad, out)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(target, result.stderr)
            self.assertEqual(list(out.iterdir()), [marker])
            self.assertFalse((out / "rocky_system_prompt.txt").exists())
            self.assertFalse((out / "rocky_memory_block.txt").exists())
            self.assertFalse((out / "rocky_hotwords.txt").exists())

    def test_unsealed_packs_and_home_directories_write_nothing(self) -> None:
        bare = self.tmp / "bare-pack"
        shutil.copytree(self.pack, bare)
        manifest_path = bare / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.pop("pattern_sha256", None)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8", newline="\n")
        jobs = self.tmp / "jobs-pack"
        shutil.copytree(self.pack, jobs)
        (jobs / "jobs").mkdir()
        profiles = self.tmp / "profiles-pack"
        shutil.copytree(self.pack, profiles)
        (profiles / "profiles").mkdir()
        for pack in (bare, jobs, profiles):
            out = self.tmp / f"out-{pack.name}"
            result = self.run_adapter("soul", pack, out)
            self.assertNotEqual(result.returncode, 0, pack.name)
            self.assertFalse(out.exists(), pack.name)


if __name__ == "__main__":
    unittest.main()
