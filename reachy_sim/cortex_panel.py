"""Plain-text Cortex panel for the Reachy simulation.

The MuJoCo window is a separate process, so this panel is a small window
beside it. The same text is what a headless run prints.
"""

from __future__ import annotations

import threading
import time
from typing import Any


VISIBLE_CAP = 12
HIGHLIGHT_SECONDS = 1.0

ANTENNA_LABEL = {
    "IDLE": "idle",
    "LISTENING": "listening",
    "THINKING": "thinking",
    "SPEAKING": "speaking",
    "HANDOFF": "handoff",
    "ERROR": "error",
}


class CortexPanel:
    """Skill list, last decision, round-trip time, and antenna state."""

    def __init__(self, skills: list[str], *, console: bool = False) -> None:
        self.skills = list(skills)
        self.console = console
        self.matched: str | None = None
        self.no_local = False
        self.highlight_until = 0.0
        self.antenna_state = "idle"
        self.angles = (0.0, 0.0)
        self.decision_line = ""
        self.rtt_ms: float | None = None
        self.pending_notes = 0
        self.growth_line = ""
        self.growth_until = 0.0
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def note_decision(
        self,
        choice: str,
        utterance: str,
        rtt_ms: float,
        matched_skill: str | None,
    ) -> None:
        """Record one decision. A local or grok_bot match can be highlighted."""
        with self._lock:
            self.decision_line = f"decision {choice} utterance={utterance!r}"
            self.rtt_ms = float(rtt_ms)
            if matched_skill and choice in ("local", "grok_bot"):
                self.matched = matched_skill
                self.no_local = False
            else:
                self.matched = None
                self.no_local = True
            self.highlight_until = 0.0
        if self.console:
            print(self.text())

    def set_pending(self, count: int) -> None:
        with self._lock:
            self.pending_notes = count

    def note_growth(self, count: int, first_line: str) -> None:
        """Show a new pending note. The first line stays up for about a second."""
        with self._lock:
            self.pending_notes = count
            self.growth_line = first_line
            self.growth_until = time.monotonic() + HIGHLIGHT_SECONDS
        if self.console:
            print(self.text())

    def show_match(self) -> None:
        """Mark the matched skill for about one second."""
        with self._lock:
            if self.matched:
                self.highlight_until = time.monotonic() + HIGHLIGHT_SECONDS

    def set_antenna(self, state: str, angles: tuple[float, float]) -> None:
        with self._lock:
            self.antenna_state = ANTENNA_LABEL.get(state, state.lower())
            self.angles = (float(angles[0]), float(angles[1]))
        if self.console:
            print(self.text())

    def text(self) -> str:
        """The lines the window and the console share."""
        with self._lock:
            shown = self._visible_names()
            lines = [f"{len(self.skills)} skills loaded", *shown]
            if self.no_local:
                lines.append("no local match")
            lines.append(
                f"{self.antenna_state}  {self.angles[0]:.3f}  {self.angles[1]:.3f}"
            )
            if self.decision_line:
                lines.append(self.decision_line)
            if self.rtt_ms is not None:
                lines.append(f"rtt {_rtt_text(self.rtt_ms)} ms")
            lines.append(f"pending notes: {self.pending_notes}")
            if self.growth_line and time.monotonic() < self.growth_until:
                lines.append(self.growth_line)
            return "\n".join(lines)

    def open_window(self) -> bool:
        """Open the side panel. Return False when the display is unavailable."""
        if self.console:
            return False
        try:
            import tkinter as tk
        except Exception:
            self.console = True
            return False
        try:
            self._start(tk)
        except tk.TclError:
            self.console = True
            return False
        return True

    def _visible_names(self) -> list[str]:
        names = list(self.skills)
        if self.matched and self.matched in names:
            names.remove(self.matched)
            names.insert(0, self.matched)
        return names[:VISIBLE_CAP]

    def _start(self, tk: Any) -> None:
        ready = threading.Event()
        error: list[BaseException] = []

        def run() -> None:
            try:
                root = tk.Tk()
            except tk.TclError as exc:
                error.append(exc)
                ready.set()
                return
            root.title("Cortex")
            root.configure(bg="#141414")
            root.geometry("420x520")
            count = tk.Label(
                root,
                text="",
                bg="#141414",
                fg="#e8e4dc",
                anchor="w",
                font=("Segoe UI", 12, "bold"),
            )
            count.pack(fill="x", padx=16, pady=(14, 6))
            skill_labels = []
            for _ in range(VISIBLE_CAP):
                label = tk.Label(
                    root,
                    text="",
                    bg="#141414",
                    fg="#e8e4dc",
                    anchor="w",
                    font=("Segoe UI", 10),
                )
                label.pack(fill="x", padx=16)
                skill_labels.append(label)
            nomatch = tk.Label(
                root,
                text="",
                bg="#141414",
                fg="#8a867e",
                anchor="w",
                font=("Segoe UI", 10),
            )
            nomatch.pack(fill="x", padx=16, pady=(8, 0))
            pending = tk.Label(
                root,
                text="",
                bg="#141414",
                fg="#e8e4dc",
                anchor="w",
                justify="left",
                font=("Segoe UI", 10),
            )
            pending.pack(fill="x", padx=16, pady=(8, 0))
            status = tk.Label(
                root,
                text="",
                bg="#141414",
                fg="#e8e4dc",
                anchor="w",
                justify="left",
                font=("Consolas", 10),
            )
            status.pack(fill="x", padx=16, pady=(12, 14))

            def paint() -> None:
                with self._lock:
                    skills = self._visible_names()
                    total = len(self.skills)
                    active = self.matched if time.monotonic() < self.highlight_until else None
                    quiet = self.no_local
                    antenna = self.antenna_state
                    angles = self.angles
                    decision = self.decision_line
                    rtt = None if self.rtt_ms is None else _rtt_text(self.rtt_ms)
                    pending_n = self.pending_notes
                    flash = self.growth_line if time.monotonic() < self.growth_until else ""
                count.configure(text=f"{total} skills loaded")
                for index, label in enumerate(skill_labels):
                    if index < len(skills):
                        name = skills[index]
                        label.configure(
                            text=name,
                            fg="#e6b422" if name == active else "#e8e4dc",
                        )
                    else:
                        label.configure(text="")
                nomatch.configure(text="no local match" if quiet else "")
                rows = [f"{antenna}  {angles[0]:.3f}  {angles[1]:.3f}"]
                if decision:
                    rows.append(decision)
                if rtt is not None:
                    rows.append(f"rtt {rtt} ms")
                pending.configure(
                    text=f"pending notes: {pending_n}" + (f"\n{flash}" if flash else ""),
                    fg="#e6b422" if flash else "#e8e4dc",
                )
                status.configure(text="\n".join(rows))
                root.after(100, paint)

            paint()
            ready.set()
            root.mainloop()

        self._thread = threading.Thread(target=run, name="cortex-panel", daemon=True)
        self._thread.start()
        ready.wait(timeout=5)
        if error:
            raise error[0]


def _rtt_text(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.1f}"
