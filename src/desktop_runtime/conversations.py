"""Conversation-domain contracts shared by the SDK and desktop protocol."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ConversationState(str, Enum):
    IDLE = "idle"
    STARTING = "starting"
    WORKING = "working"
    NEEDS_ATTENTION = "needs_attention"
    AWAITING_USER = "awaiting_user"
    AWAITING_PERMISSION = "awaiting_permission"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    RESUMING = "resuming"


@dataclass(frozen=True, slots=True)
class ConversationIdentity:
    project_id: str
    conversation_id: str
