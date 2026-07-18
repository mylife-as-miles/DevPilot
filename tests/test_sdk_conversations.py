from __future__ import annotations

import asyncio
from pathlib import Path

from devpilot.coordinator.checkpoint import read_messages, write_messages
from devpilot.sdk import DevPilotSDK, SessionEvent


class FakeResearchSession:
    def __init__(self, request) -> None:
        self.request = request
        self._handlers = []
        self._cancelled = False
        self._release = asyncio.Event()

    def subscribe(self, handler):
        self._handlers.append(handler)
        return lambda: self._handlers.remove(handler)

    async def run(self) -> str:
        workspace = Path(self.request.options["workspace_dir"])
        coordinator = workspace / ".coordinator"
        coordinator.mkdir(parents=True, exist_ok=True)
        (coordinator / "idea_tree.json").write_text("{}", encoding="utf-8")
        messages = coordinator / "messages.jsonl"
        if not messages.exists():
            write_messages(messages, [{"role": "assistant", "content": "prior context"}])
        self._emit("coordinator.started", {"cwd": str(self.request.cwd)})
        if self.request.task == "block":
            await self._release.wait()
            if self._cancelled:
                raise asyncio.CancelledError
        self._emit("tool.started", {"name": "inspect"})
        return f"Completed: {self.request.task}"

    async def cancel(self) -> None:
        self._cancelled = True
        self._release.set()

    def _emit(self, event_type: str, data: dict[str, str]) -> None:
        event = SessionEvent(type=event_type, data=data, timestamp=1.0)
        for handler in tuple(self._handlers):
            handler(event)


def _sdk_with_fake_sessions(tmp_path: Path):
    sdk = DevPilotSDK(project_registry_path=tmp_path / "desktop-projects.json")
    created = []

    def create_session(request):
        session = FakeResearchSession(request)
        created.append(session)
        return session

    sdk.create_session = create_session  # type: ignore[method-assign]
    return sdk, created


def test_persistent_conversation_reuses_project_local_context_for_follow_ups(tmp_path: Path) -> None:
    sdk, sessions = _sdk_with_fake_sessions(tmp_path)

    async def scenario() -> None:
        conversation = await sdk.create_conversation(
            cwd=tmp_path,
            model="codex-test",
            reasoning_effort="high",
            sandbox="workspace-write",
        )
        events = []
        conversation.subscribe(events.append)

        first = await conversation.send("Inspect the repository")
        await conversation.wait_for_run()
        assert first["turnId"].startswith("turn-")
        assert conversation.record.state == "completed"
        assert sessions[0].request.resume is False
        assert sessions[0].request.options["workspace_dir"] == str(conversation.directory)
        assert (conversation.directory / "conversation.json").is_file()
        assert (conversation.directory / "transcript.jsonl").is_file()

        second = await conversation.send("Now inspect the database triggers")
        await conversation.wait_for_run()
        assert second["runId"].startswith("run-")
        assert sessions[1].request.resume is True
        checkpoint_messages = read_messages(conversation.directory / ".coordinator" / "messages.jsonl")
        assert checkpoint_messages[-1] == {"role": "user", "content": "Now inspect the database triggers"}
        transcript = conversation.messages()
        assert [message.role for message in transcript] == ["user", "assistant", "user", "assistant"]
        assert any(event.name == "run.completed" for event in events)
        assert any(event.name == "tool.started" for event in events)

    asyncio.run(scenario())


def test_cancelled_conversation_preserves_project_local_session(tmp_path: Path) -> None:
    sdk, _sessions = _sdk_with_fake_sessions(tmp_path)

    async def scenario() -> None:
        conversation = await sdk.create_conversation(cwd=tmp_path, model="codex-test")
        events = []
        conversation.subscribe(events.append)
        await conversation.send("block")
        await asyncio.sleep(0)
        await conversation.cancel()
        await conversation.wait_for_run()
        assert conversation.record.state == "cancelled"
        assert (conversation.directory / "conversation.json").is_file()
        assert any(event.name == "run.cancelled" for event in events)

    asyncio.run(scenario())


def test_projects_and_conversations_are_isolated_and_restore_after_runtime_restart(tmp_path: Path) -> None:
    first_project = tmp_path / "first"
    second_project = tmp_path / "second"
    first_project.mkdir()
    second_project.mkdir()
    sdk, _sessions = _sdk_with_fake_sessions(tmp_path)

    async def scenario() -> tuple[str, str, str]:
        first = await sdk.create_conversation(cwd=first_project, model="codex-test")
        second = await sdk.create_conversation(cwd=second_project, model="codex-test")
        await first.send("First project work")
        await first.wait_for_run()
        assert first.project.id != second.project.id
        assert first.directory.parent.parent.parent == first_project
        assert second.directory.parent.parent.parent == second_project
        return first.project.id, first.record.id, second.project.id

    first_project_id, conversation_id, second_project_id = asyncio.run(scenario())
    restarted_sdk, _sessions = _sdk_with_fake_sessions(tmp_path)

    async def restore() -> None:
        projects = await restarted_sdk.list_projects()
        assert {project.id for project in projects} == {first_project_id, second_project_id}
        listed = await restarted_sdk.list_conversations(first_project_id)
        assert [record.id for record in listed] == [conversation_id]
        restored = await restarted_sdk.open_conversation(first_project_id, conversation_id)
        assert restored.messages()[0].text == "First project work"
        assert restored.project.path == str(first_project.resolve())

    asyncio.run(restore())


def test_legacy_workspace_migration_preserves_messages_without_acp_identity(tmp_path: Path) -> None:
    project = tmp_path / "legacy-project"
    project.mkdir()
    sdk, _sessions = _sdk_with_fake_sessions(tmp_path)
    workspace = {
        "selectedProjectId": "old-project",
        "selectedTaskId": "old-task",
        "projects": [{
            "id": "old-project",
            "path": str(project),
            "tasks": [{
                "id": "old-task",
                "title": "Fix old task storage",
                "status": "running",
                "acpSessionId": "must-not-survive",
                "model": "default",
                "reasoningEffort": "high",
                "messages": [
                    {"role": "user", "text": "First prompt", "createdAt": 10},
                    {"role": "assistant", "text": "Prior result", "createdAt": 20},
                ],
            }],
        }],
    }

    async def scenario() -> None:
        migrated = await sdk.import_legacy_workspace(workspace, fallback_model="codex-test")
        assert migrated["importedConversations"] == 1
        assert migrated["selectedProjectId"]
        assert migrated["selectedConversationId"]
        restored = await sdk.open_conversation(migrated["selectedProjectId"], migrated["selectedConversationId"])
        assert restored.record.state == "interrupted"
        assert restored.record.model == "codex-test"
        assert [message.text for message in restored.messages()] == ["First prompt", "Prior result"]
        assert "acp" not in restored.record.id.lower()
        second = await sdk.import_legacy_workspace(workspace, fallback_model="codex-test")
        assert second["importedConversations"] == 0

    asyncio.run(scenario())
