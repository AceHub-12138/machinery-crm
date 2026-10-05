import { createHash } from "node:crypto";
import { closeSync, openSync, renameSync, writeSync, fsyncSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { globalAgent as httpGlobalAgent } from "node:http";
import { globalAgent as httpsGlobalAgent } from "node:https";

type CloseableStateStore = {
  close?: () => Promise<void>;
};

type DisconnectablePrisma = {
  $disconnect: () => Promise<void>;
};

type InternalProcess = NodeJS.Process & {
  _getActiveHandles?: () => unknown[];
  _getActiveRequests?: () => unknown[];
};

type FetchDispatcher = {
  close?: () => Promise<void>;
  destroy?: () => void;
};

export type AcceptanceEvidence = {
  overallStatus: "PASS" | "FAIL";
  checks: string[];
  imageIds: Record<string, string>;
  startedAt: string;
  completedAt: string;
  requestIdSummary: {
    count: number;
    uniqueCount: number;
    sha256: string;
  };
  sensitiveScanStatus: "PASS" | "FAIL" | "NOT_RUN";
  failure?: string;
};

export type AcceptanceResourceTracker = {
  abortControllers: Set<AbortController>;
  responses: Set<Response>;
  readers: Set<ReadableStreamDefaultReader<Uint8Array>>;
};

function resourceType(value: unknown) {
  if (!value || typeof value !== "object") return typeof value;
  return (value as { constructor?: { name?: string } }).constructor?.name || "Object";
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

export function activeResourceTypes() {
  const internalProcess = process as InternalProcess;
  return {
    resources: uniqueSorted(process.getActiveResourcesInfo()),
    handles: uniqueSorted((internalProcess._getActiveHandles?.() || []).map(resourceType)),
    requests: uniqueSorted((internalProcess._getActiveRequests?.() || []).map(resourceType)),
  };
}

export function logActiveResourceTypes(stage: string) {
  console.log(`IDENTITY_ACCEPTANCE_RESOURCES stage=${stage} types=${JSON.stringify(activeResourceTypes())}`);
}

export function createAcceptanceResourceTracker(): AcceptanceResourceTracker {
  return {
    abortControllers: new Set(),
    responses: new Set(),
    readers: new Set(),
  };
}

export async function trackedFetch(
  tracker: AcceptanceResourceTracker,
  input: string | URL | Request,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  tracker.abortControllers.add(controller);
  const response = await fetch(input, { ...init, signal: controller.signal });
  tracker.responses.add(response);
  return response;
}

export async function readTrackedResponseText(
  tracker: AcceptanceResourceTracker,
  response: Response,
) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  tracker.readers.add(reader);
  const decoder = new TextDecoder();
  let text = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        text += decoder.decode();
        return text;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    tracker.readers.delete(reader);
    tracker.responses.delete(response);
  }
}

export function requestIdSummary(requestIds: string[]) {
  const normalized = requestIds.filter(Boolean).sort();
  return {
    count: normalized.length,
    uniqueCount: new Set(normalized).size,
    sha256: createHash("sha256").update(normalized.join("\n")).digest("hex"),
  };
}

function evidencePath() {
  const configured = String(process.env.ACCEPTANCE_EVIDENCE_FILE || "/evidence/result.json").trim();
  const target = resolve(configured);
  const root = resolve(String(process.env.ACCEPTANCE_EVIDENCE_DIR || "/evidence"));
  if (target !== root && !target.startsWith(`${root}/`) && !target.startsWith(`${root}\\`)) {
    throw new Error("Acceptance evidence file must remain inside the isolated evidence directory");
  }
  return target;
}

export function writeAcceptanceEvidenceAtomic(evidence: AcceptanceEvidence) {
  const target = evidencePath();
  const temporary = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  const descriptor = openSync(temporary, "w", 0o600);
  try {
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    writeSync(descriptor, serialized, undefined, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, target);
  return target;
}

async function closeGlobalFetchDispatcher() {
  const dispatcher = (globalThis as Record<symbol, unknown>)[
    Symbol.for("undici.globalDispatcher.1")
  ] as FetchDispatcher | undefined;
  if (!dispatcher) return;
  try {
    await dispatcher.close?.();
  } catch {
    dispatcher.destroy?.();
  }
}

export async function cleanupAcceptanceResources(options: {
  prisma: DisconnectablePrisma;
  stateStore: CloseableStateStore;
  tracker: AcceptanceResourceTracker;
}) {
  logActiveResourceTypes("before-cleanup");

  for (const reader of options.tracker.readers) {
    await reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* reader may already be released */ }
  }
  options.tracker.readers.clear();

  for (const response of options.tracker.responses) {
    if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
  }
  options.tracker.responses.clear();

  for (const controller of options.tracker.abortControllers) controller.abort();
  options.tracker.abortControllers.clear();

  await options.prisma.$disconnect();
  await options.stateStore.close?.();
  httpGlobalAgent.destroy();
  httpsGlobalAgent.destroy();
  await closeGlobalFetchDispatcher();

  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  logActiveResourceTypes("after-cleanup");
}

export function armNaturalExitWatchdog(timeoutMs = 30_000) {
  const startedAt = Date.now();
  const watchdog = setTimeout(() => {
    logActiveResourceTypes("natural-exit-timeout");
    process.exitCode = 1;
    throw new Error(`Identity acceptance runner did not exit naturally within ${timeoutMs}ms after cleanup`);
  }, timeoutMs);
  watchdog.unref();
  return startedAt;
}

export function safeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown acceptance failure";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]")
    .slice(0, 500);
}
