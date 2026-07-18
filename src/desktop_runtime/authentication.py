"""ChatGPT/Codex authentication facade for the desktop runtime."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AuthenticationStatus:
    signed_in: bool
    provider: str = "codex"
    account_label: str | None = None
    plan: str | None = None
    expires_soon: bool = False

    def as_protocol(self) -> dict[str, object]:
        return {
            "signedIn": self.signed_in,
            "provider": self.provider,
            "accountLabel": self.account_label,
            "plan": self.plan,
            "expiresSoon": self.expires_soon,
        }


class ChatGPTAuthentication:
    """Uses DevPilot's existing local ChatGPT OAuth storage and flow."""

    def status(self) -> AuthenticationStatus:
        from ..core.oauth import openai as oauth

        tokens = oauth.load_tokens()
        if tokens is None:
            return AuthenticationStatus(signed_in=False)
        return AuthenticationStatus(
            signed_in=True,
            account_label=tokens.account_id or None,
            plan=tokens.plan_type or None,
            expires_soon=tokens.is_expired,
        )

    def login(self, *, open_browser: bool = True) -> AuthenticationStatus:
        from ..cli.commands.config_cmd import write_user_llm_config
        from ..cli._constants import DEFAULT_OPENAI_OAUTH_MODEL
        from ..core.oauth import openai as oauth

        tokens = oauth.login(open_browser=open_browser)
        write_user_llm_config({"provider": "openai-oauth", "model": DEFAULT_OPENAI_OAUTH_MODEL})
        return AuthenticationStatus(
            signed_in=True,
            account_label=tokens.account_id or None,
            plan=tokens.plan_type or None,
            expires_soon=tokens.is_expired,
        )

    def logout(self) -> AuthenticationStatus:
        from ..core.oauth import openai as oauth

        oauth.clear_tokens()
        return AuthenticationStatus(signed_in=False)
