"""Sandbox values shared by desktop protocol handlers and the SDK."""

from __future__ import annotations

from enum import Enum

from .protocol import ProtocolError


class SandboxMode(str, Enum):
    READ_ONLY = "read-only"
    WORKSPACE_WRITE = "workspace-write"
    FULL_ACCESS = "full-access"


def parse_sandbox(value: object) -> SandboxMode:
    try:
        return SandboxMode(str(value))
    except ValueError as exc:
        raise ProtocolError(
            "invalid_sandbox",
            "Sandbox must be read-only, workspace-write, or full-access.",
        ) from exc
