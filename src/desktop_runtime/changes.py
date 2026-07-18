"""Review-domain contracts for local Git/runtime changes."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ChangedFile:
    path: str
    status: str
    additions: int | None = None
    deletions: int | None = None
