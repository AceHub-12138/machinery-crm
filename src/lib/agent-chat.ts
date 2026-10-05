const ASSERTION_ENDPOINT = "/api/agent/assertion";
const DEFAULT_GATEWAY_URL = "https://mcp.dachuan.pro/api/agent-gateway/chat";
const TOKEN_REUSE_SECONDS = 550;

type CachedToken = {
  reusableUntil: number;
  value: string;
};

export type AgentChatMessage = {
  content: string;
  role: "assistant" | "user";
};

export class AgentChatError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly kind: "configuration" | "request" = "request",
  ) {
    super(message);
    this.name = "AgentChatError";
  }
}

let cachedToken: CachedToken | null = null;

function getGatewayUrl() {
  return process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL || DEFAULT_GATEWAY_URL;
}

function getAgentAppId() {
  const appId = process.env.NEXT_PUBLIC_AGENT_APP_ID;
  if (!appId) {
    throw new AgentChatError("Agent 应用尚未配置", undefined, "configuration");
  }
  return appId;
}

async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");
  if (!body) return fallback;

  try {
    const payload: unknown = JSON.parse(body);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
  } catch {
    // 网关可能返回非 JSON 错误页；此时使用统一错误提示。
  }

  return fallback;
}

async function requestAssertionToken() {
  const response = await fetch(ASSERTION_ENDPOINT, {
    credentials: "same-origin",
    method: "POST",
  });
  if (!response.ok) {
    throw new AgentChatError(
      await readErrorMessage(response, "无法获取 Agent 访问令牌"),
      response.status,
    );
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("token" in payload) ||
    !("expiresIn" in payload) ||
    typeof payload.token !== "string" ||
    typeof payload.expiresIn !== "number" ||
    !Number.isFinite(payload.expiresIn) ||
    payload.expiresIn <= 0
  ) {
    throw new AgentChatError("Agent 令牌响应格式无效");
  }

  cachedToken = {
    reusableUntil: Date.now() + Math.min(payload.expiresIn, TOKEN_REUSE_SECONDS) * 1000,
    value: payload.token,
  };
  return cachedToken.value;
}

async function getAssertionToken() {
  if (cachedToken && cachedToken.reusableUntil > Date.now()) {
    return cachedToken.value;
  }
  return requestAssertionToken();
}

function extractStreamContent(payload: unknown) {
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object" || payload === null) return "";
  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.choices)) {
    return record.choices
      .map((choice) => {
        if (typeof choice !== "object" || choice === null) return "";
        if ("delta" in choice && typeof choice.delta === "object" && choice.delta !== null && "content" in choice.delta && typeof choice.delta.content === "string") {
          return choice.delta.content;
        }
        if ("message" in choice && typeof choice.message === "object" && choice.message !== null && "content" in choice.message && typeof choice.message.content === "string") {
          return choice.message.content;
        }
        if ("text" in choice && typeof choice.text === "string") return choice.text;
        return "";
      })
      .join("");
  }

  for (const key of ["content", "text", "answer"] as const) {
    if (typeof record[key] === "string") return record[key];
  }
  return "";
}

function parseDataLine(line: string) {
  const data = line.slice("data:".length).trimStart();
  if (!data || data === "[DONE]") return "";

  try {
    return extractStreamContent(JSON.parse(data));
  } catch {
    return data;
  }
}

function consumeSseFrame(frame: string, onToken: (token: string) => void) {
  for (const line of frame.replace(/\r/g, "").split("\n")) {
    if (!line.startsWith("data:")) continue;
    const token = parseDataLine(line);
    if (token) onToken(token);
  }
}

async function streamResponse(response: Response, onToken: (token: string) => void) {
  if (!response.body) {
    throw new AgentChatError("Agent 未返回可读取的回复");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const body = await response.text();
    if (!body) return;
    try {
      const token = extractStreamContent(JSON.parse(body));
      if (token) onToken(token);
    } catch {
      onToken(body);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    pending = pending.replace(/\r\n/g, "\n");

    let frameBoundary = pending.indexOf("\n\n");
    while (frameBoundary !== -1) {
      consumeSseFrame(pending.slice(0, frameBoundary), onToken);
      pending = pending.slice(frameBoundary + 2);
      frameBoundary = pending.indexOf("\n\n");
    }

    if (done) break;
  }

  if (pending.trim()) {
    consumeSseFrame(pending, onToken);
  }
}

async function requestGateway(
  token: string,
  messages: AgentChatMessage[],
) {
  const response = await fetch(getGatewayUrl(), {
    body: JSON.stringify({
      appId: getAgentAppId(),
      messages,
      stream: true,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new AgentChatError(
      await readErrorMessage(response, "Agent 服务暂时无法响应"),
      response.status,
    );
  }
  return response;
}

export async function streamAgentChat(
  messages: AgentChatMessage[],
  onToken: (token: string) => void,
) {
  let token = await getAssertionToken();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestGateway(token, messages);
      await streamResponse(response, onToken);
      return;
    } catch (error) {
      if (!(error instanceof AgentChatError) || error.status !== 401 || attempt === 1) {
        throw error;
      }
      cachedToken = null;
      token = await getAssertionToken();
    }
  }
}
