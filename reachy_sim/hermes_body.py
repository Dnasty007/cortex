"""Ask the running Hermes what this body should do.

Connection details come from the environment already used by the other
Grok Bots, or from a repo-root ``.hermes-host`` file. No host, key, or
token is stored in this module. A missing connection is not an error:
the runner keeps the local decision path.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


INSTRUCTION = (
    "You are Hermes. Decide the action. You may call a Grok Bot, Claude, "
    "or the Buildium API. Reply with one JSON object only."
)
ASK_TIMEOUT = 12.0
FORWARD_ANGLES = (0.55, 0.55)
_TARGET = re.compile(r"^[\w.@:-]+$")
_ACTIONS = ("local", "delegate", "buildium", "speak")


class HermesError(Exception):
    """Hermes answered with something this body cannot use."""


class HermesTimeout(HermesError):
    """The Hermes call did not finish within 12 seconds."""


class HermesConnection:
    """One way to reach Hermes. The token stays off of logs and notes."""

    def __init__(self, kind: str, url: str = "", token: str = "", target: str = "", key: str = "") -> None:
        self.kind = kind
        self.url = url
        self.token = token
        self.target = target
        self.key = key


class HermesReply:
    """The one JSON object Hermes is asked to return."""

    def __init__(self, action: str, reply: str, target: str, ticket: str) -> None:
        self.action = action
        self.reply = reply
        self.target = target
        self.ticket = ticket


def hermes_prompt(utterance: str, pack: Path | str) -> str:
    """The exact JSON document sent for one utterance."""
    payload = {
        "utterance": utterance,
        "pack": str(pack),
        "instruction": INSTRUCTION,
        "expect": {
            "action": "local|delegate|buildium|speak",
            "reply": "short text for the robot to say",
            "target": "optional bot or contractor name",
            "ticket": "optional Buildium ticket id",
        },
    }
    return json.dumps(payload, ensure_ascii=False)


def motion_for(action: str) -> dict:
    """Antenna pose for one Hermes action.

    ``delegate`` is the wider handoff lean, held longer.
    ``buildium`` is a shorter forward lean on both antennas.
    """
    if action == "local":
        return {"state": "THINKING", "duration": 0.45, "angles": None}
    if action == "delegate":
        return {"state": "HANDOFF", "duration": 0.9, "angles": None}
    if action == "buildium":
        return {"state": "FORWARD", "duration": 0.45, "angles": FORWARD_ANGLES}
    if action == "speak":
        return {"state": "IDLE", "duration": 0.45, "angles": None}
    raise HermesError(f"Unknown Hermes action: {action}")


def parse_hermes_reply(raw: str) -> HermesReply:
    """Read the first JSON object in a Hermes reply."""
    text = raw or ""
    start = text.find("{")
    if start < 0:
        raise HermesError("Hermes did not return a JSON object.")
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as error:
        raise HermesError("Hermes did not return a JSON object.") from error
    if not isinstance(obj, dict):
        raise HermesError("Hermes did not return a JSON object.")
    action = _field(obj.get("action"))
    if action not in _ACTIONS:
        raise HermesError(f"Unknown Hermes action: {action or '(empty)'}")
    return HermesReply(
        action,
        _field(obj.get("reply")),
        _field(obj.get("target")),
        _field(obj.get("ticket")),
    )


def discover_connection(
    env: dict[str, str] | None = None,
    *,
    root: Path | None = None,
) -> HermesConnection | None:
    """Find an API URL or an SSH target. Return None when neither is set."""
    source = os.environ if env is None else env
    url = (source.get("HERMES_API_URL") or source.get("HERMES_DESKTOP_REMOTE_URL") or "").strip()
    if url:
        token = (source.get("HERMES_API_TOKEN") or source.get("HERMES_DESKTOP_REMOTE_TOKEN") or "").strip()
        return HermesConnection(kind="api", url=url, token=token)
    target = (source.get("HERMES_SSH") or "").strip()
    host = (source.get("HERMES_SSH_HOST") or "").strip()
    user = (source.get("HERMES_SSH_USER") or "").strip()
    if not target and host:
        target = f"{user}@{host}" if user else host
    if not target and root is not None:
        target = _read_host_file(root)
    if not target or not _TARGET.match(target):
        return None
    key = (source.get("HERMES_SSH_KEY") or "").strip()
    if key and not Path(key).is_file():
        key = ""
    if not key:
        fallback = Path.home() / ".ssh" / "id_ed25519"
        if fallback.is_file():
            key = str(fallback)
    return HermesConnection(kind="ssh", target=target, key=key)


class HermesClient:
    """Send one prompt and parse the JSON object Hermes returns."""

    def __init__(self, connection: HermesConnection | None = None, *, transport=None) -> None:
        self.connection = connection
        self.prompts: list[str] = []
        self._transport = transport
        self._warned = False

    def warn_if_missing(self) -> None:
        """Print the fallback warning once."""
        if self.connection is not None or self._warned:
            return
        self._warned = True
        print(
            "Hermes connection details are missing. Using the local decision path.",
            file=sys.stderr,
        )

    def ask(self, prompt: str) -> HermesReply:
        if self.connection is None:
            raise HermesError("Hermes connection details are missing.")
        self.prompts.append(prompt)
        try:
            raw = self._call(prompt)
        except HermesTimeout:
            raise
        except HermesError:
            raise
        except subprocess.TimeoutExpired as error:
            raise HermesTimeout("Hermes timed out.") from error
        except TimeoutError as error:
            raise HermesTimeout("Hermes timed out.") from error
        except Exception as error:
            raise HermesError("Hermes call failed.") from error
        return parse_hermes_reply(raw)

    def _call(self, prompt: str) -> str:
        if self._transport is not None:
            return self._transport(prompt)
        if self.connection is None:
            raise HermesError("Hermes connection details are missing.")
        if self.connection.kind == "api":
            return _post_api(self.connection, prompt)
        if self.connection.kind == "ssh":
            return _ssh_oneshot(self.connection, prompt)
        raise HermesError("Hermes connection is not usable.")


def _field(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _read_host_file(root: Path) -> str:
    path = Path(root) / ".hermes-host"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return ""
    if not lines:
        return ""
    return lines[0].strip()


def _completions_url(url: str) -> str:
    trimmed = url.rstrip("/")
    if trimmed.endswith("/chat/completions"):
        return trimmed
    if trimmed.endswith("/v1"):
        return trimmed + "/chat/completions"
    return trimmed + "/v1/chat/completions"


def _post_api(connection: HermesConnection, prompt: str) -> str:
    body = json.dumps(
        {
            "model": "hermes-agent",
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }
    ).encode("utf-8")
    request = urllib.request.Request(_completions_url(connection.url), data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    if connection.token:
        request.add_header("Authorization", f"Bearer {connection.token}")
    try:
        with urllib.request.urlopen(request, timeout=ASK_TIMEOUT) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        raise HermesError(f"Hermes HTTP {error.code}.") from error
    except urllib.error.URLError as error:
        if _is_timeout(error):
            raise HermesTimeout("Hermes timed out.") from error
        raise HermesError("Hermes API call failed.") from error
    return _assistant_text(raw)


def _assistant_text(raw: str) -> str:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    choices = data.get("choices") if isinstance(data, dict) else None
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            text = _content_text(message.get("content"))
            if text:
                return text
    return raw


def _content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return ""


def _is_timeout(error: urllib.error.URLError) -> bool:
    reason = error.reason
    if isinstance(reason, TimeoutError):
        return True
    return "timed out" in str(reason).lower()


def _ssh_oneshot(connection: HermesConnection, prompt: str) -> str:
    if not _TARGET.match(connection.target):
        raise HermesError("Hermes SSH target is not usable.")
    command = [
        "ssh",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if connection.key:
        command.extend(["-i", connection.key])
    remote = (
        "base64 -d > /tmp/reachy-hermes-body.txt && "
        "python3 -c 'import pathlib,subprocess,sys; "
        "p=pathlib.Path(\"/tmp/reachy-hermes-body.txt\").read_text(encoding=\"utf-8\"); "
        "r=subprocess.run([\"hermes\",\"-z\",p]); "
        "raise SystemExit(r.returncode)'"
    )
    command.extend([connection.target, remote])
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    payload = base64.b64encode(prompt.encode("utf-8"))
    try:
        out, err = process.communicate(payload, timeout=ASK_TIMEOUT)
    except subprocess.TimeoutExpired as error:
        process.kill()
        process.communicate()
        raise HermesTimeout("Hermes timed out.") from error
    if process.returncode != 0:
        raise HermesError("Hermes SSH call failed.") from _stderr(err)
    return out.decode("utf-8", errors="replace")


def _stderr(raw: bytes) -> HermesError:
    text = raw.decode("utf-8", errors="replace").strip()
    return HermesError(text[:200] if text else "Hermes SSH call failed.")
