import crypto from "node:crypto";
import express, { Request, Response } from "express";
import { RuntimeEnv, RuntimeSessionRecord } from "../runtime.types";
import { setLoginState, setSession, takeLoginState } from "../runtime.store";

export function createAuthRouter(options: {
  env: RuntimeEnv;
  getSession: (
    request: Request,
    response: Response,
    extra?: { allowFallback?: boolean },
  ) => RuntimeSessionRecord;
  setSessionCookie: (response: Response, sessionId: string) => void;
  clearSessionCookie: (response: Response) => void;
  deleteSession: (sessionId: string) => void;
  createLiveAnonymousSession: (existingId?: string) => RuntimeSessionRecord;
}): express.Router {
  const router = express.Router();

  router.get("/api/secure-runtime/auth/login", async (request, response) => {
    const returnTo = sanitizeReturnTo(
      request.query.returnTo?.toString(),
      "/settings",
    );

    if (!options.env.liveAuthMode || !isAuth0Configured(options.env)) {
      const fallbackSession = options.getSession(request, response);
      response.redirect(
        `${options.env.frontendAppUrl}${returnTo}?auth_mode=${fallbackSession.runtimeMode}`,
      );
      return;
    }

    const session = options.getSession(request, response, {
      allowFallback: false,
    });
    const state = crypto.randomUUID();
    setLoginState(state, {
      sessionId: session.id,
      returnTo,
    });

    const authorizeUrl = new URL(`${options.env.auth0Domain}/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", options.env.auth0ClientId);
    authorizeUrl.searchParams.set("redirect_uri", getAuth0CallbackUrl(options.env));
    authorizeUrl.searchParams.set("scope", "openid profile email offline_access");
    authorizeUrl.searchParams.set("state", state);
    if (options.env.auth0Audience) {
      authorizeUrl.searchParams.set("audience", options.env.auth0Audience);
    }

    response.redirect(authorizeUrl.toString());
  });

  router.get("/api/secure-runtime/auth/callback", async (request, response) => {
    const code = request.query.code?.toString();
    const state = request.query.state?.toString();

    if (!code || !state) {
      response.redirect(`${options.env.frontendAppUrl}/settings?auth_error=invalid_callback`);
      return;
    }

    const loginState = takeLoginState(state);
    if (!loginState) {
      response.redirect(`${options.env.frontendAppUrl}/settings?auth_error=invalid_callback`);
      return;
    }

    try {
      const tokenResponse = await exchangeCodeForTokens(options.env, code);
      const user = await fetchUserProfile(options.env, tokenResponse.access_token);
      const session =
        options.createLiveAnonymousSession(loginState.sessionId);

      session.status = "authenticated";
      session.runtimeMode = "live";
      session.user = user;
      session.updatedAt = Date.now();
      session.auth0Tokens = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        idToken: tokenResponse.id_token,
        expiresAt: tokenResponse.expires_in
          ? Date.now() + tokenResponse.expires_in * 1000
          : undefined,
      };

      setSession(session);
      options.setSessionCookie(response, session.id);
      response.redirect(`${options.env.frontendAppUrl}${loginState.returnTo}?auth=success`);
    } catch (error) {
      console.error("[secure-runtime] Auth0 callback failed:", error);
      response.redirect(`${options.env.frontendAppUrl}${loginState.returnTo}?auth_error=login_failed`);
    }
  });

  router.get("/api/secure-runtime/auth/logout", (request, response) => {
    const returnTo = sanitizeReturnTo(
      request.query.returnTo?.toString(),
      "/settings",
    );
    const sessionId = getSessionIdFromRequest(request);

    if (sessionId) {
      options.deleteSession(sessionId);
    }

    options.clearSessionCookie(response);

    if (options.env.liveAuthMode && isAuth0Configured(options.env)) {
      const logoutUrl = new URL(`${options.env.auth0Domain}/v2/logout`);
      logoutUrl.searchParams.set("client_id", options.env.auth0ClientId);
      logoutUrl.searchParams.set(
        "returnTo",
        `${options.env.frontendAppUrl}${returnTo}`,
      );
      response.redirect(logoutUrl.toString());
      return;
    }

    response.redirect(`${options.env.frontendAppUrl}${returnTo}?auth=logged_out`);
  });

  return router;
}

function sanitizeReturnTo(value: string | undefined, fallback: string): string {
  if (!value || !value.startsWith("/")) {
    return fallback;
  }

  return value;
}

function isAuth0Configured(env: RuntimeEnv): boolean {
  return Boolean(env.auth0Domain && env.auth0ClientId && env.auth0ClientSecret);
}

function getAuth0CallbackUrl(env: RuntimeEnv): string {
  return `${env.secureActionBaseUrl}/api/secure-runtime/auth/callback`;
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((cookies, segment) => {
    const [rawKey, ...rawValue] = segment.trim().split("=");
    if (!rawKey) {
      return cookies;
    }

    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function getSessionIdFromRequest(request: Request): string | undefined {
  return parseCookieHeader(request.headers.cookie)["devpilot_secure_sid"];
}

async function exchangeCodeForTokens(
  env: RuntimeEnv,
  code: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.auth0ClientId,
    client_secret: env.auth0ClientSecret,
    code,
    redirect_uri: getAuth0CallbackUrl(env),
  });

  if (env.auth0Audience) {
    body.set("audience", env.auth0Audience);
  }

  const response = await fetch(`${env.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${details}`);
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
}

async function fetchUserProfile(
  env: RuntimeEnv,
  accessToken: string,
): Promise<{
  sub: string;
  name: string;
  email?: string;
  pictureUrl?: string;
}> {
  const response = await fetch(`${env.auth0Domain}/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Userinfo request failed (${response.status}): ${details}`);
  }

  const profile = (await response.json()) as {
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
    nickname?: string;
  };

  return {
    sub: profile.sub,
    name: profile.name ?? profile.nickname ?? "Authenticated User",
    email: profile.email,
    pictureUrl: profile.picture,
  };
}
