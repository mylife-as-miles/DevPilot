"""Structured event values emitted by the desktop runtime."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class RuntimeEvent:
    """A DevPilot-domain event ready to be serialized by the protocol host."""

    name: str
    data: Mapping[str, Any]
