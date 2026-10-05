export type LeadWriteResult = {
  id: string;
  dedupStatus: "UNIQUE" | "PENDING_REVIEW" | "CONFIRMED_DUPLICATE" | "CONFIRMED_UNIQUE";
  duplicateOfLeadId: string | null;
  replay: boolean;
  writeDisposition?: "CREATED" | "MERGED" | "REPLAY";
  routingOutcome?: "ASSIGNED" | "REGION_UNRESOLVED" | "NO_MATCHING_ASSIGNEE" | "MULTIPLE_MATCHING_ASSIGNEES" | "ROUTING_UNAVAILABLE" | null;
};

export function buildLeadE2eCompletionBody(lead: Record<string, unknown>) {
  return {
    stream: false,
    detail: true,
    messages: [{ role: "user", content: JSON.stringify(lead) }],
  };
}

function parseJsonString(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try { return JSON.parse(trimmed) as unknown; } catch { return null; }
}

export function findLeadWriteResult(value: unknown, seen = new Set<object>()): LeadWriteResult | null {
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    return parsed === null ? null : findLeadWriteResult(parsed, seen);
  }
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, "result")) {
    const result = record.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    const resultRecord = result as Record<string, unknown>;
    const structured = resultRecord.structuredContent;
    if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
    const structuredRecord = structured as Record<string, unknown>;
    if (resultRecord.isError === true || structuredRecord.ok !== true) return null;
    return findLeadWriteResult(structuredRecord.data, seen);
  }
  if (Object.hasOwn(record, "structuredContent")) {
    const structured = record.structuredContent;
    if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
    const structuredRecord = structured as Record<string, unknown>;
    if (record.isError === true || structuredRecord.ok !== true) return null;
    return findLeadWriteResult(structuredRecord.data, seen);
  }
  if (
    typeof record.id === "string"
    && ["UNIQUE", "PENDING_REVIEW", "CONFIRMED_DUPLICATE", "CONFIRMED_UNIQUE"].includes(String(record.dedupStatus))
    && (record.duplicateOfLeadId === null || typeof record.duplicateOfLeadId === "string")
    && typeof record.replay === "boolean"
  ) {
    return record as LeadWriteResult;
  }
  for (const nested of Object.values(record)) {
    const found = findLeadWriteResult(nested, seen);
    if (found) return found;
  }
  return null;
}

export function safeLeadE2eFailure(error: unknown) {
  return String(error instanceof Error ? error.message : "Unknown Lead E2E failure")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/fastgpt-[A-Za-z0-9_-]{16,}/g, "[REDACTED_FASTGPT_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]")
    .slice(0, 400);
}

export function safeLeadE2eResponseSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `type=${value === null ? "null" : typeof value}`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().slice(0, 12).join(",") || "none";
  const rawError = typeof record.error === "string"
    ? record.error
    : record.error === undefined
      ? ""
      : JSON.stringify(record.error);
  const error = rawError ? ` error=${safeLeadE2eFailure(new Error(rawError))}` : "";
  return `keys=${keys}${error}`.slice(0, 400);
}
