import { z } from "zod/v4";

export function nullishDrop(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  if (!normalized || /^(?:null|undefined)$/i.test(normalized)) return undefined;
  return value;
}

function normalizeOptionalTextFilter(value: unknown, dropNumeric: boolean) {
  const dropped = nullishDrop(value);
  if (dropped === undefined || typeof dropped !== "string") return dropped;
  const normalized = dropped.trim();
  if (dropNumeric && /^\d+$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeOptionalDateFilter(value: unknown) {
  const dropped = nullishDrop(value);
  if (dropped === undefined || typeof dropped !== "string") return dropped;
  const normalized = dropped.trim().replace(/\//g, "-");
  const dateMatch = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|(?:T|\s+)(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)$/,
  );
  if (!dateMatch) return normalized;
  return `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
}

export function optionalDateFilter(description: string) {
  return z.preprocess(
    normalizeOptionalDateFilter,
    z.string().date().optional(),
  ).describe(description);
}

export function requiredUuidReferenceFilter(description: string) {
  return z.string().trim().uuid().describe(description);
}

export function optionalUuidReferenceFilter(description: string) {
  return z.preprocess(
    nullishDrop,
    z.string().trim().uuid().optional(),
  ).describe(description);
}

export function optionalLocationFilter(description: string) {
  return z.preprocess(
    (value) => normalizeOptionalTextFilter(value, true),
    z.string().max(40).optional(),
  ).describe(description);
}

export function optionalSearchFilter(description: string) {
  return z.preprocess(
    (value) => normalizeOptionalTextFilter(value, false),
    z.string().max(100).optional(),
  ).describe(description);
}

export function optionalStockReferenceTypeFilter(description: string) {
  return z.preprocess(
    nullishDrop,
    z.string()
      .trim()
      .pipe(z.enum(["StockIn", "StockOut", "StockCheck", "StockTransfer"]))
      .optional(),
  ).describe(description);
}
