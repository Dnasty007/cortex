"""Read a Hermes home and write a brain map. Does not modify that home.

The map is names, descriptions, and short excerpts. It skips auth, tokens,
credentials, caches, and script bodies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SECRET = re.compile(
    r"(?i)(api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+"
    r"|token\s*[:=]\s*\S{8,}|bearer\s+[a-z0-9._\-]{12,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9]{12,}"
    r"|xai-[a-z0-9]{12,}|bws_[a-z0-9_\-]{8,}|AKIA[0-9A-Z]{16})"
)

SKIP_FILE = re.compile(r"(?i)(auth\.json|\.env$|credential|google_token|client_secret)")


def redact(text: str) -> str:
    return SECRET.sub("[redacted]", text or "")


def read_text(path: Path, limit: int) -> str:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return handle.read(limit)


def split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---"):
        return "", text
    end = text.find("\n---", 3)
    if end == -1:
        return "", text
    return text[3:end], text[end + 4 :]


def field(raw: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", raw, re.M)
    if not match:
        return ""
    value = match.group(1).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value.strip()


def bracket_list(raw: str, key: str) -> list[str]:
    match = re.search(rf"{re.escape(key)}:\s*\[(.*?)\]", raw, re.S)
    if not match:
        return []
    items = []
    for part in match.group(1).split(","):
        item = part.strip().strip("\"'")
        if item:
            items.append(item)
    return items


def sections(text: str, limit: int = 40) -> list[str]:
    chunks = re.split(r"(?:^|\n)\s*§\s*(?:\n|$)", text)
    chunks = [chunk.strip() for chunk in chunks if chunk.strip()]
    if len(chunks) <= 1:
        chunks = [chunk.strip() for chunk in re.split(r"\n{2,}", text) if chunk.strip()]
    return chunks[:limit]


def first_line(text: str, limit: int = 160) -> str:
    line = redact(text).strip().splitlines()
    if not line:
        return ""
    return line[0][:limit]


def clip(text: str, limit: int) -> str:
    clean = redact(text).strip()
    if len(clean) <= limit:
        return clean
    return clean[: limit - 1].rstrip() + "…"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def skill_identity(path: Path) -> tuple[str, str]:
    skill_dir = path.parent
    category_dir = skill_dir.parent
    if category_dir.name == "skills":
        category = "general"
    else:
        category = category_dir.name
    return category, skill_dir.name


def load_skill(path: Path) -> dict | None:
    if SKIP_FILE.search(path.name):
        return None
    try:
        text = read_text(path, 12000)
    except OSError:
        return None
    raw, body = split_frontmatter(text)
    category, folder = skill_identity(path)
    name = field(raw, "name") or folder
    description = field(raw, "description")
    return {
        "name": name,
        "category": category,
        "folder": folder,
        "description": clip(description, 400),
        "body": clip(body, 900),
        "tags": bracket_list(raw, "tags")[:8],
        "related": bracket_list(raw, "related_skills")[:6],
        "path": str(path),
    }


def iter_skills(skills_root: Path):
    if not skills_root.is_dir():
        return
    # Bundled skills are often symlinked. rglob does not follow those links,
    # so the main library would look empty of them while profiles still had copies.
    seen = set()
    for dirpath, dirnames, filenames in os.walk(skills_root, followlinks=True):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        real = os.path.realpath(dirpath)
        if real in seen:
            dirnames[:] = []
            continue
        seen.add(real)
        if "SKILL.md" not in filenames:
            continue
        path = Path(dirpath) / "SKILL.md"
        relative = Path(os.path.relpath(path, skills_root))
        if any(part.startswith(".") for part in relative.parts):
            continue
        yield path


def load_jobs(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    jobs = data.get("jobs", []) if isinstance(data, dict) else data
    if isinstance(jobs, dict):
        jobs = list(jobs.values())
    return [job for job in jobs if isinstance(job, dict)]


def schedule_label(job: dict) -> str:
    display = job.get("schedule_display")
    if isinstance(display, str) and display.strip():
        return display.strip()[:160]
    schedule = job.get("schedule")
    if isinstance(schedule, dict):
        for key in ("display", "expr", "cron", "value", "kind"):
            value = schedule.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:160]
    return ""


def script_note(job: dict) -> str:
    script = job.get("script")
    if not isinstance(script, str) or not script.strip():
        return ""
    if "\n" in script or len(script) > 180:
        return "Has an inline script. The script body was not loaded."
    return script.strip()[:180]


def model_pin(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return {}
    in_model = False
    found = {}
    allowed = {"default", "provider", "reasoning_effort", "service_tier"}
    for line in lines:
        if re.match(r"^model:\s*$", line):
            in_model = True
            continue
        if in_model and re.match(r"^\S", line):
            break
        if not in_model:
            continue
        match = re.match(r"^\s+([A-Za-z0-9_]+):\s*(.+)$", line)
        if not match or match.group(1) not in allowed:
            continue
        value = match.group(2).strip().strip("\"'")
        if SECRET.search(value):
            continue
        found[match.group(1)] = value[:120]
    return found


def safe_rows(db_path: Path, limit: int = 40) -> list[str]:
    if not db_path.is_file():
        return []
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:
        return []
    titles = []
    try:
        tables = [row[0] for row in conn.execute("select name from sqlite_master where type='table'")]
        for table in tables:
            if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                continue
            columns = []
            for row in conn.execute(f"pragma table_info({table})"):
                if re.fullmatch(r"[A-Za-z0-9_]+", row[1]):
                    columns.append(row[1])
            for column in ("title", "name", "summary"):
                if column not in columns:
                    continue
                try:
                    rows = conn.execute(
                        f"select {column} from {table} where {column} is not null limit ?",
                        (limit,),
                    ).fetchall()
                except sqlite3.Error:
                    continue
                for (value,) in rows:
                    if isinstance(value, str) and value.strip():
                        titles.append(clip(value, 140))
                if titles:
                    return titles[:limit]
    finally:
        conn.close()
    return titles[:limit]


def session_rows(path: Path, limit: int) -> list[dict]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = []
    if isinstance(data, dict):
        values = data.values()
    elif isinstance(data, list):
        values = data
    else:
        return []
    for value in values:
        if isinstance(value, dict):
            rows.append(value)
    rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return rows[:limit]


def add(neurons: list[dict], **neuron) -> dict:
    neuron.setdefault("links", [])
    neuron.setdefault("tags", [])
    neuron.setdefault("path", "")
    neuron["summary"] = clip(neuron.get("summary", ""), 220)
    neuron["body"] = clip(neuron.get("body", ""), 900)
    neurons.append(neuron)
    return neuron


def region_for_category(index: int) -> str:
    return "frontal-l" if index % 2 == 0 else "frontal-r"


def profile_region(index: int) -> str:
    return "parietal-l" if index % 2 == 0 else "parietal-r"


def scan(home: Path) -> dict:
    neurons: list[dict] = []
    root_skills: dict[str, str] = {}
    root_keys: set[str] = set()
    folder_to_name: dict[str, str] = {}
    by_name: dict[str, list[str]] = {}

    categories = []
    seen_categories = []
    for path in sorted(iter_skills(home / "skills"), key=lambda item: str(item).lower()):
        skill = load_skill(path)
        if not skill:
            continue
        if skill["category"] not in seen_categories:
            seen_categories.append(skill["category"])
        categories.append(skill)
        root_skills[skill["name"]] = skill["description"]
        root_keys.add(skill["name"])
        root_keys.add(skill["folder"])
        folder_to_name[skill["name"]] = skill["name"]
        folder_to_name[skill["folder"]] = skill["name"]

    category_region = {
        name: region_for_category(index) for index, name in enumerate(seen_categories)
    }
    for skill in categories:
        region = category_region[skill["category"]]
        neuron_id = f"skill:{skill['category']}/{skill['name']}"
        add(
            neurons,
            id=neuron_id,
            name=skill["name"],
            lobe="skills",
            region=region,
            kind="skill",
            category=skill["category"],
            summary=skill["description"] or first_line(skill["body"]),
            body=skill["body"] or skill["description"],
            path=os.path.relpath(skill["path"], home),
            tags=skill["tags"],
            links=[],
            related=skill["related"],
        )
        by_name.setdefault(skill["name"], []).append(neuron_id)

    memory_hashes = {}
    for memory_name, lobe, region in (
        ("MEMORY.md", "memory", "temporal-l"),
        ("USER.md", "user", "temporal-r"),
    ):
        path = home / "memories" / memory_name
        if not path.is_file():
            continue
        text = read_text(path, 200_000)
        memory_hashes[memory_name] = digest(text)
        parts = sections(text)
        truncated = len(re.split(r"(?:^|\n)\s*§\s*(?:\n|$)", text)) > 40
        for index, part in enumerate(parts, start=1):
            add(
                neurons,
                id=f"{lobe}:{index}",
                name=first_line(part, 72) or f"{memory_name} {index}",
                lobe=lobe,
                region=region,
                kind="memory",
                summary=first_line(part, 180),
                body=clip(part, 700) + ("\n\nFurther sections were left out of this scan." if truncated and index == len(parts) else ""),
                path=f"memories/{memory_name}",
            )

    soul_path = home / "SOUL.md"
    soul_hash = ""
    if soul_path.is_file():
        soul = read_text(soul_path, 8000)
        soul_hash = digest(soul)
        add(
            neurons,
            id="soul:main",
            name="SOUL",
            lobe="soul",
            region="corpus",
            kind="soul",
            summary=first_line(soul, 180),
            body=clip(soul, 900),
            path="SOUL.md",
        )

    pin = model_pin(home / "config.yaml")
    if pin:
        lines = [f"{key}: {value}" for key, value in pin.items()]
        add(
            neurons,
            id="model:pin",
            name="Model pin",
            lobe="model",
            region="corpus",
            kind="model",
            summary=" · ".join(lines)[:220],
            body="\n".join(lines) + "\n\nSecret values in config were not loaded.",
            path="config.yaml",
        )

    def add_jobs(jobs_path: Path, lobe: str, region: str, prefix: str):
        count = 0
        for job in load_jobs(jobs_path):
            count += 1
            name = str(job.get("name") or job.get("id") or f"job {count}")
            prompt = job.get("prompt") if isinstance(job.get("prompt"), str) else ""
            state = str(job.get("state") or "")
            enabled = job.get("enabled")
            status = "paused" if enabled is False or state == "paused" else (state or "scheduled")
            skills = job.get("skills") if isinstance(job.get("skills"), list) else []
            skill_names = [str(item) for item in skills if isinstance(item, str)]
            if isinstance(job.get("skill"), str) and job["skill"] not in skill_names:
                skill_names.append(job["skill"])
            body_lines = [
                f"Status: {status}",
                f"Schedule: {schedule_label(job) or 'unknown'}",
                f"Last run: {job.get('last_run_at') or 'never'}",
                f"Last status: {job.get('last_status') or 'unknown'}",
                f"Next run: {job.get('next_run_at') or 'unknown'}",
                f"Skills: {', '.join(skill_names) if skill_names else 'none'}",
            ]
            note = script_note(job)
            if note:
                body_lines.append(f"Script: {note}")
            if job.get("no_agent"):
                body_lines.append("Runs the script only. No agent turn.")
            deliver = job.get("deliver")
            if isinstance(deliver, str) and deliver.strip():
                body_lines.append(f"Deliver: {clip(deliver, 120)}")
            elif isinstance(deliver, list):
                shown = ", ".join(clip(str(item), 60) for item in deliver[:4])
                if shown:
                    body_lines.append(f"Deliver: {shown}")
            if isinstance(job.get("last_error"), str) and job["last_error"].strip():
                body_lines.append(f"Last error: {clip(job['last_error'], 180)}")
            if prompt.strip():
                body_lines.append("")
                body_lines.append(clip(prompt, 700))
            neuron = add(
                neurons,
                id=f"{prefix}{job.get('id') or count}",
                name=clip(name, 80),
                lobe=lobe,
                region=region,
                kind="job",
                summary=f"{status} · {schedule_label(job) or 'no schedule'}",
                body="\n".join(body_lines),
                path=os.path.relpath(jobs_path, home),
                links=[],
                skill_names=skill_names,
            )
            neuron["skill_names"] = skill_names
        return count

    job_count = add_jobs(home / "cron" / "jobs.json", "jobs", "cerebellum", "job:")
    if job_count == 0:
        add(
            neurons,
            id="job:none",
            name="No jobs on this brain",
            lobe="jobs",
            region="cerebellum",
            kind="job",
            summary="This Hermes home has an empty cron store.",
            body="Live company jobs are on the droplet brain, in /root/.hermes/cron/jobs.json.",
            path="cron/jobs.json",
        )

    heartbeat = home / "cron" / "ticker_heartbeat"
    if heartbeat.is_file():
        stamp = clip(read_text(heartbeat, 80), 80)
        add(
            neurons,
            id="heartbeat:ticker",
            name="Heartbeat",
            lobe="heartbeat",
            region="brainstem",
            kind="heartbeat",
            summary=f"Ticker last wrote {stamp}" if stamp else "Ticker file is present.",
            body=f"cron/ticker_heartbeat\n{stamp}\n\nThis is the scheduler pulse, not a chat.",
            path="cron/ticker_heartbeat",
        )

    hook_root = home / "hooks"
    hook_names = []
    if hook_root.is_dir():
        for path in sorted(hook_root.iterdir()):
            if path.is_file() and not path.name.startswith("."):
                hook_names.append(path.name)
    if hook_names:
        add(
            neurons,
            id="hooks:list",
            name="Hooks",
            lobe="hooks",
            region="brainstem",
            kind="hook",
            summary=f"{len(hook_names)} hook files. Bodies were not loaded.",
            body="\n".join(hook_names[:40]),
            path="hooks",
        )

    for title in safe_rows(home / "kanban.db"):
        add(
            neurons,
            id="kanban:" + digest(title)[:10],
            name=title,
            lobe="kanban",
            region="parietal-l",
            kind="kanban",
            summary=title,
            body="Kanban title only. Descriptions were not loaded.",
            path="kanban.db",
        )

    session_dir = home / "sessions"
    transcript_count = len(list(session_dir.glob("*.jsonl"))) if session_dir.is_dir() else 0
    if transcript_count:
        add(
            neurons,
            id="session:files",
            name="Transcript files",
            lobe="sessions",
            region="occipital",
            kind="session",
            summary=f"{transcript_count} transcript files on disk. None were opened.",
            body="The session index is separate. Transcript text stays on the Hermes home.",
            path="sessions",
        )

    for index, row in enumerate(session_rows(home / "sessions" / "sessions.json", 40), start=1):
        platform = str(row.get("platform") or "session")
        updated = str(row.get("updated_at") or "")
        name = str(row.get("display_name") or row.get("session_id") or f"Session {index}")
        flags = []
        if row.get("suspended"):
            flags.append("suspended")
        if row.get("was_auto_reset"):
            flags.append("auto-reset")
        add(
            neurons,
            id=f"session:{index}",
            name=clip(name, 80),
            lobe="sessions",
            region="occipital",
            kind="session",
            summary=" · ".join(part for part in (platform, updated[:19], *flags) if part),
            body="Transcripts were not loaded. This is the session index only.",
            path="sessions/sessions.json",
        )

    extra_skills: dict[str, dict] = {}
    profiles_root = home / "profiles"
    shared_profiles: dict[str, list[str]] = {}
    if profiles_root.is_dir():
        profile_dirs = sorted(path for path in profiles_root.iterdir() if path.is_dir())
        for index, profile_dir in enumerate(profile_dirs):
            region = profile_region(index)
            profile_name = profile_dir.name
            shared = 0
            own = 0
            for path in iter_skills(profile_dir / "skills"):
                skill = load_skill(path)
                if not skill:
                    continue
                if skill["name"] in root_keys or skill["folder"] in root_keys:
                    shared += 1
                    key = folder_to_name.get(skill["name"]) or folder_to_name.get(skill["folder"]) or skill["name"]
                    owners = shared_profiles.setdefault(key, [])
                    if profile_name not in owners:
                        owners.append(profile_name)
                    continue
                own += 1
                key = skill["folder"] or skill["name"]
                entry = extra_skills.get(key)
                if entry is None:
                    extra_skills[key] = {
                        "skill": skill,
                        "path": os.path.relpath(path, home),
                        "profiles": [profile_name],
                    }
                elif profile_name not in entry["profiles"]:
                    entry["profiles"].append(profile_name)
            notes = [f"{profile_name} is a named bot profile."]
            notes.append(
                f"{shared} skills match the main library. {own} extra skills are drawn once, not repeated on every profile."
            )
            for memory_name in ("MEMORY.md", "USER.md", "SOUL.md"):
                if memory_name == "SOUL.md":
                    path = profile_dir / "SOUL.md"
                    root_hash = soul_hash
                else:
                    path = profile_dir / "memories" / memory_name
                    root_hash = memory_hashes.get(memory_name, "")
                if not path.is_file():
                    continue
                text = read_text(path, 80_000)
                if root_hash and digest(text) == root_hash:
                    notes.append(f"{memory_name} matches the main brain.")
                    continue
                parts = sections(text, 12)
                notes.append(f"{memory_name} differs ({len(parts)} sections shown).")
                for part_index, part in enumerate(parts, start=1):
                    add(
                        neurons,
                        id=f"profile:{profile_name}:{memory_name}:{part_index}",
                        name=f"{profile_name} · {first_line(part, 48) or memory_name}",
                        lobe="profiles",
                        region=region,
                        kind="memory",
                        category=profile_name,
                        summary=first_line(part, 180),
                        body=clip(part, 700),
                        path=os.path.relpath(path, home),
                    )
            profile_jobs = add_jobs(
                profile_dir / "cron" / "jobs.json",
                "profiles",
                region,
                f"profile:{profile_name}:job:",
            )
            if profile_jobs:
                notes.append(f"{profile_jobs} cron jobs of its own.")
            add(
                neurons,
                id=f"profile:{profile_name}",
                name=profile_name,
                lobe="profiles",
                region=region,
                kind="profile",
                category=profile_name,
                summary=" ".join(notes)[:220],
                body="\n".join(notes),
                path=os.path.relpath(profile_dir, home),
            )
        for index, entry in enumerate(sorted(extra_skills.items())):
            skill = entry[1]["skill"]
            owners = ", ".join(entry[1]["profiles"])
            neuron_id = f"skill:profile-pack/{skill['name']}"
            add(
                neurons,
                id=neuron_id,
                name=skill["name"],
                lobe="skills",
                region=region_for_category(index),
                kind="skill",
                category=skill["category"],
                summary=f"On {owners}. {skill['description']}".strip(),
                body=skill["body"] or skill["description"],
                path=entry[1]["path"],
                tags=skill["tags"],
                related=skill["related"],
                copies=entry[1]["profiles"],
            )
            by_name.setdefault(skill["name"], []).append(neuron_id)
        for neuron in neurons:
            if neuron.get("kind") != "skill" or neuron.get("copies"):
                continue
            owners = shared_profiles.get(neuron.get("name"))
            if owners:
                neuron["copies"] = owners

    vault_candidates = [
        home.parent / "Obsidian" / "PennLiberty-Brain",
    ]
    vault_file = Path(__file__).resolve().parent.parent / ".vault-path"
    if vault_file.is_file():
        vault_line = vault_file.read_text(encoding="utf-8").splitlines()
        if vault_line and vault_line[0].strip():
            vault_candidates.append(Path(vault_line[0].strip()))
    for vault in vault_candidates:
        if vault.is_dir():
            add(
                neurons,
                id="vault:company",
                name="Company vault",
                lobe="vault",
                region="occipital",
                kind="vault",
                summary="An Obsidian vault sits next to this home. It is not this agent brain.",
                body=(
                    f"Present at {vault}.\n\n"
                    "PDFs and property files were not loaded. Open Obsidian for the vault. "
                    "This cortex is skills, memory, jobs, profiles, and sessions."
                ),
                path=str(vault),
            )
            break

    id_set = {neuron["id"] for neuron in neurons}
    for neuron in neurons:
        links = []
        for related in neuron.pop("related", []):
            links.extend(by_name.get(related, [])[:3])
        for skill_name in neuron.get("skill_names") or []:
            links.extend(by_name.get(skill_name, [])[:3])
        # Mentioned skill names inside memory, capped so the synapses stay readable.
        if neuron["kind"] in {"memory", "soul", "profile"}:
            haystack = f"{neuron['name']}\n{neuron['summary']}".lower()
            hits = 0
            for skill_name, ids in by_name.items():
                if len(skill_name) < 6:
                    continue
                if skill_name.lower() in haystack:
                    links.extend(ids[:1])
                    hits += 1
                    if hits >= 4:
                        break
        neuron["links"] = [link for link in dict.fromkeys(links) if link in id_set and link != neuron["id"]][:8]

    lobes = [
        {"id": "skills", "name": "Skills", "blurb": "Procedures she can run."},
        {"id": "memory", "name": "Memory", "blurb": "What she kept about the work."},
        {"id": "user", "name": "User", "blurb": "What she believes about you."},
        {"id": "soul", "name": "Soul", "blurb": "The standing voice."},
        {"id": "model", "name": "Model", "blurb": "The live model pin. No secrets."},
        {"id": "jobs", "name": "Jobs", "blurb": "Cron. The cerebellum."},
        {"id": "profiles", "name": "Profiles", "blurb": "Named bots. Shared skills stay in the main library."},
        {"id": "sessions", "name": "Sessions", "blurb": "Recent chats. No transcripts."},
        {"id": "kanban", "name": "Kanban", "blurb": "Work titles only."},
        {"id": "hooks", "name": "Hooks", "blurb": "File names only."},
        {"id": "heartbeat", "name": "Heartbeat", "blurb": "Scheduler pulse."},
        {"id": "vault", "name": "Vault", "blurb": "Obsidian company library. Not scanned."},
    ]
    present = {neuron["lobe"] for neuron in neurons}
    return {
        "neurons": neurons,
        "lobes": [lobe for lobe in lobes if lobe["id"] in present],
        "stats": {
            "neurons": len(neurons),
            "skills": sum(1 for neuron in neurons if neuron["kind"] == "skill" and neuron["lobe"] == "skills"),
            "jobs": sum(1 for neuron in neurons if neuron["kind"] == "job" and neuron["lobe"] == "jobs" and neuron["id"] != "job:none"),
            "profiles": sum(1 for neuron in neurons if neuron["kind"] == "profile"),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan a Hermes home into a brain map.")
    parser.add_argument("--home", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--label", default="Hermes")
    parser.add_argument("--host", default="")
    args = parser.parse_args()
    home = Path(args.home).expanduser().resolve()
    if not home.is_dir():
        raise SystemExit(f"Hermes home not found: {home}")
    brain = scan(home)
    brain["source"] = {
        "label": args.label,
        "host": args.host,
        "home": str(home),
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "note": "Read-only scan. Staged edits stay in this app. Nothing here writes the Hermes home.",
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(brain, ensure_ascii=False, indent=2), encoding="utf-8")
    stats = brain["stats"]
    print(
        f"neurons={stats['neurons']} skills={stats['skills']} jobs={stats['jobs']} "
        f"profiles={stats['profiles']} out={out}"
    )


if __name__ == "__main__":
    main()
