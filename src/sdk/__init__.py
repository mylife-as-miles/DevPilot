"""Public Python API for embedding DevPilot in local clients.

The SDK is deliberately thin: it creates and observes research sessions while
the Coordinator and Executors remain the only owners of orchestration state.
"""

from .runtime import DevPilotSDK, ResearchRequest, ResearchSession, SessionEvent
from .conversations import ConversationEvent, ConversationMessage, ConversationRecord, ProjectRecord
from .acp import AcpStdioServer, serve_stdio

__all__ = [
    "DevPilotSDK",
    "AcpStdioServer",
    "ResearchRequest",
    "ResearchSession",
    "SessionEvent",
    "ConversationEvent",
    "ConversationMessage",
    "ConversationRecord",
    "ProjectRecord",
    "serve_stdio",
]
