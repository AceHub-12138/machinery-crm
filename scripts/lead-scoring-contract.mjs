import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { CRM_PROVINCE_CITY_MAP } from "./lead-contact-enrichment-contract.mjs";

const boundedText = (maximum) => z.string().trim().min(1).max(maximum);
const sourceUrl = z.string().max(2_048).refine((value) => {
  if (value !== value.trim()) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
});

const leadProfileSchema = z.object({
  industry: boundedText(191),
  intent: boundedText(191),
  scale: boundedText(191),
  contactability: boundedText(191),
  confidence: boundedText(32),
  reason: boundedText(1_000),
  province: boundedText(64).optional(),
  city: boundedText(64).optional(),
}).strict().superRefine((profile, context) => {
  if (!profile.province && profile.city) {
    context.addIssue({ code: "custom", path: ["city"], message: "city requires a standard province" });
    return;
  }
  if (!profile.province) return;
  const validCities = CRM_PROVINCE_CITY_MAP[profile.province];
  if (!Array.isArray(validCities)) {
    context.addIssue({ code: "custom", path: ["province"], message: "province must use the standard full name" });
    return;
  }
  if (profile.city && !validCities.includes(profile.city)) {
    context.addIssue({ code: "custom", path: ["city"], message: "city must belong to province" });
  }
});

export const leadScoreSchema = z.object({
  aiScore: z.number().int().min(0).max(100),
  profile: leadProfileSchema,
  contactName: boundedText(191).optional(),
  phone: z.string().trim().min(7).max(32).regex(/^\+?[0-9][0-9 ()-]*$/).optional(),
  email: z.string().trim().max(191).email().optional(),
}).strict();

const sourceLeadSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  requestId: z.string().trim().min(8).max(128).optional(),
  companyName: boundedText(191),
  contactName: boundedText(191).optional(),
  phone: z.string().trim().min(7).max(32).regex(/^\+?[0-9][0-9 ()-]*$/).optional(),
  email: z.string().trim().max(191).email().optional(),
  source: z.enum(["BAIDU_SEARCH", "MANUAL", "OTHER"]),
  sourceUrl: sourceUrl.optional(),
  searchKeyword: boundedText(191).optional(),
  sourceSystem: boundedText(191),
  externalLeadId: boundedText(191),
}).strict();

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stableJsonValue(nested)]));
}

function normalizedPayload(payload) {
  return Object.fromEntries(Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, stableJsonValue(value)]));
}

export function canonicalLeadPayloadHash(payload) {
  return createHash("sha256").update(JSON.stringify(normalizedPayload(payload))).digest("hex");
}

export function parseLeadScore(input) {
  let parsed;
  try {
    parsed = JSON.parse(String(input));
  } catch {
    throw new Error("Lead scoring output must be one strict JSON object without prose or Markdown fences");
  }
  const result = leadScoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Lead scoring JSON is invalid or does not match lead-score-v1");
  }
  return result.data;
}

export function deriveLeadIdempotencyKey({ sourceSystem, externalLeadId }) {
  const source = boundedText(191).parse(sourceSystem);
  const external = boundedText(191).parse(externalLeadId);
  const digest = createHash("sha256")
    .update(`lead-idempotency-v1|${source}|${external}`)
    .digest("hex");
  return `lead-v1-${digest}`;
}

export function buildLeadWriteItem({
  sourceLead: sourceLeadInput,
  score: scoreInput,
  sourceModelVersion: sourceModelVersionInput,
  extractorVersion: extractorVersionInput,
}) {
  const sourceLead = sourceLeadSchema.parse(sourceLeadInput);
  const score = leadScoreSchema.parse(scoreInput);
  if (sourceLead.requestId && sourceLead.idempotencyKey === sourceLead.requestId) {
    throw new Error("Request ID (X-Dachuan-Request-Id) must never be used as the Lead idempotency key");
  }
  const sourceModelVersion = boundedText(191).parse(sourceModelVersionInput);
  const extractorVersion = boundedText(191).parse(extractorVersionInput);
  const businessPayload = Object.fromEntries(Object.entries({
    companyName: sourceLead.companyName,
    contactName: score.contactName ?? sourceLead.contactName,
    phone: score.phone ?? sourceLead.phone,
    email: score.email ?? sourceLead.email,
    source: sourceLead.source,
    sourceUrl: sourceLead.sourceUrl,
    searchKeyword: sourceLead.searchKeyword,
    aiScore: score.aiScore,
    profile: score.profile,
    sourceModelVersion,
    extractorVersion,
    sourceSystem: sourceLead.sourceSystem,
    externalLeadId: sourceLead.externalLeadId,
  }).filter(([, value]) => value !== undefined));

  return {
    idempotencyKey: sourceLead.idempotencyKey,
    payloadHash: canonicalLeadPayloadHash(businessPayload),
    ...businessPayload,
  };
}
