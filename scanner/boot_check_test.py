"""Temp-folder checks for the birth trio. Does not touch a live home."""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from boot_check import boot_report, check_birth, main


def _remove_link(path: Path) -> None:
    try:
        if path.is_symlink():
            path.unlink()
            return
    except OSError:
        return
    junction = getattr(path, "is_junction", None)
    try:
        if junction and junction():
            os.rmdir(path)
    except OSError:
        return


class BirthCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="cortex-birth-check-"))
        self.folder = self.tmp / "birth"
        self.folder.mkdir()
        self.links: list[Path] = []

    def tearDown(self) -> None:
        for link in self.links:
            _remove_link(link)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _trio(self) -> None:
        (self.folder / "ASK.json").write_text("{}\n", encoding="utf-8")
        (self.folder / "STOP.json").write_text("{}\n", encoding="utf-8")
        (self.folder / "BIRTH.md").write_text("birth\n", encoding="utf-8")

    def _make_dir_link(self, link: Path, target: Path) -> None:
        self.links.append(link)
        try:
            os.symlink(os.path.abspath(target), link, target_is_directory=True)
            return
        except OSError:
            pass
        # Junction fallback stays inside this temp tree. It does not start an agent.
        completed = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "could not make a link").strip()
            self.fail(detail)

    def test_good_trio_is_ok(self) -> None:
        self._trio()
        report = check_birth(self.folder)
        self.assertTrue(report["ok"])
        self.assertEqual(report["missing"], [])
        self.assertEqual(report["loader_files"], [])
        self.assertEqual(report["outside"], [])

    def test_missing_stop_json_is_named(self) -> None:
        (self.folder / "ASK.json").write_text("{}\n", encoding="utf-8")
        (self.folder / "BIRTH.md").write_text("birth\n", encoding="utf-8")
        report = check_birth(self.folder)
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], ["STOP.json"])

    def test_loader_is_listed_and_nothing_is_deleted(self) -> None:
        self._trio()
        (self.folder / "notes.txt").write_text("keep\n", encoding="utf-8")
        for name in ("loader.py", "start.bat", "gateway.py", "run.bat", "autostart"):
            (self.folder / name).write_text("no\n", encoding="utf-8")
        nested = self.folder / "sub"
        nested.mkdir()
        (nested / "autostart.bat").write_text("no\n", encoding="utf-8")
        (nested / "readme.txt").write_text("keep\n", encoding="utf-8")
        before = sorted(path.relative_to(self.folder).as_posix() for path in self.folder.rglob("*"))
        report = check_birth(self.folder)
        after = sorted(path.relative_to(self.folder).as_posix() for path in self.folder.rglob("*"))
        self.assertEqual(before, after)
        self.assertEqual((self.folder / "notes.txt").read_text(encoding="utf-8"), "keep\n")
        self.assertEqual((self.folder / "loader.py").read_text(encoding="utf-8"), "no\n")
        self.assertEqual(
            report["loader_files"],
            ["autostart", "gateway.py", "loader.py", "run.bat", "start.bat", "sub/autostart.bat"],
        )
        self.assertNotIn("notes.txt", report["loader_files"])
        self.assertNotIn("sub/readme.txt", report["loader_files"])
        self.assertNotIn("ASK.json", report["loader_files"])
        self.assertTrue(report["ok"])

    def test_escape_link_is_reported_and_not_followed(self) -> None:
        self._trio()
        home = self.tmp / "home"
        home.mkdir()
        canary = home / "gateway.py"
        canary.write_text("parent-home-gateway\n", encoding="utf-8")
        private = home / "auth.json"
        private.write_text("parent-home-secret\n", encoding="utf-8")
        link = self.folder / "out"
        self._make_dir_link(link, home)
        before = sorted(entry.name for entry in os.scandir(self.folder))
        report = check_birth(self.folder)
        after = sorted(entry.name for entry in os.scandir(self.folder))
        self.assertEqual(before, after)
        self.assertEqual(report["outside"], ["out"])
        self.assertTrue(report["ok"])
        self.assertNotIn("out/gateway.py", report["loader_files"])
        self.assertFalse(any("gateway.py" in name for name in report["loader_files"]))
        self.assertNotIn(str(home), str(report))
        self.assertNotIn("parent-home-secret", str(report))
        self.assertEqual(private.read_text(encoding="utf-8"), "parent-home-secret\n")
        self.assertTrue(canary.is_file())
        for item in report["outside"]:
            self.assertFalse(Path(item).is_absolute())
            self.assertNotIn("..", Path(item).parts)

    def test_empty_folder_names_the_trio(self) -> None:
        report = check_birth(self.folder)
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], ["ASK.json", "STOP.json", "BIRTH.md"])
        self.assertEqual(report["loader_files"], [])
        self.assertEqual(report["outside"], [])
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_ask_json_directory_is_not_a_file(self) -> None:
        (self.folder / "ASK.json").mkdir()
        (self.folder / "STOP.json").write_text("{}\n", encoding="utf-8")
        (self.folder / "BIRTH.md").write_text("birth\n", encoding="utf-8")
        report = check_birth(self.folder)
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], ["ASK.json"])
        self.assertTrue((self.folder / "ASK.json").is_dir())

    def test_boot_report_loader_false(self) -> None:
        self._trio()
        (self.folder / "STOP.json").write_text(
            json.dumps({"format": "cortex-stop-1", "loader": False}) + "\n",
            encoding="utf-8",
        )
        stop_text = (self.folder / "STOP.json").read_text(encoding="utf-8")
        before = sorted(path.relative_to(self.folder).as_posix() for path in self.folder.rglob("*"))
        report = boot_report(self.folder)
        after = sorted(path.relative_to(self.folder).as_posix() for path in self.folder.rglob("*"))
        self.assertEqual(before, after)
        self.assertEqual((self.folder / "STOP.json").read_text(encoding="utf-8"), stop_text)
        self.assertEqual(report["refusal"], "")
        self.assertTrue(report["BIRTH.md"])
        self.assertTrue(report["STOP.json"])
        self.assertTrue(report["loader_false"])
        self.assertTrue(report["ok"])

    def test_boot_report_loader_true_is_not_ok(self) -> None:
        self._trio()
        (self.folder / "STOP.json").write_text(
            json.dumps({"loader": True}) + "\n",
            encoding="utf-8",
        )
        report = boot_report(self.folder)
        self.assertEqual(report["refusal"], "")
        self.assertTrue(report["BIRTH.md"])
        self.assertTrue(report["STOP.json"])
        self.assertFalse(report["loader_false"])
        self.assertFalse(report["ok"])

    def test_auth_json_is_a_live_home_and_unread(self) -> None:
        (self.folder / "BIRTH.md").write_text("birth\n", encoding="utf-8")
        (self.folder / "STOP.json").write_text(
            json.dumps({"loader": False, "note": "sentinel-stop-value"}) + "\n",
            encoding="utf-8",
        )
        (self.folder / "auth.json").write_text("sentinel-auth-value\n", encoding="utf-8")
        report = boot_report(self.folder)
        self.assertEqual(report["refusal"], "That folder is a live home.")
        self.assertFalse(report["ok"])
        self.assertFalse(report["loader_false"])
        self.assertNotIn("sentinel-auth-value", str(report))
        self.assertNotIn("sentinel-stop-value", str(report))

    def test_config_yaml_is_a_live_home(self) -> None:
        (self.folder / "config.yaml").write_text("sentinel-config-value\n", encoding="utf-8")
        report = boot_report(self.folder)
        self.assertEqual(report["refusal"], "That folder is a live home.")
        self.assertNotIn("sentinel-config-value", str(report))

    def test_sessions_directory_is_not_read(self) -> None:
        sessions = self.folder / "sessions"
        sessions.mkdir()
        (sessions / "gateway.py").write_text("sentinel-session-value\n", encoding="utf-8")
        (sessions / "chat.jsonl").write_text("sentinel-chat-value\n", encoding="utf-8")
        report = boot_report(self.folder)
        birth = check_birth(self.folder)
        self.assertEqual(report["refusal"], "That folder is a live home.")
        self.assertFalse(any("gateway.py" in name for name in birth["loader_files"]))
        self.assertNotIn("sentinel-session-value", str(report))
        self.assertNotIn("sentinel-chat-value", str(birth))
        self.assertTrue((sessions / "gateway.py").is_file())

    def test_stop_json_without_loader_key_is_not_ok(self) -> None:
        (self.folder / "ASK.json").write_text("{}\n", encoding="utf-8")
        (self.folder / "BIRTH.md").write_text("birth\n", encoding="utf-8")
        stop = self.folder / "STOP.json"
        stop.write_text(json.dumps({"format": "cortex-stop-1"}) + "\n", encoding="utf-8")
        before = stop.read_text(encoding="utf-8")
        report = boot_report(self.folder)
        self.assertEqual(stop.read_text(encoding="utf-8"), before)
        self.assertTrue(report["BIRTH.md"])
        self.assertTrue(report["STOP.json"])
        self.assertFalse(report["loader_false"])
        self.assertFalse(report["ok"])
        self.assertEqual(report["refusal"], "")

    def test_stop_json_without_birth_md_is_not_parsed(self) -> None:
        (self.folder / "STOP.json").write_text(
            json.dumps({"loader": False, "note": "sentinel-stop-only"}) + "\n",
            encoding="utf-8",
        )
        report = boot_report(self.folder)
        self.assertFalse(report["BIRTH.md"])
        self.assertTrue(report["STOP.json"])
        self.assertFalse(report["loader_false"])
        self.assertFalse(report["ok"])
        self.assertNotIn("sentinel-stop-only", str(report))

    def test_stop_json_directory_is_missing(self) -> None:
        (self.folder / "ASK.json").write_text("{}\n", encoding="utf-8")
        (self.folder / "STOP.json").mkdir()
        (self.folder / "BIRTH.md").write_text("birth\n", encoding="utf-8")
        report = check_birth(self.folder)
        home = boot_report(self.folder)
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], ["STOP.json"])
        self.assertFalse(home["STOP.json"])
        self.assertFalse(home["loader_false"])
        self.assertFalse(home["ok"])
        self.assertTrue((self.folder / "STOP.json").is_dir())

    def test_missing_folder_is_not_created(self) -> None:
        missing = self.tmp / "absent"
        report = check_birth(missing)
        home = boot_report(missing)
        self.assertFalse(missing.exists())
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], ["ASK.json", "STOP.json", "BIRTH.md"])
        self.assertEqual(home["refusal"], "")
        self.assertFalse(home["ok"])

    def test_file_symlink_escape_is_not_read(self) -> None:
        self._trio()
        home = self.tmp / "home"
        home.mkdir()
        secret = home / "secret.txt"
        secret.write_text(
            '{"loader": false, "secret": "sentinel-file-link"}\n',
            encoding="utf-8",
        )
        link = self.folder / "STOP.json"
        link.unlink()
        try:
            os.symlink(secret, link)
        except OSError as exc:
            self.skipTest(f"file symlink unavailable: {exc}")
        self.links.append(link)
        birth = check_birth(self.folder)
        report = boot_report(self.folder)
        self.assertIn("STOP.json", birth["missing"])
        self.assertIn("STOP.json", birth["outside"])
        self.assertFalse(report["STOP.json"])
        self.assertFalse(report["loader_false"])
        self.assertNotIn("sentinel-file-link", str(birth))
        self.assertNotIn("sentinel-file-link", str(report))
        self.assertEqual(
            secret.read_text(encoding="utf-8"),
            '{"loader": false, "secret": "sentinel-file-link"}\n',
        )

    def test_script_report_and_live_home_refusal(self) -> None:
        self._trio()
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(["boot_check.py", str(self.folder)])
        self.assertEqual(code, 0)
        self.assertIn("ok: true", out.getvalue())
        self.assertIn("missing: none", out.getvalue())
        (self.folder / "auth.json").write_text("sentinel-auth-value\n", encoding="utf-8")
        refused = io.StringIO()
        with redirect_stdout(refused):
            status = main(["boot_check.py", str(self.folder)])
        text = refused.getvalue()
        self.assertEqual(status, 1)
        self.assertIn("refusal: That folder is a live home.", text)
        self.assertNotIn("sentinel-auth-value", text)
        err = io.StringIO()
        with redirect_stderr(err):
            usage = main(["boot_check.py"])
        self.assertEqual(usage, 2)
        self.assertIn("usage:", err.getvalue())


if __name__ == "__main__":
    unittest.main()
