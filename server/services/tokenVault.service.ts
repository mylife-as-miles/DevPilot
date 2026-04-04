import { DelegatedActionProvider } from "../../src/types";
import { RuntimeEnv, RuntimeSessionRecord } from "../runtime.types";

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const REFRESH_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:refresh_token";
const FEDERATED_ACCESS_TOKEN_TYPE =
  "http://auth0.com/oauth/token-type/federated-connection-access-token";

export interface ProviderAccessTokenResult {
  accessToken: string;
  expiresIn?: number;
  issuedTokenType?: string;
  logs: string[];
}

export async function exchangeProviderAccessToken(options: {
  env: RuntimeEnv;
  session: RuntimeSessionRecord;
  provider: DelegatedActionProvider;
  loginHint?: string;
}): Promise<ProviderAccessTokenResult> {
  const connection = options.env.providerConnections[options.provider];
  if (!connection) {
    throw new Error(`No Auth0 Token Vault connection is configured for ${options.provider}.`);
  }

  const refreshToken = options.session.auth0Tokens?.refreshToken;
  if (!refreshToken) {
    throw new Error(
      `No refresh-token-backed Auth0 session is available for ${options.provider} token exchange.`,
    );
  }

  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    client_id: options.env.auth0ClientId,
    client_secret: options.env.auth0ClientSecret,
    subject_token: refreshToken,
    subject_token_type: REFRESH_TOKEN_TYPE,
    requested_token_type: FEDERATED_ACCESS_TOKEN_TYPE,
    connection,
  });

  if (options.env.auth0Audience) {
    body.set("audience", options.env.auth0Audience);
  }

  if (options.loginHint) {
    body.set("login_hint", options.loginHint);
  }

  const response = await fetch(`${options.env.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Token Vault exchange failed for ${options.provider} (${response.status}): ${details}`,
    );
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    issued_token_type?: string;
  };

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
    issuedTokenType: payload.issued_token_type,
    logs: [
      `[TOKEN_VAULT] Exchanged Auth0 refresh token for ${options.provider} provider access.`,
    ],
  };
}
