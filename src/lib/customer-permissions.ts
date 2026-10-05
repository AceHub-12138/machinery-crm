import { customerBusinessLineForRole } from "@/lib/erp-roles";

// 用户负责的省/市范围。cities 为空数组 = 整省；否则仅这些市。
export type Territory = { province: string; cities: string[] };

export type SessionUser = {
  id: string;
  role: "SUPER_ADMIN" | "SALES" | "FOREIGN_TRADE" | "PURCHASE" | "WAREHOUSE";
  region: string;
  territories: Territory[];
  viewScope: string;
  name?: string | null;
  email?: string | null;
};

export function parseTerritories(raw: unknown): Territory[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((territory) => territory && typeof territory.province === "string")
    .map((territory) => ({
      province: String(territory.province),
      cities: Array.isArray(territory.cities)
        ? territory.cities.filter((city: unknown): city is string => typeof city === "string")
        : [],
    }));
}

export function canSeeAllData(user: SessionUser): boolean {
  return user.role === "SUPER_ADMIN";
}

export function matchesTerritory(
  territories: Territory[],
  province?: string | null,
  city?: string | null,
): boolean {
  if (!province) return false;
  for (const territory of territories) {
    if (territory.province !== province) continue;
    if (territory.cities.length === 0) return true;
    if (city && territory.cities.includes(city)) return true;
  }
  return false;
}

export function customerIsolationWhere(user: SessionUser): any {
  if (canSeeAllData(user)) return {};
  const where: any = { businessLine: customerBusinessLineForRole(user.role) };
  if (user.territories.length === 0) {
    where.id = "__NO_ACCESS__";
    return where;
  }
  where.OR = user.territories.map((territory) =>
    territory.cities.length === 0
      ? { province: territory.province }
      : { province: territory.province, city: { in: territory.cities } },
  );
  return where;
}

export function buildCustomerWhereClause(user: SessionUser) {
  return { deletedAt: null, ...customerIsolationWhere(user) };
}

export function canAccessCustomer(
  user: SessionUser,
  customer:
    | { businessLine?: string | null; province?: string | null; city?: string | null }
    | null
    | undefined,
): boolean {
  if (!customer) return false;
  if (canSeeAllData(user)) return true;
  const expectedBusinessLine = customerBusinessLineForRole(user.role);
  if ((customer.businessLine || "国内销售") !== expectedBusinessLine) return false;
  return matchesTerritory(user.territories, customer.province, customer.city);
}
