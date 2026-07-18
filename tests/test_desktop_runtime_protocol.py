from __future__ import annotations

import asyncio
import io
import json

from devpilot.desktop_runtime.authentication import AuthenticationStatus
from devpilot.desktop_runtime.server import DesktopRuntimeServer


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
