import { matchesTerritory, parseTerritories } from "@/lib/customer-permissions";
import { PROVINCE_CITY_MAP } from "@/lib/region-data";

export type LeadRoutingFailureReason =
  | "REGION_UNRESOLVED"
  | "NO_MATCHING_ASSIGNEE"
  | "MULTIPLE_MATCHING_ASSIGNEES"
  | "ROUTING_UNAVAILABLE";

export type LeadRoutingOutcome = "ASSIGNED" | LeadRoutingFailureReason;

export type LeadRoutingResult = {
  assignedUserId: string | null;
  reason: LeadRoutingFailureReason | null;
  province: string | null;
  city: string | null;
};

export type LeadRoutingCandidate = {
  id: string;
  role: string;
  isActive: boolean;
  territories: unknown;
};

export type LeadRegionValidation =
  | { status: "ABSENT" | "INVALID"; province: null; city: null }
  | { status: "VALID"; province: string; city: string | null };

export function validateLeadProfileRegion(profile: unknown): LeadRegionValidation {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { status: "ABSENT", province: null, city: null };
  }
  const record = profile as Record<string, unknown>;
  const hasProvince = Object.hasOwn(record, "province");
  const hasCity = Object.hasOwn(record, "city");
  if (!hasProvince && !hasCity) return { status: "ABSENT", province: null, city: null };
  if (typeof record.province !== "string" || record.province !== record.province.trim()) {
    return { status: "INVALID", province: null, city: null };
  }
  const province = record.province;
  if (!province || province.length > 64 || !(province in PROVINCE_CITY_MAP)) {
    return { status: "INVALID", province: null, city: null };
  }
  if (hasCity && (typeof record.city !== "string" || record.city !== record.city.trim())) {
    return { status: "INVALID", province: null, city: null };
  }
  const rawCity = typeof record.city === "string" ? record.city : "";
  if (rawCity.length > 64) return { status: "INVALID", province: null, city: null };
  const validCities = PROVINCE_CITY_MAP[province];
  if (validCities.length === 0 && rawCity) return { status: "INVALID", province: null, city: null };
  if (rawCity && !validCities.includes(rawCity)) return { status: "INVALID", province: null, city: null };
  const city = validCities.length > 0 ? rawCity || null : null;
  return { status: "VALID", province, city };
}

export function resolveLeadAssignee(
  profile: unknown,
  candidates: LeadRoutingCandidate[],
): LeadRoutingResult {
  const location = validateLeadProfileRegion(profile);
  if (location.status !== "VALID") {
    return { assignedUserId: null, reason: "REGION_UNRESOLVED", province: null, city: null };
  }
  const resolvedLocation = { province: location.province, city: location.city };
  const expectedRole = location.province === "国外" ? "FOREIGN_TRADE" : "SALES";
  const matches = candidates.filter((candidate) => (
    candidate.isActive
    && candidate.role === expectedRole
    && (expectedRole === "FOREIGN_TRADE"
      || matchesTerritory(parseTerritories(candidate.territories), location.province, location.city))
  ));
  if (matches.length === 0) {
    return { assignedUserId: null, reason: "NO_MATCHING_ASSIGNEE", ...resolvedLocation };
  }
  if (matches.length > 1) {
    return { assignedUserId: null, reason: "MULTIPLE_MATCHING_ASSIGNEES", ...resolvedLocation };
  }
  return { assignedUserId: matches[0].id, reason: null, ...resolvedLocation };
}

export function routingUnavailable(profile: unknown): LeadRoutingResult {
  const location = validateLeadProfileRegion(profile);
  return {
    assignedUserId: null,
    reason: "ROUTING_UNAVAILABLE",
    province: location.status === "VALID" ? location.province : null,
    city: location.status === "VALID" ? location.city : null,
  };
}

export function leadRoutingAuditAction(result: LeadRoutingResult) {
  return result.assignedUserId
    ? `AUTO_ASSIGN|old=-|new=${result.assignedUserId}`
    : `AUTO_ASSIGN_FAILED|old=-|new=-|reason=${result.reason}`;
}

export function leadRoutingOutcome(result: LeadRoutingResult): LeadRoutingOutcome {
  return result.assignedUserId ? "ASSIGNED" : result.reason!;
}
