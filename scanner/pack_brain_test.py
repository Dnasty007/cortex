"""Fixture checks for the Cortex pack. Uses a temp folder, never a live home."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from pack_brain import BIRTH, EMAIL, PHONE, SECRET, build_pack, contract_hash, init_lock, install_pack, kin_report, pattern_lock_hash, public_receipt, strip_header, verify_pack, PackError

PATTERN_LOCK = "b171a331b51288424e50c57f3e8b52a1c0b60e2dac0041be270d88b9dff0a19f"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class PackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="cortex-pack-"))
        self.home = self.tmp / "home"
        self.out = self.tmp / "pack"
        self.dest = self.tmp / "away" / "agent"
        self.lock = self.tmp / "pattern.lock"
        self.lock.write_text(PATTERN_LOCK + "\n", encoding="utf-8")
        self._old_lock = os.environ.get("CORTEX_PATTERN_LOCK")
        os.environ["CORTEX_PATTERN_LOCK"] = str(self.lock)
        write(self.home / "SOUL.md", "Voice stays plain.\n")
        write(self.home / "memories" / "USER.md", "Reach ray@example.com or 215-555-0199.\n")
        write(self.home / "memories" / "MEMORY.md", "token: abcdefghijklmnop\nThe work continues.\n")
        write(
            self.home / "skills" / "general" / "demo" / "SKILL.md",
            "---\nname: demo\n---\nUse key sk-abcdefghijklmnopqrstuvwxyz.\n",
        )
        write(
            self.home / "skills" / "general" / "box-sk-abcdefghijklmnopqrstuvwxyz" / "SKILL.md",
            "Steps only.\n",
        )
        write(self.home / "sessions" / "sessions.json", '{"session_id":"secret-chat"}')
        write(self.home / "sessions" / "chat.jsonl", "transcript line\n")
        write(self.home / "auth.json", '{"token":"should-not-copy"}')
        write(self.home / "config.yaml", "model: grok\n")
        write(
            self.home / "cron" / "jobs.json",
            json.dumps({
                "jobs": [
                    {"name": "nightly", "skills": ["demo"], "prompt": "token: abcdefghijklmnop do the round"},
                    {"name": "other", "skills": ["not-packed"], "prompt": "leave this prompt home"},
                ]
            }),
        )

    def tearDown(self) -> None:
        if self._old_lock is None:
            os.environ.pop("CORTEX_PATTERN_LOCK", None)
        else:
            os.environ["CORTEX_PATTERN_LOCK"] = self._old_lock
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_init_lock_writes_the_reference_hash(self) -> None:
        fresh = self.tmp / "fresh" / "pattern.lock"
        os.environ["CORTEX_PATTERN_LOCK"] = str(fresh)
        try:
            result = init_lock()
            self.assertTrue(result["wrote"])
            self.assertEqual(fresh.read_text(encoding="utf-8").strip(), PATTERN_LOCK)
            again = init_lock()
            self.assertFalse(again["wrote"])
            fresh.write_text(("a" * 64) + "\n", encoding="utf-8")
            with self.assertRaises(PackError) as changed:
                init_lock()
            self.assertIn(str(fresh), str(changed.exception))
            fresh.unlink()
            with self.assertRaises(PackError) as missing:
                pattern_lock_hash()
            self.assertIn(str(fresh), str(missing.exception))
        finally:
            os.environ["CORTEX_PATTERN_LOCK"] = str(self.lock)

    def test_pack_strips_and_leaves_the_home(self) -> None:
        before = (self.home / "memories" / "USER.md").read_text(encoding="utf-8")
        manifest = build_pack(self.home, self.out, "Fixture")
        self.assertEqual(before, (self.home / "memories" / "USER.md").read_text(encoding="utf-8"))
        self.assertFalse((self.out / "sessions").exists())
        self.assertFalse((self.out / "auth.json").exists())
        self.assertFalse((self.out / "config.yaml").exists())
        self.assertFalse((self.out / "cron").exists())
        user = (self.out / "memories" / "USER.md").read_text(encoding="utf-8")
        memory = (self.out / "memories" / "MEMORY.md").read_text(encoding="utf-8")
        skill = (self.out / "skills" / "general" / "demo" / "SKILL.md").read_text(encoding="utf-8")
        self.assertNotIn("ray@example.com", user)
        self.assertNotIn("215-555-0199", user)
        self.assertIn("[email]", user)
        self.assertIn("[phone]", user)
        self.assertNotIn("abcdefghijklmnop", memory)
        self.assertIn("[redacted]", memory)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", skill)
        self.assertTrue(all(len(item["sha256"]) == 64 for item in manifest["files"]))
        self.assertEqual(manifest["read"], "full-file")
        self.assertEqual(manifest["pattern_sha256"], PATTERN_LOCK)
        self.assertEqual(manifest["jobs_left_behind"], 1)
        self.assertNotIn("source_sha256", json.dumps(manifest))
        self.assertNotIn("nightly", json.dumps(manifest))
        self.assertGreaterEqual(manifest["redactions"]["secret"], 1)
        self.assertGreaterEqual(manifest["redactions"]["email"], 1)
        self.assertGreaterEqual(manifest["redactions"]["phone"], 1)
        blob = "\n".join(path.read_text(encoding="utf-8") for path in self.out.rglob("*") if path.is_file())
        self.assertNotIn("do the round", blob)
        self.assertNotIn("leave this prompt home", blob)
        self.assertNotIn("nightly", blob)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", blob)
        self.assertTrue(any(item["path"].startswith("skills/general/redacted-") for item in manifest["files"]))
        self.assertIsNone(SECRET.search(blob))
        self.assertIsNone(EMAIL.search(blob))
        self.assertIsNone(PHONE.search(blob))
        self.assertIn("Secret values in config were not loaded.", build_pack_sentence())
        soul = self.out / "SOUL.md"
        soul_row = next(item for item in manifest["files"] if item["path"] == "SOUL.md")
        self.assertEqual(soul_row["sha256"], hashlib.sha256(soul.read_bytes()).hexdigest())
        self.assertNotIn(b"\r", soul.read_bytes())
        birth = (self.out / "BIRTH.md").read_text(encoding="utf-8")
        self.assertIn("not the source runtime", birth)
        self.assertIn("These lines are advice.", birth)
        self.assertIn("computer that built the pack", birth)
        self.assertEqual(strip_header((self.out / "BIRTH.md").read_text(encoding="utf-8")), BIRTH)
        self.assertIn(":::cortex", (self.out / "BIRTH.md").read_text(encoding="utf-8"))
        self.assertTrue((self.out / "SOUL.md").read_text(encoding="utf-8").startswith("Cortex note.\n"))
        self.assertIn("brain-region: corpus", (self.out / "SOUL.md").read_text(encoding="utf-8"))
        self.assertIn("brain-region: temporal-l", (self.out / "memories" / "MEMORY.md").read_text(encoding="utf-8"))
        self.assertIn("brain-region: temporal-r", (self.out / "memories" / "USER.md").read_text(encoding="utf-8"))
        skill = next((self.out / "skills").rglob("SKILL.md"))
        skill_text = skill.read_text(encoding="utf-8")
        self.assertIn("type: skill", skill_text)
        self.assertIn("skill: demo", skill_text)
        self.assertTrue(skill_text.startswith("---\n"))
        stop = json.loads((self.out / "STOP.json").read_text(encoding="utf-8"))
        self.assertEqual(stop["format"], "cortex-stop-1")
        self.assertFalse(stop["stops_tools"])
        self.assertFalse(stop["loader"])
        self.assertEqual(stop["cortex"]["type"], "stop")
        self.assertEqual(stop["cortex"]["brain-region"], "brainstem")
        self.assertTrue((self.out / "brain-query.mjs").is_file())
        self.assertIn("regions", manifest)
        self.assertTrue(any(item["id"].startswith("temporal") for item in manifest["regions"]))
        demo_skill = next(item for item in manifest["skills"] if item["name"] == "demo")
        self.assertEqual(demo_skill["brain-region"], "frontal-l")
        self.assertEqual(len(demo_skill["sha256"]), 64)
        self.assertEqual(manifest["growth"], {"pending": [], "accepted": []})
        self.assertTrue((self.out / "GROW.md").is_file())
        grow = (self.out / "GROW.md").read_text(encoding="utf-8")
        self.assertIn("This folder is a downloaded brain.", grow)
        self.assertIn("growth/accepted/", grow)
        self.assertIn("Read GROW.md, then read the files named in growth/kept.md.", grow)
        self.assertIn("Read GROW.md, then read the files named in growth/kept.md.", (self.out / "START.md").read_text(encoding="utf-8"))
        self.assertIn("Read GROW.md, then read the files named in growth/kept.md.", soul.read_text(encoding="utf-8"))
        self.assertIn("Read GROW.md, then read the files named in growth/kept.md.", (self.out / "ASK.md").read_text(encoding="utf-8"))
        grow_row = next(item for item in manifest["files"] if item["path"] == "GROW.md")
        self.assertEqual(grow_row["redactions"], 0)
        self.assertEqual(grow_row["bytes"], len((self.out / "GROW.md").read_bytes()))
        self.assertEqual(grow_row["sha256"], hashlib.sha256((self.out / "GROW.md").read_bytes()).hexdigest())
        note = (self.out / "INSTALL.txt").read_text(encoding="utf-8")
        self.assertIn("does not prove every secret", note)
        self.assertIn("does not keep checking", note)

    def test_refuses_to_write_inside_the_home(self) -> None:
        with self.assertRaises(PackError):
            build_pack(self.home, self.home / "packs", "Fixture")
        self.assertFalse((self.home / "packs").exists())

    def test_install_into_an_empty_folder(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        result = install_pack(self.out, self.dest)
        self.assertGreaterEqual(result["files"], 4)
        self.assertEqual(len(result["contract"]), 64)
        self.assertTrue((self.dest / "SOUL.md").is_file())
        self.assertTrue((self.dest / "BIRTH.md").is_file())
        self.assertTrue((self.dest / "manifest.json").is_file())
        self.assertTrue((self.dest / "skills" / "general" / "demo" / "SKILL.md").is_file())
        for name in ("pending", "accepted", "closed"):
            packed = self.out / "growth" / name
            placed = self.dest / "growth" / name
            self.assertTrue(packed.is_dir())
            self.assertTrue(placed.is_dir())
            self.assertEqual(list(packed.iterdir()), [])
            self.assertEqual(list(placed.iterdir()), [])

    def test_install_refuses_a_changed_job_count(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["jobs_left_behind"] = 9
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(self.out, self.dest)
        self.assertFalse(self.dest.exists())

    def test_install_refuses_a_changed_file(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        soul = self.out / "SOUL.md"
        soul.write_text(soul.read_text(encoding="utf-8") + "\nchanged\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(self.out, self.dest)
        self.assertFalse(self.dest.exists())

    def test_install_refuses_an_old_pack_and_an_unknown_pattern(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["format"] = "cortex-pack-1"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(self.out, self.dest)
        self.assertFalse(self.dest.exists())
        manifest["format"] = "cortex-pack-2"
        manifest["pattern_sha256"] = "0" * 64
        manifest["contract"] = contract_hash(manifest)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(self.out, self.dest)
        self.assertFalse(self.dest.exists())
        manifest["pattern_sha256"] = PATTERN_LOCK
        manifest["files"][0]["source_sha256"] = "ab" * 32
        manifest["contract"] = contract_hash(manifest)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(self.out, self.dest)
        self.assertFalse(self.dest.exists())

    def test_verify_splits_growth_from_takeover(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        install_pack(self.out, self.dest)
        clean = verify_pack(self.dest, self.home)
        self.assertTrue(clean["ok"])
        self.assertEqual(clean["stale"], 0)
        self.assertEqual(clean["lock"], "match")
        self.assertEqual(clean["growth"], [])
        growth = self.dest / "growth"
        growth.mkdir()
        (growth / "notes.md").write_bytes(b"new work\n")
        grown = verify_pack(self.dest)
        self.assertTrue(grown["ok"])
        self.assertEqual(grown["growth"], ["growth/notes.md"])
        (self.dest / "cron.json").write_bytes(b"{}\n")
        extra = self.dest / "skills" / "general" / "demo" / "extra.md"
        extra.write_bytes(b"inside\n")
        taken = verify_pack(self.dest)
        self.assertFalse(taken["ok"])
        self.assertIn("cron.json", taken["takeover"])
        self.assertTrue(any(item.endswith("extra.md") for item in taken["takeover"]))
        self.assertTrue(extra.is_file())

    def test_verify_against_home_sees_a_changed_source(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        install_pack(self.out, self.dest)
        (self.home / "SOUL.md").write_text("Voice changed.\n", encoding="utf-8")
        report = verify_pack(self.dest, self.home)
        self.assertFalse(report["ok"])
        self.assertGreaterEqual(report["stale"], 1)
        self.assertIn("Voice changed.", (self.home / "SOUL.md").read_text(encoding="utf-8"))
        self.assertNotIn("Voice changed.", (self.dest / "SOUL.md").read_text(encoding="utf-8"))

    def test_a_newline_edit_breaks_the_byte_lock(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        install_pack(self.out, self.dest)
        soul = self.dest / "SOUL.md"
        soul.write_bytes(soul.read_bytes().replace(b"\n", b"\r\n"))
        report = verify_pack(self.dest)
        self.assertFalse(report["ok"])
        self.assertIn("SOUL.md", report["tamper"])

    def test_install_refuses_a_folder_inside_a_live_home(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        child = self.home / "born"
        child.mkdir()
        with self.assertRaises(PackError):
            install_pack(self.out, child)
        self.assertEqual(list(child.iterdir()), [])
        nest = self.tmp / "nest"
        kid = nest / "born"
        kid.mkdir(parents=True)
        write(nest / "auth.json", "{}\n")
        with self.assertRaises(PackError):
            install_pack(self.out, kid)
        self.assertEqual(list(kid.iterdir()), [])
        sibling = self.tmp / "sibling"
        with self.assertRaises(PackError):
            install_pack(self.out, sibling)
        self.assertFalse(sibling.exists())

    def test_install_refuses_a_rewritten_birth_and_a_case_marker(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        birth = self.out / "BIRTH.md"
        data = birth.read_bytes().replace(b"advice", b"orders")
        birth.write_bytes(data)
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for item in manifest["files"]:
            if item["path"] == "BIRTH.md":
                item["bytes"] = len(data)
                item["sha256"] = hashlib.sha256(data).hexdigest()
        manifest["contract"] = contract_hash(manifest)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(self.out, self.dest)
        self.assertFalse(self.dest.exists())
        shutil.rmtree(self.out)
        build_pack(self.home, self.out, "Fixture")
        nest = self.tmp / "case"
        kid = nest / "born"
        kid.mkdir(parents=True)
        write(nest / "Auth.json", "{}\n")
        with self.assertRaises(PackError):
            install_pack(self.out, kid)
        self.assertEqual(list(kid.iterdir()), [])

    def test_install_refuses_a_live_home(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        with self.assertRaises(PackError):
            install_pack(self.out, self.home)
        self.assertIn("abcdefghijklmnop", (self.home / "memories" / "MEMORY.md").read_text(encoding="utf-8"))

    def test_claude_and_cursor_keep_their_own_files(self) -> None:
        claude = self.tmp / "claude"
        write(claude / "CLAUDE.md", "Be brief. Email ray@example.com.\n")
        write(claude / ".claude" / "skills" / "demo" / "SKILL.md", "---\nname: demo\n---\nSteps.\n")
        write(claude / ".claude" / "settings.json", '{"token":"abcdefghijklmnop"}\n')
        packed = self.tmp / "claude-pack"
        manifest = build_pack(claude, packed, "Claude")
        paths = [item["path"] for item in manifest["files"]]
        self.assertEqual(manifest["home"], "claude")
        self.assertIn("CLAUDE.md", paths)
        self.assertIn(".claude/skills/demo/SKILL.md", paths)
        self.assertIn(".claude/settings.json", paths)
        gate = json.loads((packed / ".claude" / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(gate["permissions"]["deny"], ["Bash(git push *)", "Bash(rm *)"])
        self.assertNotIn("abcdefghijklmnop", (packed / ".claude" / "settings.json").read_text(encoding="utf-8"))
        self.assertNotIn("ray@example.com", (packed / "CLAUDE.md").read_text(encoding="utf-8"))
        claude_ask = (packed / "ASK.md").read_text(encoding="utf-8")
        self.assertIn("In the Claude desktop app, open the Code tab, select the top entry in the Local group, then on the project folder control select Open folder…, and choose this folder.", claude_ask)
        self.assertFalse(claude_ask.startswith("Be brief"))
        self.assertIn("- demo", claude_ask)
        self.assertIn("- CLAUDE.md", claude_ask)
        self.assertNotIn("ray@example.com", claude_ask)
        self.assertNotIn("abcdefghijklmnop", claude_ask)
        born = self.tmp / "far" / "claude"
        install_pack(packed, born)
        self.assertTrue((born / ".claude" / "skills" / "demo" / "SKILL.md").is_file())
        with self.assertRaises(PackError):
            install_pack(packed, claude)
        cursor = self.tmp / "cursor"
        write(cursor / "AGENTS.md", "Short answers.\n")
        write(cursor / ".cursor" / "rules" / "style.mdc", "Call 215-555-0199.\n")
        write(cursor / ".cursor" / "mcp.json", '{"token":"abcdefghijklmnop"}\n')
        cursor_pack = self.tmp / "cursor-pack"
        cursor_manifest = build_pack(cursor, cursor_pack, "Cursor")
        cursor_paths = [item["path"] for item in cursor_manifest["files"]]
        self.assertEqual(cursor_manifest["home"], "cursor")
        self.assertIn("AGENTS.md", cursor_paths)
        self.assertIn(".cursor/rules/style.mdc", cursor_paths)
        self.assertNotIn(".cursor/mcp.json", cursor_paths)
        self.assertNotIn("215-555-0199", (cursor_pack / ".cursor" / "rules" / "style.mdc").read_text(encoding="utf-8"))
        cursor_ask = (cursor_pack / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(cursor_ask.startswith("Short answers.\n"))
        self.assertIn("Open Cursor, click File, then Open Folder, and select this folder.", cursor_ask)
        self.assertIn("- .cursor/rules/style.mdc", cursor_ask)
        self.assertIn("Skill titles:\n- none", cursor_ask)
        self.assertNotIn("215-555-0199", cursor_ask)

    def test_global_tool_config_does_not_swallow_the_parent(self) -> None:
        profile = self.tmp / "profile"
        write(profile / ".claude" / "settings.json", '{"token":"abcdefghijklmnop"}\n')
        write(profile / ".cursor" / "argv.json", "{}\n")
        project = profile / "project"
        write(project / "CLAUDE.md", "Be brief. Email ray@example.com.\n")
        write(project / ".claude" / "skills" / "demo" / "SKILL.md", "---\nname: demo\n---\nSteps.\n")
        packed = self.tmp / "profile-pack"
        manifest = build_pack(project, packed, "Claude")
        self.assertEqual(manifest["home"], "claude")
        self.assertIn(".claude/settings.json", [item["path"] for item in manifest["files"]])
        self.assertNotIn("abcdefghijklmnop", (packed / ".claude" / "settings.json").read_text(encoding="utf-8"))
        born = profile / "empty" / "agent"
        install_pack(packed, born)
        self.assertTrue((born / "CLAUDE.md").is_file())
        self.assertNotIn("ray@example.com", (born / "CLAUDE.md").read_text(encoding="utf-8"))
        with self.assertRaises(PackError):
            install_pack(packed, project)
        with self.assertRaises(PackError):
            install_pack(packed, project / "child")
        inside_tool = profile / ".claude" / "born"
        with self.assertRaises(PackError):
            install_pack(packed, inside_tool)
        self.assertFalse(inside_tool.exists())

    def test_check_sees_a_changed_claude_file(self) -> None:
        claude = self.tmp / "claude-stale"
        write(claude / "CLAUDE.md", "Be brief.\n")
        write(claude / ".claude" / "skills" / "demo" / "SKILL.md", "---\nname: demo\n---\nSteps.\n")
        packed = self.tmp / "claude-stale-pack"
        build_pack(claude, packed, "Claude")
        dest = self.tmp / "far" / "stale"
        install_pack(packed, dest)
        (claude / "CLAUDE.md").write_text("Be brief.\nVoice changed.\n", encoding="utf-8")
        report = verify_pack(dest, claude)
        self.assertGreaterEqual(report["stale"], 1)
        self.assertIn("CLAUDE.md", report["stale_files"])
        self.assertIn("CLAUDE.md", report["changed"])
        self.assertNotIn("Voice changed.", (dest / "CLAUDE.md").read_text(encoding="utf-8"))
        write(claude / ".claude" / "skills" / "later" / "SKILL.md", "---\nname: later\n---\nAfter.\n")
        again = verify_pack(dest, claude)
        self.assertIn(".claude/skills/later/SKILL.md", again["grew"])
        self.assertFalse((dest / ".claude" / "skills" / "later" / "SKILL.md").exists())
        (claude / ".claude" / "skills" / "demo" / "SKILL.md").unlink()
        missing_skill = verify_pack(dest, claude)
        self.assertIn(".claude/skills/demo/SKILL.md", missing_skill["gone"])
        self.assertTrue((dest / ".claude" / "skills" / "demo" / "SKILL.md").is_file())

    def test_receipt_names_files_and_hides_secret_text(self) -> None:
        manifest = build_pack(self.home, self.out, "Fixture")
        receipt = public_receipt(manifest)
        paths = [item["path"] for item in receipt["files"]]
        self.assertIn("SOUL.md", paths)
        self.assertIn("memories/USER.md", paths)
        self.assertIn("BIRTH.md", paths)
        user = next(item for item in receipt["files"] if item["path"] == "memories/USER.md")
        self.assertGreaterEqual(user["redactions"], 1)
        blob = json.dumps(receipt)
        self.assertNotIn("ray@example.com", blob)
        self.assertNotIn("abcdefghijklmnop", blob)
        self.assertNotIn("sha256", blob)
        hidden = public_receipt({
            "files": [],
            "home": "hermes",
            "stays": ["auth"],
            "jobs_left_behind": 2,
            "missing": [],
            "skipped": [{"path": "skills/sk-secretname/SKILL.md", "reason": "secret-shaped name"}],
        })
        self.assertEqual(hidden["skipped"][0]["path"], "")
        self.assertIn("secret", hidden["skipped"][0]["note"])
        self.assertNotIn("sk-secretname", json.dumps(hidden))
        self.assertEqual(hidden["jobs_left_behind"], 2)
        placed = install_pack(self.out, self.dest)
        self.assertIn("SOUL.md", [item["path"] for item in placed["receipt"]["files"]])

    def test_a_birth_folder_can_sit_away_from_the_agent(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        born = self.tmp / "Cortex Births" / "hermes-1"
        result = install_pack(self.out, born)
        self.assertEqual(result["home"], "hermes")
        self.assertTrue((born / "SOUL.md").is_file())
        self.assertTrue((born / "BIRTH.md").is_file())
        self.assertIn("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.", (born / "START.md").read_text(encoding="utf-8"))
        ask = (born / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("Voice stays plain.\n"))
        self.assertIn("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.", ask)
        self.assertIn("There is no loader.", ask)
        self.assertIn("- demo", ask)
        self.assertIn("- SOUL.md", ask)
        card = json.loads((born / "ASK.json").read_text(encoding="utf-8"))
        self.assertEqual(card["format"], "cortex-ask-1")
        self.assertEqual(card["for"], "Hermes")
        self.assertIs(card["loader"], False)
        self.assertIn("demo", card["skill_titles"])
        self.assertIn("SOUL.md", card["instruction_files"])
        self.assertNotIn("ray@example.com", json.dumps(card))
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", json.dumps(card))
        stop = json.loads((born / "STOP.json").read_text(encoding="utf-8"))
        self.assertEqual(stop["format"], "cortex-stop-1")
        self.assertIs(stop["loader"], False)
        self.assertIn("demo", stop["do_not_schedule"])
        self.assertNotIn("nightly", json.dumps(stop))
        self.assertNotIn("ray@example.com", json.dumps(stop))
        self.assertNotIn("215-555-0199", json.dumps(stop))
        user_hole = next(item for item in stop["holes"] if item["path"] == "memories/USER.md")
        self.assertGreaterEqual(user_hole["email"], 1)
        self.assertGreaterEqual(user_hole["phone"], 1)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", ask)
        self.assertNotIn("ray@example.com", ask)
        self.assertNotIn("215-555-0199", ask)
        self.assertNotIn("The work continues", ask)
        self.assertNotIn("nightly", ask)
        self.assertFalse((born / "auth.json").exists())
        second = self.tmp / "Cortex Births" / "hermes-2"
        install_pack(self.out, second)
        self.assertTrue((second / "SOUL.md").is_file())

    def test_rules_only_and_a_held_skill_leave_the_home(self) -> None:
        user_before = (self.home / "memories" / "USER.md").read_bytes()
        skill_before = (self.home / "skills" / "general" / "demo" / "SKILL.md").read_bytes()
        manifest = build_pack(self.home, self.out, "Fixture", rules_only=True, hold={"demo"})
        paths = [item["path"] for item in manifest["files"]]
        self.assertNotIn("memories/USER.md", paths)
        self.assertNotIn("memories/MEMORY.md", paths)
        self.assertNotIn("skills/general/demo/SKILL.md", paths)
        self.assertIn("SOUL.md", paths)
        self.assertEqual(manifest["held"], ["demo"])
        self.assertIn("memory", manifest["stays"])
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertIn("Memory was not copied.", ask)
        self.assertIn("Held back:\n- demo", ask)
        self.assertIn("Do not fetch a held title.", ask)
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertIs(card["rules_only"], True)
        self.assertEqual(card["held"], ["demo"])
        self.assertNotIn("demo", card["skill_titles"])
        self.assertNotIn("memories/USER.md", card["instruction_files"])
        self.assertNotIn("ray@example.com", json.dumps(card))
        stop = json.loads((self.out / "STOP.json").read_text(encoding="utf-8"))
        self.assertNotIn("demo", stop["do_not_schedule"])
        self.assertEqual(stop["held"], ["demo"])
        self.assertNotIn("nightly", json.dumps(stop))
        self.assertNotIn("ray@example.com", json.dumps(stop))
        self.assertNotIn("Skill titles:\n- demo", ask)
        self.assertNotIn("ray@example.com", ask)
        self.assertNotIn("The work continues", ask)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", ask)
        self.assertNotIn("nightly", ask)
        self.assertEqual((self.home / "memories" / "USER.md").read_bytes(), user_before)
        self.assertEqual((self.home / "skills" / "general" / "demo" / "SKILL.md").read_bytes(), skill_before)
        self.assertFalse((self.out / "memories" / "USER.md").exists())
        self.assertFalse((self.out / "skills" / "general" / "demo" / "SKILL.md").exists())
        born = self.tmp / "away" / "rules"
        install_pack(self.out, born)
        self.assertTrue((born / "SOUL.md").is_file())
        self.assertFalse((born / "memories" / "USER.md").exists())
        self.assertFalse((born / "skills" / "general" / "demo" / "SKILL.md").exists())

    def test_kin_compares_titles_and_does_not_copy_bodies(self) -> None:
        hermes = self.tmp / "kin-hermes"
        claude = self.tmp / "kin-claude"
        write(hermes / "SOUL.md", "Hermes voice.\n")
        write(hermes / "skills" / "alpha" / "SKILL.md", "---\nname: alpha\n---\nalpha-same\n")
        write(hermes / "skills" / "beta" / "SKILL.md", "---\nname: beta\n---\nbeta-hermes\n")
        write(claude / "CLAUDE.md", "Claude voice.\n")
        write(claude / ".claude" / "skills" / "alpha" / "SKILL.md", "---\nname: alpha\n---\nalpha-same\n")
        write(claude / ".claude" / "skills" / "beta" / "SKILL.md", "---\nname: beta\n---\nbeta-claude\n")
        hermes_pack = self.tmp / "kin-hermes-pack"
        claude_pack = self.tmp / "kin-claude-pack"
        build_pack(hermes, hermes_pack, "Hermes")
        build_pack(claude, claude_pack, "Claude")
        hermes_birth = self.tmp / "kin-births" / "hermes"
        claude_birth = self.tmp / "kin-births" / "claude"
        install_pack(hermes_pack, hermes_birth)
        install_pack(claude_pack, claude_birth)
        before = (hermes / "SOUL.md").read_bytes()
        claude_before = (claude / "CLAUDE.md").read_bytes()
        birth_before = (claude_birth / "CLAUDE.md").read_bytes()
        report = kin_report(hermes_birth, claude_birth)
        self.assertEqual((hermes / "SOUL.md").read_bytes(), before)
        self.assertEqual((claude / "CLAUDE.md").read_bytes(), claude_before)
        self.assertEqual((claude_birth / "CLAUDE.md").read_bytes(), birth_before)
        blob = json.dumps(report)
        self.assertNotIn("alpha-same", blob)
        self.assertNotIn("beta-hermes", blob)
        self.assertNotIn("beta-claude", blob)
        self.assertIn("alpha", {item["title"] for item in report["same"]})
        self.assertIn("beta", {item["title"] for item in report["split"]})
        names = {item["path"] for item in report["instructions"]}
        self.assertIn("SOUL.md", names)
        self.assertIn("CLAUDE.md", names)
        with self.assertRaises(PackError):
            kin_report(hermes, claude_birth)
        self.assertEqual((hermes / "SOUL.md").read_bytes(), before)
        self.assertFalse((hermes_birth / "kin.json").exists())
        self.assertFalse((claude_birth / "sessions").exists())

    def test_receipt_hides_a_secret_shaped_path(self) -> None:
        secret_folder = "box-sk-abcdefghijklmnopqrstuvwxyz"
        source = self.home / "skills" / "general" / secret_folder / "SKILL.md"
        self.assertTrue(source.is_file())
        before = source.read_bytes()
        manifest = build_pack(self.home, self.out, "Fixture")
        self.assertEqual(source.read_bytes(), before)
        receipt = public_receipt(manifest)
        receipt_blob = json.dumps(receipt)
        stop_blob = (self.out / "STOP.json").read_text(encoding="utf-8")
        self.assertNotIn(secret_folder, receipt_blob)
        self.assertNotIn(secret_folder, stop_blob)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", receipt_blob)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", stop_blob)
        paths = [item["path"] for item in receipt["files"]]
        self.assertIn("SOUL.md", paths)
        self.assertTrue(any(path.startswith("skills/general/redacted-") for path in paths))
        self.assertTrue(all("\\" not in path for path in paths))

    def test_plain_soul_line_opens_ask_and_an_email_line_does_not(self) -> None:
        soul = self.home / "SOUL.md"
        write(soul, "\n\nKeep the answer short.\n")
        before = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("Keep the answer short.\n"))
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertEqual(card.get("voice"), "Keep the answer short.")
        self.assertNotIn("ray@example.com", ask)

        shutil.rmtree(self.out)
        emailed = "Write ray@example.com before you start.\nThen continue in prose.\n"
        write(soul, emailed)
        before_email = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_email)
        self.assertIn("ray@example.com", soul.read_text(encoding="utf-8"))
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        self.assertNotIn("ray@example.com", ask)
        self.assertNotIn("Then continue in prose.", ask)
        self.assertNotIn("[email] before you start", ask)
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertNotIn("voice", card)
        blob = "\n".join(path.read_text(encoding="utf-8") for path in self.out.rglob("*") if path.is_file())
        self.assertNotIn("ray@example.com", blob)
        packed_soul = (self.out / "SOUL.md").read_text(encoding="utf-8")
        self.assertIn("[email]", packed_soul)
        self.assertIn("Then continue in prose.", packed_soul)

    def test_rules_only_leaves_memory_out_and_says_so(self) -> None:
        user = self.home / "memories" / "USER.md"
        memory = self.home / "memories" / "MEMORY.md"
        user_before = user.read_bytes()
        memory_before = memory.read_bytes()
        manifest = build_pack(self.home, self.out, "Fixture", rules_only=True)
        paths = [item["path"] for item in manifest["files"]]
        self.assertNotIn("memories/USER.md", paths)
        self.assertNotIn("memories/MEMORY.md", paths)
        self.assertIn("SOUL.md", paths)
        self.assertIn("skills/general/demo/SKILL.md", paths)
        self.assertFalse((self.out / "memories" / "USER.md").exists())
        self.assertFalse((self.out / "memories" / "MEMORY.md").exists())
        self.assertIn("memory", manifest["stays"])
        self.assertNotIn("memory", manifest["moves"])
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertIn("Memory was not copied.", ask)
        self.assertNotIn("ray@example.com", ask)
        self.assertNotIn("215-555-0199", ask)
        self.assertNotIn("The work continues", ask)
        self.assertNotIn("abcdefghijklmnop", ask)
        self.assertEqual(user.read_bytes(), user_before)
        self.assertEqual(memory.read_bytes(), memory_before)
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertIs(card["rules_only"], True)
        self.assertNotIn("memories/USER.md", card["instruction_files"])
        self.assertNotIn("memories/MEMORY.md", card["instruction_files"])
        self.assertIn("SOUL.md", card["instruction_files"])

    def test_a_held_skill_is_not_copied_and_ask_forbids_reconstructing_it(self) -> None:
        skill = self.home / "skills" / "general" / "demo" / "SKILL.md"
        before = skill.read_bytes()
        manifest = build_pack(self.home, self.out, "Fixture", hold={"demo"})
        paths = [item["path"] for item in manifest["files"]]
        self.assertNotIn("skills/general/demo/SKILL.md", paths)
        self.assertFalse((self.out / "skills" / "general" / "demo" / "SKILL.md").exists())
        self.assertEqual(skill.read_bytes(), before)
        self.assertIn("sk-abcdefghijklmnopqrstuvwxyz", skill.read_text(encoding="utf-8"))
        self.assertEqual(manifest["held"], ["demo"])
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertIn("Held back:\n- demo", ask)
        self.assertIn("Do not fetch a held title. Do not reconstruct it.", ask)
        self.assertNotIn("Skill titles:\n- demo", ask)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", ask)
        self.assertNotIn("Use key", ask)
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertEqual(card["held"], ["demo"])
        self.assertNotIn("demo", card["skill_titles"])
        stop = json.loads((self.out / "STOP.json").read_text(encoding="utf-8"))
        self.assertEqual(stop["held"], ["demo"])
        self.assertIn("Do not fetch or reconstruct a held title.", stop["refuse"])
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", json.dumps(stop))
        born = self.tmp / "away" / "held"
        install_pack(self.out, born)
        self.assertFalse((born / "skills" / "general" / "demo" / "SKILL.md").exists())
        self.assertEqual(skill.read_bytes(), before)

    def test_stop_json_lists_titles_not_job_names_and_holes_are_counts(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        stop = json.loads((self.out / "STOP.json").read_text(encoding="utf-8"))
        self.assertIn("demo", stop["do_not_schedule"])
        self.assertNotIn("nightly", stop["do_not_schedule"])
        self.assertNotIn("other", stop["do_not_schedule"])
        blob = json.dumps(stop)
        self.assertNotIn("nightly", blob)
        self.assertNotIn("other", blob)
        self.assertNotIn("do the round", blob)
        self.assertNotIn("leave this prompt home", blob)
        self.assertNotIn("ray@example.com", blob)
        self.assertNotIn("215-555-0199", blob)
        self.assertNotIn("abcdefghijklmnop", blob)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz", blob)
        self.assertNotIn("box-sk-abcdefghijklmnopqrstuvwxyz", blob)
        self.assertNotIn("job", stop)
        self.assertNotIn("jobs", stop)
        self.assertGreaterEqual(len(stop["holes"]), 1)
        for hole in stop["holes"]:
            self.assertEqual(set(hole), {"path", "secret", "email", "phone"})
            self.assertIsInstance(hole["path"], str)
            self.assertNotIn("\\", hole["path"])
            self.assertNotIn("@", hole["path"])
            for key in ("secret", "email", "phone"):
                self.assertIsInstance(hole[key], int)
                self.assertGreaterEqual(hole[key], 0)
        user_hole = next(item for item in stop["holes"] if item["path"] == "memories/USER.md")
        self.assertGreaterEqual(user_hole["email"], 1)
        self.assertGreaterEqual(user_hole["phone"], 1)
        self.assertEqual(user_hole["secret"], 0)
        memory_hole = next(item for item in stop["holes"] if item["path"] == "memories/MEMORY.md")
        self.assertGreaterEqual(memory_hole["secret"], 1)
        self.assertEqual(memory_hole["email"], 0)
        self.assertEqual(memory_hole["phone"], 0)
        self.assertNotIn("Reach ray", blob)
        self.assertNotIn("The work continues", blob)

    def test_a_grew_path_with_an_email_or_secret_is_masked(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        install_pack(self.out, self.dest)
        email_dir = "owner-ray@example.com"
        secret_dir = "sk-grewtokenabcdefghij"
        email_skill = self.home / "skills" / "general" / email_dir / "SKILL.md"
        secret_skill = self.home / "skills" / "general" / secret_dir / "SKILL.md"
        write(email_skill, "---\nname: later-mail\n---\nAfter the mail path.\n")
        write(secret_skill, "---\nname: later-secret\n---\nAfter the secret path.\n")
        report = verify_pack(self.dest, self.home)
        grew = report["grew"]
        grew_blob = json.dumps(grew)
        report_blob = json.dumps(report)
        self.assertNotIn(email_dir, grew_blob)
        self.assertNotIn(secret_dir, grew_blob)
        self.assertNotIn("ray@example.com", report_blob)
        self.assertNotIn(secret_dir, report_blob)
        self.assertNotIn("sk-grewtokenabcdefghij", report_blob)
        masked = [item for item in grew if item == "hidden-path" or "redacted-" in item]
        self.assertGreaterEqual(len(masked), 2)
        for item in grew:
            self.assertNotIn("\\", item)
            self.assertIsNone(EMAIL.search(item))
            self.assertIsNone(SECRET.search(item))
            self.assertIsNone(PHONE.search(item))
        self.assertTrue(email_skill.is_file())
        self.assertTrue(secret_skill.is_file())
        self.assertIn(email_dir, email_skill.parent.name)
        self.assertIn(secret_dir, secret_skill.parent.name)
        self.assertFalse((self.dest / "skills" / "general" / email_dir).exists())
        self.assertFalse((self.dest / "skills" / "general" / secret_dir).exists())
        self.assertFalse(any("later-mail" in path.name for path in self.dest.rglob("SKILL.md")))

    def test_an_empty_voice_does_not_prefix_ask(self) -> None:
        soul = self.home / "SOUL.md"
        write(soul, "\n# Only a heading\n\n")
        before = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        self.assertFalse(ask.startswith("\n"))
        self.assertNotIn("# Only a heading", ask)
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertNotIn("voice", card)

        shutil.rmtree(self.out)
        write(soul, "")
        before_empty = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_empty)
        self.assertTrue((self.out / "SOUL.md").read_text(encoding="utf-8").startswith("Cortex note.\n"))
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertNotIn("voice", card)
        self.assertNotIn('""', ask.splitlines()[0])

    def test_pack_paths_use_forward_slashes(self) -> None:
        soul = self.home / "SOUL.md"
        soul.write_bytes(b"Keep the windows line.\r\n")
        before = soul.read_bytes()
        manifest = build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before)
        self.assertIn(b"\r\n", before)
        self.assertNotIn(b"\r", (self.out / "SOUL.md").read_bytes())
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("Keep the windows line.\n"))
        self.assertIn("- memories/USER.md", ask)
        self.assertIn("- memories/MEMORY.md", ask)
        self.assertNotIn("memories\\USER.md", ask)
        self.assertNotIn("memories\\MEMORY.md", ask)
        self.assertNotIn("skills\\general", ask)
        paths = [item["path"] for item in manifest["files"]]
        self.assertIn("memories/USER.md", paths)
        self.assertIn("skills/general/demo/SKILL.md", paths)
        for path in paths:
            self.assertNotIn("\\", path)
            self.assertNotIn("\r", path)
        stop = (self.out / "STOP.json").read_text(encoding="utf-8")
        self.assertIn("memories/USER.md", stop)
        self.assertNotIn("memories\\USER.md", stop)
        self.assertNotIn("\\", stop)
        receipt_paths = [item["path"] for item in public_receipt(manifest)["files"]]
        self.assertIn("SOUL.md", receipt_paths)
        self.assertTrue(all("\\" not in path for path in receipt_paths))
        self.assertTrue((self.out / "memories" / "USER.md").is_file())
        self.assertTrue((self.out / "skills" / "general" / "demo" / "SKILL.md").is_file())

    def test_a_second_birth_beside_a_live_destination_is_refused(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        births = self.tmp / "births"
        first = births / "one"
        install_pack(self.out, first)
        self.assertTrue((first / "BIRTH.md").is_file())
        self.assertTrue((first / "SOUL.md").is_file())

        second = births / "two"
        second.mkdir()
        write(second / "SOUL.md", "This destination is already a live home.\n")
        write(second / "memories" / "USER.md", "Reach ray@example.com or 215-555-0199.\n")
        write(second / "config.yaml", "model: grok\n")
        before_soul = (second / "SOUL.md").read_bytes()
        before_user = (second / "memories" / "USER.md").read_bytes()
        with self.assertRaises(PackError):
            install_pack(self.out, second)
        self.assertEqual((second / "SOUL.md").read_bytes(), before_soul)
        self.assertEqual((second / "memories" / "USER.md").read_bytes(), before_user)
        self.assertIn("ray@example.com", (second / "memories" / "USER.md").read_text(encoding="utf-8"))
        self.assertFalse((second / "skills").exists())
        self.assertFalse((second / "BIRTH.md").exists())
        self.assertFalse((second / "manifest.json").exists())
        born_soul = (first / "SOUL.md").read_text(encoding="utf-8")
        self.assertTrue(born_soul.startswith("Cortex note.\n"))
        self.assertIn("Skill titles in this folder:", born_soul)
        self.assertIn("demo", born_soul)
        self.assertIn("Voice stays plain.\n", born_soul)

        third = births / "three"
        with self.assertRaises(PackError):
            install_pack(self.out, third)
        self.assertFalse(third.exists())

        marked = births / "marked"
        marked.mkdir()
        write(marked / "auth.json", "{\"token\":\"should-not-copy\"}\n")
        with self.assertRaises(PackError):
            install_pack(self.out, marked)
        self.assertFalse((marked / "SOUL.md").exists())
        self.assertFalse((marked / "BIRTH.md").exists())
        self.assertIn("should-not-copy", (marked / "auth.json").read_text(encoding="utf-8"))

        quiet = self.tmp / "quiet-births"
        beside = quiet / "beside"
        install_pack(self.out, beside)
        again = quiet / "again"
        install_pack(self.out, again)
        self.assertTrue((beside / "BIRTH.md").is_file())
        self.assertTrue((again / "SOUL.md").is_file())
        self.assertFalse((beside / "auth.json").exists())
        self.assertFalse((again / "config.yaml").exists())

    def test_check_lists_mask_an_email_or_secret_in_the_path(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        install_pack(self.out, self.dest)
        growth = self.dest / "growth" / "owner-ray@example.com.md"
        write(growth, "new work\n")
        phone = self.dest / "growth" / "215-555-0199.md"
        write(phone, "new phone note\n")
        takeover = self.dest / "sk-takeoverabcdefghij.txt"
        takeover.write_bytes(b"extra\n")
        report = verify_pack(self.dest)
        blob = json.dumps(report)
        self.assertNotIn("ray@example.com", blob)
        self.assertNotIn("215-555-0199", blob)
        self.assertNotIn("sk-takeoverabcdefghij", blob)
        self.assertIn("hidden-path", report["growth"])
        self.assertGreaterEqual(report["growth"].count("hidden-path"), 2)
        self.assertIn("hidden-path", report["takeover"])
        self.assertNotIn("growth/owner-ray@example.com.md", report["growth"])
        self.assertNotIn("sk-takeoverabcdefghij.txt", report["takeover"])
        self.assertFalse(report["ok"])
        self.assertTrue(growth.is_file())
        self.assertTrue(phone.is_file())
        self.assertTrue(takeover.is_file())
        for item in report["growth"] + report["takeover"] + report["tamper"] + report["missing"]:
            self.assertIsNone(EMAIL.search(item))
            self.assertIsNone(SECRET.search(item))
            self.assertIsNone(PHONE.search(item))
            self.assertNotIn("\\", item)

    def test_a_held_email_title_is_not_copied(self) -> None:
        skill = self.home / "skills" / "general" / "demo" / "SKILL.md"
        write(skill, "---\nname: ray@example.com\n---\nSteps for the held mail title.\n")
        before = skill.read_bytes()
        manifest = build_pack(self.home, self.out, "Fixture", hold={"ray@example.com"})
        self.assertEqual(skill.read_bytes(), before)
        self.assertIn("ray@example.com", skill.read_text(encoding="utf-8"))
        paths = [item["path"] for item in manifest["files"]]
        self.assertNotIn("skills/general/demo/SKILL.md", paths)
        self.assertFalse((self.out / "skills" / "general" / "demo" / "SKILL.md").exists())
        self.assertEqual(manifest["held"], ["redacted title"])
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertIn("Held back:\n- redacted title", ask)
        self.assertIn("Do not fetch a held title. Do not reconstruct it.", ask)
        self.assertNotIn("ray@example.com", ask)
        self.assertNotIn("Steps for the held mail title.", ask)
        card = json.loads((self.out / "ASK.json").read_text(encoding="utf-8"))
        self.assertEqual(card["held"], ["redacted title"])
        self.assertNotIn("ray@example.com", json.dumps(card))
        stop_blob = (self.out / "STOP.json").read_text(encoding="utf-8")
        self.assertNotIn("ray@example.com", stop_blob)
        self.assertIn("redacted title", json.loads(stop_blob)["held"])
        blob = "\n".join(path.read_text(encoding="utf-8") for path in self.out.rglob("*") if path.is_file())
        self.assertNotIn("ray@example.com", blob)
        self.assertNotIn("Steps for the held mail title.", blob)

    def test_voice_skips_a_heading_and_refuses_a_long_or_phone_line(self) -> None:
        soul = self.home / "SOUL.md"
        write(soul, "# Title\n\nKeep the prose line.\n")
        before = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("Keep the prose line.\n"))
        self.assertNotIn("# Title", ask)

        shutil.rmtree(self.out)
        exact = "E" * 140
        write(soul, exact + "\n")
        before_exact = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_exact)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith(exact + "\n"))

        shutil.rmtree(self.out)
        long_line = "L" * 141
        write(soul, long_line + "\nShort follows.\n")
        before_long = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_long)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        self.assertNotIn(long_line, ask)
        self.assertNotIn("Short follows.", ask)
        self.assertNotIn("voice", json.loads((self.out / "ASK.json").read_text(encoding="utf-8")))

        shutil.rmtree(self.out)
        write(soul, "Call 215-555-0199 first.\nThen a plain line.\n")
        before_phone = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_phone)
        self.assertIn("215-555-0199", soul.read_text(encoding="utf-8"))
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        self.assertNotIn("215-555-0199", ask)
        self.assertNotIn("Then a plain line.", ask)
        self.assertNotIn("[phone] first", ask)
        blob = "\n".join(path.read_text(encoding="utf-8") for path in self.out.rglob("*") if path.is_file())
        self.assertNotIn("215-555-0199", blob)
        self.assertIn("[phone]", (self.out / "SOUL.md").read_text(encoding="utf-8"))

        shutil.rmtree(self.out)
        write(soul, "---\ntitle: ignore\n---\nAfter the front matter.\n")
        before_front = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_front)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("After the front matter.\n"))
        self.assertNotIn("title: ignore", ask)

    def test_a_secret_shaped_check_path_is_not_returned_raw(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        install_pack(self.out, self.dest)
        home_user = (self.home / "memories" / "USER.md").read_bytes()
        manifest_path = self.dest / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        leaked = "skills/general/owner-ray@example.com/SKILL.md"
        secret = "skills/general/sk-checkpathabcdefghij/SKILL.md"
        renamed = 0
        for item in manifest["files"]:
            if item["path"] == "SOUL.md":
                item["path"] = leaked
                renamed += 1
            elif item["path"] == "memories/USER.md":
                item["path"] = secret
                renamed += 1
        self.assertEqual(renamed, 2)
        manifest["contract"] = contract_hash(manifest)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        report = verify_pack(self.dest, self.home)
        blob = json.dumps(report)
        self.assertNotIn("ray@example.com", blob)
        self.assertNotIn("sk-checkpathabcdefghij", blob)
        self.assertNotIn(leaked, blob)
        self.assertNotIn(secret, blob)
        self.assertGreaterEqual(report["missing"].count("hidden-path"), 2)
        self.assertGreaterEqual(report["gone"].count("hidden-path"), 2)
        self.assertGreaterEqual(report["stale_files"].count("hidden-path"), 2)
        for item in report["missing"] + report["gone"] + report["stale_files"] + report["changed"] + report["grew"]:
            self.assertIsNone(EMAIL.search(item))
            self.assertIsNone(SECRET.search(item))
            self.assertIsNone(PHONE.search(item))
            self.assertNotIn("\\", item)
        receipt_blob = json.dumps(public_receipt(manifest))
        self.assertNotIn("ray@example.com", receipt_blob)
        self.assertNotIn("sk-checkpathabcdefghij", receipt_blob)
        self.assertIn("hidden-path", receipt_blob)
        self.assertIn("BIRTH.md", receipt_blob)
        self.assertEqual((self.home / "memories" / "USER.md").read_bytes(), home_user)
        self.assertTrue((self.dest / "SOUL.md").is_file())
        self.assertIn("ray@example.com", (self.home / "memories" / "USER.md").read_text(encoding="utf-8"))

    def test_a_quoted_voice_opens_ask_and_a_secret_line_does_not(self) -> None:
        soul = self.home / "SOUL.md"
        write(soul, "\"Keep the quoted line.\"\n")
        before = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("Keep the quoted line.\n"))
        self.assertFalse(ask.startswith("\""))

        shutil.rmtree(self.out)
        write(soul, "---\ntitle: never closed\nKeep going.\n")
        before_open = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_open)
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        self.assertNotIn("Keep going.", ask)
        self.assertNotIn("title: never closed", ask)
        self.assertNotIn("voice", json.loads((self.out / "ASK.json").read_text(encoding="utf-8")))

        shutil.rmtree(self.out)
        write(soul, "token: abcdefghijklmnop\nPlain after the token.\n")
        before_token = soul.read_bytes()
        build_pack(self.home, self.out, "Fixture")
        self.assertEqual(soul.read_bytes(), before_token)
        self.assertIn("abcdefghijklmnop", soul.read_text(encoding="utf-8"))
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        self.assertTrue(ask.startswith("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.\n"))
        self.assertNotIn("abcdefghijklmnop", ask)
        self.assertNotIn("Plain after the token.", ask)
        blob = "\n".join(path.read_text(encoding="utf-8") for path in self.out.rglob("*") if path.is_file())
        self.assertNotIn("abcdefghijklmnop", blob)
        self.assertIn("[redacted]", (self.out / "SOUL.md").read_text(encoding="utf-8"))

    def test_a_second_birth_beside_a_marked_live_home_is_still_refused(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        street = self.tmp / "street"
        first = street / "one"
        install_pack(self.out, first)
        write(first / "auth.json", "{\"token\":\"should-not-copy\"}\n")
        write(first / "config.yaml", "model: grok\n")
        write(first / "sessions" / "sessions.json", "{\"session_id\":\"secret-chat\"}\n")
        soul_before = (first / "SOUL.md").read_bytes()
        second = street / "two"
        with self.assertRaises(PackError):
            install_pack(self.out, second)
        self.assertFalse(second.exists())
        self.assertEqual((first / "SOUL.md").read_bytes(), soul_before)
        self.assertIn("should-not-copy", (first / "auth.json").read_text(encoding="utf-8"))
        self.assertIn("secret-chat", (first / "sessions" / "sessions.json").read_text(encoding="utf-8"))
        self.assertIn("model: grok", (first / "config.yaml").read_text(encoding="utf-8"))
        self.assertFalse((second / "SOUL.md").exists())
        self.assertFalse((second / "BIRTH.md").exists())

    def test_open_lines_and_tool_files_match_the_agent(self) -> None:
        build_pack(self.home, self.out, "Fixture")
        stop = json.loads((self.out / "STOP.json").read_text(encoding="utf-8"))
        self.assertFalse(stop["stops_tools"])
        self.assertEqual(stop["gate"]["file"], "")
        self.assertIn("This file does not stop those tools.", stop["refuse"])
        ask = (self.out / "ASK.md").read_text(encoding="utf-8")
        birth = (self.out / "BIRTH.md").read_text(encoding="utf-8")
        start = (self.out / "START.md").read_text(encoding="utf-8")
        install = (self.out / "INSTALL.txt").read_text(encoding="utf-8")
        limit = "STOP.json does not stop a send, a push, or a delete."
        order = "Read STOP.json, then BIRTH.md, then the soul, the memory, and the skills."
        self.assertIn("In PowerShell, set HERMES_HOME to this folder. Hermes loads SOUL.md, and the Cortex note at the top of that file is the instruction. The old home stays out. This folder has no keys and no config.", ask)
        self.assertIn(limit, ask)
        self.assertIn(limit, birth)
        self.assertIn(limit, start)
        self.assertIn(limit, install)
        self.assertIn(order, ask)
        self.assertIn(order, start)
        self.assertIn(order, install)
        self.assertIn("Read STOP.json, then this file, then the soul, the memory, and the skills.", birth)
        self.assertIn("Files beside a skill, other than SKILL.md, stayed in the original folder.", ask)
        self.assertFalse((self.out / ".claude" / "settings.json").exists())
        self.assertIn("STOP.json does not stop a tool.", birth)

        claude = self.tmp / "claude-gate"
        write(claude / "CLAUDE.md", "Be brief.\n")
        packed = self.tmp / "claude-gate-pack"
        build_pack(claude, packed, "Claude")
        born = self.tmp / "far" / "claude-born"
        install_pack(packed, born)
        settings = json.loads((born / ".claude" / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(settings["permissions"]["deny"], ["Bash(git push *)", "Bash(rm *)"])
        (packed / ".claude" / "settings.json").write_text("{}\n", encoding="utf-8")
        with self.assertRaises(PackError):
            install_pack(packed, self.tmp / "claude-born-again")

        cursor = self.tmp / "cursor-gate"
        write(cursor / ".cursor" / "rules" / "style.mdc", "Short.\n")
        cursor_pack = self.tmp / "cursor-gate-pack"
        build_pack(cursor, cursor_pack, "Cursor")
        sandbox = json.loads((cursor_pack / ".cursor" / "sandbox.json").read_text(encoding="utf-8"))
        self.assertEqual(sandbox["networkPolicy"]["default"], "deny")
        cursor_stop = json.loads((cursor_pack / "STOP.json").read_text(encoding="utf-8"))
        self.assertFalse(cursor_stop["stops_tools"])
        self.assertIn("does not stop a delete", cursor_stop["gate"]["does_not"])

        codex = self.tmp / "codex-gate"
        write(codex / "AGENTS.md", "Short.\n")
        codex_pack = self.tmp / "codex-gate-pack"
        build_pack(codex, codex_pack, "Codex")
        rules = (codex_pack / ".codex" / "rules" / "cortex-stop.rules").read_text(encoding="utf-8")
        self.assertIn('decision = "forbidden"', rules)
        self.assertIn('pattern = ["git", "push"]', rules)
        self.assertIn('pattern = ["rm"]', rules)
        codex_stop = json.loads((codex_pack / "STOP.json").read_text(encoding="utf-8"))
        self.assertIn("only after the project .codex layer is trusted", codex_stop["gate"]["binds"])


def build_pack_sentence() -> str:
    from pack_brain import scrub
    text, counts = scrub("Secret values in config were not loaded.")
    if any(counts.values()):
        raise AssertionError("model pin sentence was treated as a secret")
    return text


if __name__ == "__main__":
    unittest.main()
