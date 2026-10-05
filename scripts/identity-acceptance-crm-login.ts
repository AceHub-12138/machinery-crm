type AcceptanceLoginUser = {
  email: string;
  expectedUserId: string;
};

type LoginDiagnostic = {
  email: string;
  loginRequestUrl: string;
  httpStatus: number;
  contentType: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  setCookieReceived: boolean;
  sessionCheck: {
    url: string;
    status: number;
    contentType: string | null;
    authenticated: boolean;
    userId: string | null;
    expectedUserId: string;
    userIdMatches: boolean;
  };
};

type LoginResult = {
  cookieHeader: string;
  diagnostic: LoginDiagnostic;
};

type LoginPreflightResult = {
  diagnostics: LoginDiagnostic[];
  sessionsByUserId: Map<string, string>;
};

export class AcceptanceCrmLoginError extends Error {
  diagnostic: LoginDiagnostic;

  constructor(diagnostic: LoginDiagnostic) {
    super(`CRM login preflight failed for ${diagnostic.email}`);
    this.name = "AcceptanceCrmLoginError";
    this.diagnostic = diagnostic;
  }
}

function unwrap<T>(payload: unknown): T {
  return payload && typeof payload === "object" && "data" in payload
    ? (payload as { data: T }).data
    : payload as T;
}

function getSetCookie(headers: Headers) {
  return (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [headers.get("set-cookie") || ""].filter(Boolean);
}

function mergeResponseCookies(target: Map<string, string>, headers: Headers) {
  for (const value of getSetCookie(headers)) {
    const cookiePair = value.split(";", 1)[0];
    const separator = cookiePair.indexOf("=");
    if (separator <= 0) continue;
    target.set(cookiePair.slice(0, separator), cookiePair.slice(separator + 1));
  }
}

function serializeCookies(cookies: Map<string, string>) {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function safeText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  return normalized || null;
}

function authErrorFromResponse(payload: unknown, crmUrl: string) {
  const body = unwrap<Record<string, unknown>>(payload);
  const responseUrl = typeof body?.url === "string" ? body.url : undefined;
  if (responseUrl) {
    try {
      const url = new URL(responseUrl, crmUrl);
      return {
        errorCode: safeText(url.searchParams.get("code")),
        errorMessage: safeText(url.searchParams.get("error")),
      };
    } catch {
      // Fall through to the structured error fields below.
    }
  }
  return {
    errorCode: safeText(body?.code),
    errorMessage: safeText(body?.error) ?? safeText(body?.message),
  };
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export function acceptanceLoginUsers(environment: NodeJS.ProcessEnv): AcceptanceLoginUser[] {
  const required = (name: string) => {
    const value = String(environment[name] || "").trim();
    if (!value || value.startsWith("REPLACE_") || value.startsWith("GENERATE_")) {
      throw new Error(`${name} is not configured`);
    }
    return value;
  };

  return [
    { email: "accept-audit@dachuan.invalid", expectedUserId: "identity-acceptance-audit" },
    { email: required("ACCEPTANCE_SALES_A_EMAIL"), expectedUserId: "identity-acceptance-sales-a" },
    { email: required("ACCEPTANCE_SALES_B_EMAIL"), expectedUserId: "identity-acceptance-sales-b" },
    { email: required("ACCEPTANCE_PURCHASE_EMAIL"), expectedUserId: "identity-acceptance-purchase" },
    { email: required("ACCEPTANCE_WAREHOUSE_EMAIL"), expectedUserId: "identity-acceptance-warehouse" },
    { email: required("ACCEPTANCE_ADMIN_EMAIL"), expectedUserId: "identity-acceptance-admin" },
  ];
}

export async function crmLoginSession({
  crmUrl,
  email,
  password,
  expectedUserId,
}: AcceptanceLoginUser & { crmUrl: string; password: string }): Promise<LoginResult> {
  const baseUrl = crmUrl.replace(/\/$/, "");
  const cookies = new Map<string, string>();

  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfPayload = unwrap<{ csrfToken?: string }>(await responseJson(csrfResponse));
  mergeResponseCookies(cookies, csrfResponse.headers);
  if (!csrfResponse.ok || !csrfPayload.csrfToken) {
    throw new Error(`Unable to obtain CRM CSRF token for ${email}`);
  }

  const loginRequestUrl = `${baseUrl}/api/auth/callback/credentials`;
  const loginResponse = await fetch(loginRequestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
      cookie: serializeCookies(cookies),
    },
    body: new URLSearchParams({
      csrfToken: csrfPayload.csrfToken,
      email,
      password,
      callbackUrl: `${baseUrl}/`,
    }),
    redirect: "manual",
  });
  const loginPayload = await responseJson(loginResponse);
  const authError = authErrorFromResponse(loginPayload, baseUrl);
  const beforeLoginCookieCount = cookies.size;
  mergeResponseCookies(cookies, loginResponse.headers);
  const setCookieReceived = cookies.size > beforeLoginCookieCount;

  const sessionUrl = `${baseUrl}/api/auth/session`;
  const sessionResponse = await fetch(sessionUrl, {
    headers: { cookie: serializeCookies(cookies) },
  });
  const sessionPayload = unwrap<{ user?: { id?: string } }>(await responseJson(sessionResponse));
  const sessionUserId = sessionPayload?.user?.id ? String(sessionPayload.user.id) : null;
  const sessionCookieReceived = [...cookies.keys()].some((name) => name.endsWith("authjs.session-token"));
  const diagnostic: LoginDiagnostic = {
    email,
    loginRequestUrl,
    httpStatus: loginResponse.status,
    contentType: loginResponse.headers.get("content-type"),
    errorCode: authError.errorCode,
    errorMessage: authError.errorMessage,
    setCookieReceived,
    sessionCheck: {
      url: sessionUrl,
      status: sessionResponse.status,
      contentType: sessionResponse.headers.get("content-type"),
      authenticated: Boolean(sessionPayload?.user),
      userId: sessionUserId,
      expectedUserId,
      userIdMatches: sessionUserId === expectedUserId,
    },
  };

  const passed = loginResponse.ok
    && diagnostic.contentType?.includes("application/json")
    && !diagnostic.errorCode
    && !diagnostic.errorMessage
    && setCookieReceived
    && sessionCookieReceived
    && sessionResponse.ok
    && diagnostic.sessionCheck.userIdMatches;
  if (!passed) throw new AcceptanceCrmLoginError(diagnostic);

  return { cookieHeader: serializeCookies(cookies), diagnostic };
}

export async function runAcceptanceLoginPreflight({
  crmUrl,
  password,
  users,
}: {
  crmUrl: string;
  password: string;
  users: AcceptanceLoginUser[];
}): Promise<LoginPreflightResult> {
  const diagnostics: LoginDiagnostic[] = [];
  const sessionsByUserId = new Map<string, string>();

  for (const user of users) {
    try {
      const result = await crmLoginSession({ crmUrl, password, ...user });
      diagnostics.push(result.diagnostic);
      sessionsByUserId.set(user.expectedUserId, result.cookieHeader);
      console.log(`[PASS] CRM_LOGIN_PREFLIGHT ${JSON.stringify(result.diagnostic)}`);
    } catch (error) {
      if (error instanceof AcceptanceCrmLoginError) {
        console.error(`[FAIL] CRM_LOGIN_PREFLIGHT ${JSON.stringify(error.diagnostic)}`);
      }
      throw error;
    }
  }

  return { diagnostics, sessionsByUserId };
}
