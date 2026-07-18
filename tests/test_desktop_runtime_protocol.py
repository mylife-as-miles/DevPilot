from __future__ import annotations

import asyncio
import io
import json
import subprocess

import pytest

from devpilot.desktop_runtime.authentication import AuthenticationStatus
from devpilot.desktop_runtime.handlers import DesktopRuntimeHandlers
from devpilot.desktop_runtime.protocol import ProtocolError, Request
from devpilot.desktop_runtime.server import DesktopRuntimeServer
from devpilot.sdk import DevPilotSDK


class FakeAuthentication:
    def __init__(self, *, signed_in: bool = True) -> None:
        self.current = AuthenticationStatus(
            signed_in=signed_in,
            account_label="local-test" if signed_in else None,
            plan="test" if signed_in else None,
        )
        self.login_calls: list[bool] = []

    def status(self) -> AuthenticationStatus:
        return self.current

    def login(self, *, open_browser: bool = True) -> AuthenticationStatus:
        self.login_calls.append(open_browser)
        self.current = AuthenticationStatus(signed_in=True, account_label="local-test", plan="test")
        return self.current

    def logout(self) -> AuthenticationStatus:
        self.current = AuthenticationStatus(signed_in=False)
        return self.current


def _serve(*frames: object, signed_in: bool = True) -> tuple[list[dict[str, object]], str, FakeAuthentication]:
    stdin = io.StringIO("".join(json.dumps(frame) + "\n" if not isinstance(frame, str) else frame + "\n" for frame in frames))
    stdout = io.StringIO()
    stderr = io.StringIO()
    auth = FakeAuthentication(signed_in=signed_in)
    asyncio.run(DesktopRuntimeServer(authentication=auth, stdin=stdin, stdout=stdout, stderr=stderr).serve())
    return [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()], stderr.getvalue(), auth


def test_desktop_runtime_uses_json_only_stdout_and_reports_bad_frames_to_stderr() -> None:
    frames, diagnostics, _auth = _serve(
        {"id": "initialize", "method": "runtime.initialize", "params": {}},
        "not json",
        {"id": "status", "method": "runtime.status", "params": {}},
    )

    assert [frame.get("id") for frame in frames if "id" in frame] == ["initialize", "status"]
    assert frames[1] == {"event": "runtime.status", "data": {"state": "ready"}}
    assert all(isinstance(frame, dict) for frame in frames)
    assert "Ignoring malformed desktop protocol JSON frame" in diagnostics


def test_desktop_runtime_auth_and_models_use_the_codex_connection(monkeypatch) -> None:
    monkeypatch.setattr(
        "devpilot.cli.user_config.llm_defaults",
        lambda: {"provider": "openai-oauth", "model": "configured-codex-model"},
    )
    frames, _diagnostics, auth = _serve(
        {"id": "models-before", "method": "models.list", "params": {}},
        {"id": "login", "method": "auth.login", "params": {"openBrowser": False}},
        {"id": "models-after", "method": "models.list", "params": {}},
        signed_in=False,
    )

    by_id = {str(frame["id"]): frame["result"] for frame in frames if "id" in frame}
    assert by_id["models-before"] == {"provider": "codex", "models": []}
    assert by_id["login"]["signedIn"] is True
    assert by_id["models-after"]["provider"] == "codex"
    assert by_id["models-after"]["models"]
    assert auth.login_calls == [False]


def test_desktop_runtime_rejects_invalid_requests_without_secret_leakage() -> None:
    frames, diagnostics, _auth = _serve(
        {"id": "unknown", "method": "session/new", "params": {}},
        {"id": "bad", "method": "auth.login", "params": {"openBrowser": "yes"}},
        {"id": "broken", "method": "runtime.status", "params": {"token": "sk-should-not-leak"}},
    )

    errors = {str(frame.get("id")): frame["error"] for frame in frames if "error" in frame}
    assert errors["unknown"]["code"] == "method_not_found"
    assert errors["bad"]["code"] == "invalid_request"
    assert "sk-should-not-leak" not in json.dumps(frames)
    assert "sk-should-not-leak" not in diagnostics


def test_desktop_runtime_shutdown_returns_a_protocol_response_then_stops() -> None:
    frames, _diagnostics, _auth = _serve(
        {"id": "shutdown", "method": "runtime.shutdown", "params": {}},
        {"id": "ignored", "method": "runtime.status", "params": {}},
    )

    assert frames == [
        {"id": "shutdown", "result": {"status": "shutting_down"}},
        {"event": "runtime.status", "data": {"state": "shutting_down"}},
    ]


def test_desktop_runtime_exposes_project_and_conversation_domain(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "devpilot.cli.user_config.llm_defaults",
        lambda: {"provider": "openai-oauth", "model": "configured-codex-model"},
    )
    emitted = []
    sdk = DevPilotSDK(project_registry_path=tmp_path / "desktop-projects.json")

    async def scenario() -> None:
        handlers = DesktopRuntimeHandlers(
            sdk=sdk,
            authentication=FakeAuthentication(),
            event_sink=lambda event: emitted.append(event),
        )
        opened = await handlers.dispatch(Request("open", "project.open", {"path": str(tmp_path)}))
        project = opened.result["project"]
        assert project["path"] == str(tmp_path.resolve())
        assert opened.result["preflight"]["readable"] is True

        created = await handlers.dispatch(Request("create", "conversation.create", {
            "projectId": project["projectId"],
            "title": "Fix the tests",
            "model": "configured-codex-model",
            "reasoningEffort": "high",
            "sandbox": "workspace-write",
        }))
        conversation = created.result["conversation"]
        assert conversation["projectId"] == project["projectId"]
        assert created.events[0].name == "conversation.created"

        listed = await handlers.dispatch(Request("list", "conversation.list", {"projectId": project["projectId"]}))
        assert [item["conversationId"] for item in listed.result["conversations"]] == [conversation["conversationId"]]
        renamed = await handlers.dispatch(Request("rename", "conversation.rename", {
            "projectId": project["projectId"],
            "conversationId": conversation["conversationId"],
            "title": "Fix the integration tests",
        }))
        assert renamed.result["conversation"]["title"] == "Fix the integration tests"
        pinned = await handlers.dispatch(Request("pin", "conversation.pin", {
            "projectId": project["projectId"],
            "conversationId": conversation["conversationId"],
            "pinned": True,
        }))
        assert pinned.result["conversation"]["pinned"] is True
        with pytest.raises(ProtocolError, match="Sandbox"):
            await handlers.dispatch(Request("invalid-sandbox", "conversation.create", {
                "projectId": project["projectId"],
                "model": "configured-codex-model",
                "reasoningEffort": "high",
                "sandbox": "anywhere",
            }))
        with pytest.raises(ProtocolError, match="reasoning effort"):
            await handlers.dispatch(Request("invalid-reasoning", "conversation.create", {
                "projectId": project["projectId"],
                "model": "configured-codex-model",
                "reasoningEffort": "unbounded",
                "sandbox": "workspace-write",
            }))
        assert any(event.name == "conversation.renamed" for event in emitted)
        assert any(event.name == "conversation.pinned" for event in emitted)

    asyncio.run(scenario())


def test_desktop_runtime_reads_local_git_review_data_from_the_project_folder(tmp_path) -> None:
    repository = tmp_path / "review-project"
    repository.mkdir()
    _git(repository, "init")
    _git(repository, "config", "user.email", "devpilot@example.test")
    _git(repository, "config", "user.name", "DevPilot Test")
    tracked = repository / "app.py"
    tracked.write_text("print('before')\n", encoding="utf-8")
    _git(repository, "add", "app.py")
    _git(repository, "commit", "-m", "Initial project")
    tracked.write_text("print('after')\n", encoding="utf-8")

    async def scenario() -> None:
        sdk = DevPilotSDK(project_registry_path=tmp_path / "desktop-projects.json")
        handlers = DesktopRuntimeHandlers(sdk=sdk, authentication=FakeAuthentication())
        opened = await handlers.dispatch(Request("open", "project.open", {"path": str(repository)}))
        project_id = opened.result["project"]["projectId"]

        listed = await handlers.dispatch(Request("changes", "changes.list", {"projectId": project_id}))
        changes = listed.result["changes"]
        assert changes["available"] is True
        assert changes["dirty"] is True
        assert changes["branch"]
        assert changes["files"] == [{
            "path": "app.py",
            "status": "M",
            "additions": 1,
            "deletions": 1,
            "included": False,
            "pending": True,
        }]

        diff = await handlers.dispatch(Request("diff", "changes.diff", {
            "projectId": project_id,
            "path": "app.py",
            "scope": "combined",
        }))
        assert "-print('before')" in diff.result["diff"]["diff"]
        assert "+print('after')" in diff.result["diff"]["diff"]

        with pytest.raises(ProtocolError, match="not a changed file"):
            await handlers.dispatch(Request("bad-diff", "changes.diff", {
                "projectId": project_id,
                "path": "outside.py",
            }))

    asyncio.run(scenario())


def _git(cwd, *arguments: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *arguments], check=True, capture_output=True, text=True)
