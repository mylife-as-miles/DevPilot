"""Persistent DevPilot project and conversation APIs.

The desktop renderer never owns this data.  A project stores its conversations
inside ``.devpilot/sessions`` while this module keeps the live Coordinator
handles in the long-lived Python runtime process.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from .._app import GLOBAL_CONFIG_DIR
from ..coordinator.checkpoint import read_messages, write_messages
from .runtime import ResearchRequest, SessionEvent

if TYPE_CHECKING:
    from .runtime import DevPilotSDK


CONVERSATION_SCHEMA_VERSION = 1
PROJECT_REGISTRY_SCHEMA_VERSION = 1
_ACTIVE_STATES = {"starting", "working", "cancelling", "resuming"}
_SANDBOX_VALUES = {"read-only", "workspace-write", "full-access"}


def _now() -> float:
    return time.time()


def _stable_project_id(path: Path) -> str:
    digest = hashlib.sha256(str(path).encode("utf-8")).hexdigest()
    return f"project-{digest[:20]}"


def _atomic_json_write(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    os.replace(temporary, path)


def _append_json_line(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


@dataclass(frozen=True, slots=True)
class ProjectRecord:
    id: str
    path: str
    name: str
    created_at: float
    last_opened_at: float

    def as_protocol(self) -> dict[str, Any]:
        return {
            "projectId": self.id,
            "path": self.path,
            "name": self.name,
            "createdAt": self.created_at,
            "lastOpenedAt": self.last_opened_at,
        }


@dataclass(frozen=True, slots=True)
class ConversationRecord:
    id: str
    project_id: str
    title: str
    state: str
    created_at: float
    updated_at: float
    provider: str
    model: str
    reasoning_effort: str
    sandbox: str
    pinned: bool = False
    archived: bool = False
    active_run_id: str | None = None
    last_error: str | None = None

    def as_protocol(self) -> dict[str, Any]:
        return {
            "conversationId": self.id,
            "projectId": self.project_id,
            "title": self.title,
            "state": self.state,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "provider": self.provider,
            "model": self.model,
            "reasoningEffort": self.reasoning_effort,
            "sandbox": self.sandbox,
            "pinned": self.pinned,
            "archived": self.archived,
            "activeRunId": self.active_run_id,
            "lastError": self.last_error,
        }


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    id: str
    turn_id: str
    role: str
    text: str
    created_at: float
    kind: str = "message"

    def as_protocol(self) -> dict[str, Any]:
        return {
            "messageId": self.id,
            "turnId": self.turn_id,
            "role": self.role,
            "text": self.text,
            "kind": self.kind,
            "createdAt": self.created_at,
        }


@dataclass(frozen=True, slots=True)
class ConversationEvent:
    name: str
    data: Mapping[str, Any]


ConversationEventHandler = Callable[[ConversationEvent], Awaitable[None] | None]


class ProjectRegistry:
    """Python-owned index of local projects known to the desktop."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or GLOBAL_CONFIG_DIR / "desktop-projects.json"

    def open(self, raw_path: str | Path) -> ProjectRecord:
        resolved = Path(raw_path).expanduser().resolve()
        if not resolved.is_dir():
            raise ValueError("The selected project folder is unavailable.")
        now = _now()
        project_id = _stable_project_id(resolved)
        metadata_path = resolved / ".devpilot" / "project.json"
        existing_metadata = _read_json(metadata_path) or {}
        created_at = _number(existing_metadata.get("createdAt"), now)
        record = ProjectRecord(
            id=project_id,
            path=str(resolved),
            name=resolved.name or str(resolved),
            created_at=created_at,
            last_opened_at=now,
        )
        _atomic_json_write(metadata_path, {
            "schemaVersion": PROJECT_REGISTRY_SCHEMA_VERSION,
            "projectId": record.id,
            "path": record.path,
            "name": record.name,
            "createdAt": record.created_at,
            "lastOpenedAt": record.last_opened_at,
        })
        projects = {project.id: project for project in self.list()}
        projects[record.id] = record
        self._write(projects.values())
        return record

    def list(self) -> list[ProjectRecord]:
        raw = _read_json(self._path) or {}
        entries = raw.get("projects") if isinstance(raw.get("projects"), list) else []
        records: list[ProjectRecord] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            path = str(entry.get("path") or "").strip()
            project_id = str(entry.get("projectId") or "").strip()
            if not path or not project_id or not Path(path).is_dir():
                continue
            records.append(ProjectRecord(
                id=project_id,
                path=str(Path(path).resolve()),
                name=str(entry.get("name") or Path(path).name or path),
                created_at=_number(entry.get("createdAt"), _now()),
                last_opened_at=_number(entry.get("lastOpenedAt"), _now()),
            ))
        return sorted(records, key=lambda record: record.last_opened_at, reverse=True)

    def get(self, project_id: str) -> ProjectRecord | None:
        return next((record for record in self.list() if record.id == project_id), None)

    def remove(self, project_id: str) -> bool:
        records = self.list()
        retained = [record for record in records if record.id != project_id]
        if len(retained) == len(records):
            return False
        self._write(retained)
        return True

    def _write(self, records: Any) -> None:
        _atomic_json_write(self._path, {
            "schemaVersion": PROJECT_REGISTRY_SCHEMA_VERSION,
            "projects": [record.as_protocol() for record in records],
        })


class DevPilotConversation:
    """A persistent coding conversation backed by one project-local session."""

    def __init__(self, sdk: "DevPilotSDK", project: ProjectRecord, record: ConversationRecord) -> None:
        self._sdk = sdk
        self.project = project
        self._record = record
        self._handlers: list[ConversationEventHandler] = []
        self._runtime: Any | None = None
        self._run_task: asyncio.Task[None] | None = None

    @property
    def record(self) -> ConversationRecord:
        return self._record

    @property
    def directory(self) -> Path:
        return Path(self.project.path) / ".devpilot" / "sessions" / self._record.id

    @property
    def messages_path(self) -> Path:
        return self.directory / "transcript.jsonl"

    @property
    def events_path(self) -> Path:
        return self.directory / "events.jsonl"

    @property
    def record_path(self) -> Path:
        return self.directory / "conversation.json"

    @property
    def running(self) -> bool:
        return self._run_task is not None and not self._run_task.done()

    def subscribe(self, handler: ConversationEventHandler) -> Callable[[], None]:
        self._handlers.append(handler)

        def unsubscribe() -> None:
            try:
                self._handlers.remove(handler)
            except ValueError:
                pass

        return unsubscribe

    async def send(self, text: str) -> dict[str, str]:
        prompt = text.strip()
        if not prompt:
            raise ValueError("A conversation message is required.")
        if self.running:
            raise RuntimeError("This DevPilot conversation is already running.")

        turn_id = f"turn-{uuid4()}"
        run_id = f"run-{uuid4()}"
        now = _now()
        if self._record.title == "New conversation":
            self._update_record(title=_title_from_prompt(prompt))
        self._append_message(ConversationMessage(
            id=f"message-{uuid4()}", turn_id=turn_id, role="user", text=prompt, created_at=now,
        ))
        state = "resuming" if self._has_runtime_context() else "starting"
        self._update_record(state=state, active_run_id=run_id, last_error=None)
        self._emit("run.started", {"turnId": turn_id, "runId": run_id, "state": state})
        self._run_task = asyncio.create_task(self._run(turn_id, run_id, prompt, resume=state == "resuming"))
        return {"turnId": turn_id, "runId": run_id}

    async def wait_for_run(self) -> None:
        if self._run_task is not None:
            await self._run_task

    async def cancel(self) -> None:
        if not self.running or self._runtime is None:
            return
        self._update_record(state="cancelling")
        self._emit("run.status", {"runId": self._record.active_run_id, "state": "cancelling"})
        await self._runtime.cancel()

    async def resume(self, text: str = "Continue the current work.") -> dict[str, str]:
        return await self.send(text)

    def rename(self, title: str) -> ConversationRecord:
        title = title.strip()
        if not title:
            raise ValueError("A conversation title is required.")
        self._update_record(title=title)
        self._emit("conversation.renamed", {"title": title})
        return self._record

    def pin(self, pinned: bool) -> ConversationRecord:
        self._update_record(pinned=bool(pinned))
        self._emit("conversation.pinned", {"pinned": self._record.pinned})
        return self._record

    def archive(self, archived: bool = True) -> ConversationRecord:
        self._update_record(archived=bool(archived))
        self._emit("conversation.updated", {"archived": self._record.archived})
        return self._record

    def messages(self) -> list[ConversationMessage]:
        if not self.messages_path.is_file():
            return []
        messages: list[ConversationMessage] = []
        for raw_line in self.messages_path.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            if not isinstance(value, dict):
                continue
            text = value.get("text")
            if not isinstance(text, str):
                continue
            messages.append(ConversationMessage(
                id=str(value.get("messageId") or ""),
                turn_id=str(value.get("turnId") or ""),
                role=str(value.get("role") or "assistant"),
                text=text,
                created_at=_number(value.get("createdAt"), 0),
                kind=str(value.get("kind") or "message"),
            ))
        return messages

    async def _run(self, turn_id: str, run_id: str, prompt: str, *, resume: bool) -> None:
        try:
            if resume:
                self._append_follow_up_to_checkpoint(prompt)
            options = {
                "provider": "openai-oauth",
                "model": self._record.model,
                "reasoning_effort": self._record.reasoning_effort,
                "workspace_dir": str(self.directory),
                "sandbox": self._record.sandbox,
            }
            request = ResearchRequest(cwd=Path(self.project.path), task=prompt, resume=resume, options=options)
            runtime = self._sdk.create_session(request)
            self._runtime = runtime
            runtime.subscribe(lambda event: self._on_runtime_event(run_id, event))
            self._update_record(state="working")
            self._emit("coordinator.started", {"runId": run_id})
            report = await runtime.run()
            self._append_message(ConversationMessage(
                id=f"message-{uuid4()}", turn_id=turn_id, role="assistant", text=report, created_at=_now(), kind="message",
            ))
            self._update_record(state="completed", active_run_id=None, last_error=None)
            self._emit("assistant.message", {"turnId": turn_id, "runId": run_id, "text": report})
            self._emit("run.completed", {"turnId": turn_id, "runId": run_id})
        except asyncio.CancelledError:
            self._update_record(state="cancelled", active_run_id=None)
            self._emit("run.cancelled", {"turnId": turn_id, "runId": run_id})
        except Exception as exc:
            message = _safe_error(exc)
            self._update_record(state="failed", active_run_id=None, last_error=message)
            self._emit("run.failed", {"turnId": turn_id, "runId": run_id, "message": message})
        finally:
            self._runtime = None

    def _on_runtime_event(self, run_id: str, event: SessionEvent) -> None:
        payload = {"conversationId": self._record.id, "projectId": self.project.id, "runId": run_id, **dict(event.data)}
        name = _desktop_event_name(event.type)
        _append_json_line(self.events_path, {"event": name, "data": payload, "createdAt": _now()})
        self._emit(name, payload)

    def _emit(self, name: str, data: Mapping[str, Any]) -> None:
        payload = {"projectId": self.project.id, "conversationId": self._record.id, **dict(data)}
        for handler in tuple(self._handlers):
            result = handler(ConversationEvent(name, payload))
            if asyncio.iscoroutine(result):
                asyncio.create_task(result)

    def _append_message(self, message: ConversationMessage) -> None:
        _append_json_line(self.messages_path, message.as_protocol())
        self._emit("conversation.updated", {"message": message.as_protocol()})

    def _update_record(self, **updates: Any) -> None:
        data = asdict(self._record)
        data.update(updates)
        data["updated_at"] = _now()
        self._record = ConversationRecord(**data)
        _atomic_json_write(self.record_path, _record_payload(self._record))
        self._emit("conversation.updated", {"conversation": self._record.as_protocol()})

    def _has_runtime_context(self) -> bool:
        return (self.directory / ".coordinator" / "idea_tree.json").is_file()

    def _append_follow_up_to_checkpoint(self, prompt: str) -> None:
        messages_path = self.directory / ".coordinator" / "messages.jsonl"
        messages = read_messages(messages_path)
        messages.append({"role": "user", "content": prompt})
        write_messages(messages_path, messages)


class ConversationStore:
    """Own project records and live conversation handles for one SDK process."""

    def __init__(self, sdk: "DevPilotSDK", *, registry_path: Path | None = None) -> None:
        self._sdk = sdk
        self._projects = ProjectRegistry(registry_path)
        self._live: dict[tuple[str, str], DevPilotConversation] = {}

    async def open_project(self, cwd: str | Path) -> ProjectRecord:
        return self._projects.open(cwd)

    async def list_projects(self) -> list[ProjectRecord]:
        return self._projects.list()

    async def get_project(self, project_id: str) -> ProjectRecord | None:
        return self._projects.get(project_id)

    async def remove_project(self, project_id: str) -> bool:
        return self._projects.remove(project_id)

    async def create(
        self,
        *,
        cwd: str | Path,
        title: str = "New conversation",
        provider: str = "codex",
        model: str,
        reasoning_effort: str = "high",
        sandbox: str = "workspace-write",
    ) -> DevPilotConversation:
        if provider != "codex":
            raise ValueError("DevPilot desktop currently supports the Codex provider only.")
        if sandbox not in _SANDBOX_VALUES:
            raise ValueError("Sandbox must be read-only, workspace-write, or full-access.")
        if not model.strip() or not reasoning_effort.strip():
            raise ValueError("A Codex model and reasoning effort are required.")
        project = self._projects.open(cwd)
        now = _now()
        record = ConversationRecord(
            id=f"conversation-{uuid4()}",
            project_id=project.id,
            title=title.strip() or "New conversation",
            state="idle",
            created_at=now,
            updated_at=now,
            provider=provider,
            model=model.strip(),
            reasoning_effort=reasoning_effort.strip(),
            sandbox=sandbox,
        )
        conversation = DevPilotConversation(self._sdk, project, record)
        conversation.directory.mkdir(parents=True, exist_ok=False)
        _atomic_json_write(conversation.record_path, _record_payload(record))
        self._live[(project.id, record.id)] = conversation
        conversation._emit("conversation.created", {"conversation": record.as_protocol()})
        return conversation

    async def list(self, project_id: str, *, include_archived: bool = False) -> list[ConversationRecord]:
        project = self._projects.get(project_id)
        if project is None:
            return []
        root = Path(project.path) / ".devpilot" / "sessions"
        if not root.is_dir():
            return []
        records: list[ConversationRecord] = []
        for candidate in root.iterdir():
            record = _load_record(candidate / "conversation.json")
            if record is None or record.project_id != project.id:
                continue
            if record.state in _ACTIVE_STATES:
                live = self._live.get((project.id, record.id))
                if live is not None and live.running:
                    record = live.record
                else:
                    record = _interrupted_record(record)
                    _atomic_json_write(candidate / "conversation.json", _record_payload(record))
            if include_archived or not record.archived:
                records.append(record)
        return sorted(records, key=lambda record: record.updated_at, reverse=True)

    async def open(self, project_id: str, conversation_id: str) -> DevPilotConversation:
        key = (project_id, conversation_id)
        existing = self._live.get(key)
        if existing is not None:
            return existing
        project = self._projects.get(project_id)
        if project is None:
            raise ValueError("The DevPilot project is unavailable.")
        record = _load_record(Path(project.path) / ".devpilot" / "sessions" / conversation_id / "conversation.json")
        if record is None or record.project_id != project.id:
            raise ValueError("The DevPilot conversation is unavailable.")
        if record.state in _ACTIVE_STATES:
            record = _interrupted_record(record)
        conversation = DevPilotConversation(self._sdk, project, record)
        _atomic_json_write(conversation.record_path, _record_payload(record))
        self._live[key] = conversation
        return conversation

    async def delete(self, project_id: str, conversation_id: str) -> bool:
        conversation = await self.open(project_id, conversation_id)
        if conversation.running:
            raise RuntimeError("Cancel the active run before deleting this conversation.")
        # Preserve project-local artifacts for recovery; hide the conversation
        # from normal lists instead of recursively deleting user work.
        conversation.archive(True)
        return True

    async def shutdown(self) -> None:
        for conversation in tuple(self._live.values()):
            if conversation.running:
                await conversation.cancel()


def _number(value: object, fallback: float) -> float:
    return float(value) if isinstance(value, (int, float)) else fallback


def _record_payload(record: ConversationRecord) -> dict[str, Any]:
    return {"schemaVersion": CONVERSATION_SCHEMA_VERSION, "conversation": record.as_protocol()}


def _load_record(path: Path) -> ConversationRecord | None:
    raw = _read_json(path)
    value = raw.get("conversation") if isinstance(raw, dict) and isinstance(raw.get("conversation"), dict) else None
    if value is None:
        return None
    conversation_id = str(value.get("conversationId") or "").strip()
    project_id = str(value.get("projectId") or "").strip()
    if not conversation_id or not project_id:
        return None
    return ConversationRecord(
        id=conversation_id,
        project_id=project_id,
        title=str(value.get("title") or "New conversation"),
        state=str(value.get("state") or "idle"),
        created_at=_number(value.get("createdAt"), _now()),
        updated_at=_number(value.get("updatedAt"), _now()),
        provider=str(value.get("provider") or "codex"),
        model=str(value.get("model") or ""),
        reasoning_effort=str(value.get("reasoningEffort") or "high"),
        sandbox=str(value.get("sandbox") or "workspace-write"),
        pinned=bool(value.get("pinned")),
        archived=bool(value.get("archived")),
        active_run_id=str(value.get("activeRunId") or "") or None,
        last_error=str(value.get("lastError") or "") or None,
    )


def _interrupted_record(record: ConversationRecord) -> ConversationRecord:
    data = asdict(record)
    data.update({"state": "interrupted", "active_run_id": None, "updated_at": _now()})
    return ConversationRecord(**data)


def _desktop_event_name(event_type: str) -> str:
    normalized = str(event_type or "").strip().lower().replace("_", ".")
    if "executor" in normalized and "fail" in normalized:
        return "executor.failed"
    if "executor" in normalized and ("finish" in normalized or "complete" in normalized):
        return "executor.completed"
    if "executor" in normalized:
        return "executor.updated"
    if "tool" in normalized and ("error" in normalized or "fail" in normalized):
        return "tool.failed"
    if "tool" in normalized and ("end" in normalized or "complete" in normalized):
        return "tool.completed"
    if "tool" in normalized:
        return "tool.started"
    if "think" in normalized:
        return "assistant.thinking"
    return "runtime.event"


def _safe_error(error: BaseException) -> str:
    message = str(error).strip().replace("\n", " ")
    return message[:500] or "DevPilot could not complete this run."


def _title_from_prompt(prompt: str) -> str:
    compact = " ".join(prompt.split())
    return compact[:72] + ("…" if len(compact) > 72 else "")
