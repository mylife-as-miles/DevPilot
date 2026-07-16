from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path

from devpilot.core.config_resolve import resolve_runtime_config
from devpilot.sdk.acp import AcpStdioServer


def test_runtime_config_project_and_request_override_setup(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "devpilot.cli.user_config.load_user_defaults",
        lambda: {"llm": {"provider": "openai-responses", "model": "setup-model"}},
    )
    (tmp_path / "devpilot.yaml").write_text(
        "llm:\n  provider: gemini\n  model: project-model\nmax_cycles: 7\n",
        encoding="utf-8",
    )
    config = resolve_runtime_config(cwd=tmp_path, task="test", overrides={"model": "request-model", "provider": ""})
    assert config.provider == "gemini"
    assert config.model == "request-model"
    assert config.max_cycles == 7


def test_acp_stdout_is_json_only_and_diagnostics_use_stderr(tmp_path: Path) -> None:
    stdin = io.StringIO(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
        + json.dumps({"jsonrpc": "2.0", "id": 2, "method": "session/new", "params": {"cwd": str(tmp_path)}})
        + "\nnot json\n"
    )
    stdout = io.StringIO()
    stderr = io.StringIO()
    asyncio.run(AcpStdioServer(stdin=stdin, stdout=stdout, stderr=stderr).serve())
    frames = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
    assert [frame["id"] for frame in frames] == [1, 2]
    assert all(isinstance(frame, dict) and frame["jsonrpc"] == "2.0" for frame in frames)
    assert "Ignoring malformed ACP JSON frame" in stderr.getvalue()
