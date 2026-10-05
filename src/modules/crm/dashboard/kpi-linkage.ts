function addLocalDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export function formatLocalDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localStartOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function dashboardRangeDates(start: Date, endExclusive: Date) {
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(addLocalDays(endExclusive, -1)),
  };
}

type DashboardKpiFilters = {
  province?: string;
  salesUserId?: string;
  customerStatus?: string;
  contractStatus?: string;
  shipmentStatus?: string;
};

function filterHref(path: string, entries: Array<[string, string | undefined]>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value) searchParams.set(key, value);
  }
  return `${path}?${searchParams.toString()}`;
}

export function dashboardKpiHrefs(
  range: { startDate: string; endDate: string },
  filters: DashboardKpiFilters = {},
) {
  const { startDate, endDate } = range;
  return {
    periodNewCustomers: filterHref("/customers", [
      ["createdStart", startDate],
      ["createdEnd", endDate],
      ["province", filters.province],
      ["kpiSalesUserId", filters.salesUserId],
      ["status", filters.customerStatus],
    ]),
    periodContractAmount: filterHref("/contracts", [
      ["createdStart", startDate],
      ["createdEnd", endDate],
      ["province", filters.province],
      ["kpiSalesUserId", filters.salesUserId],
      ["contractStatus", filters.contractStatus],
    ]),
    periodShipments: filterHref("/shipments", [
      ["dateStart", filters.shipmentStatus === "OVERDUE" ? undefined : startDate],
      ["dateEnd", filters.shipmentStatus === "OVERDUE" ? undefined : endDate],
      ["province", filters.province],
      ["kpiSalesUserId", filters.salesUserId],
      ["contractStatus", filters.contractStatus],
      ["status", filters.shipmentStatus],
    ]),
    overdueShipmentDue: filterHref("/contracts", [
      ["overdueShipment", "1"],
      ["province", filters.province],
      ["kpiSalesUserId", filters.salesUserId],
      ["contractStatus", filters.contractStatus],
    ]),
  };
}

export function overdueShipmentWhere(today: Date) {
  return {
    estimatedShipmentDate: { not: null, lt: today },
    shipments: { none: { shipmentStatus: "SHIPPED" } },
  } as const;
}

export function contractStatusWhere(value: string) {
  if (["DRAFT", "SIGNED", "COMPLETED", "ARCHIVED", "CANCELLED"].includes(value)) {
    return { contractStatus: value };
  }
  if (value === "PRODUCTION") {
    return {
      contractStatus: "SIGNED",
      shipments: {
        none: {
          shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] },
        },
      },
    } as const;
  }
  if (value === "SHIPPED") {
    return {
      shipments: {
        some: {
          shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] },
        },
      },
    } as const;
  }
  return {};
}

export function readInitialDateFilters(
  searchParams: Pick<URLSearchParams, "get">,
  startKey: string,
  endKey: string,
) {
  return {
    start: searchParams.get(startKey) || "",
    end: searchParams.get(endKey) || "",
  };
}

export function appendDateFilters(
  searchParams: URLSearchParams,
  filters: { start: string; end: string },
  startKey: string,
  endKey: string,
) {
  if (filters.start) searchParams.set(startKey, filters.start);
  if (filters.end) searchParams.set(endKey, filters.end);
  return searchParams;
}

export function readInitialSalesUserFilter(
  searchParams: Pick<URLSearchParams, "get">,
  normalKey = "salesUserId",
) {
  const normalSalesUserId = searchParams.get(normalKey) || "";
  const kpiSalesUserId = normalSalesUserId ? "" : searchParams.get("kpiSalesUserId") || "";
  return {
    salesUserId: normalSalesUserId || kpiSalesUserId,
    kpiSalesUserId,
  };
}

export function appendSalesUserFilter(
  searchParams: URLSearchParams,
  salesUserId: string,
  kpiSalesUserId: string,
  normalKey = "salesUserId",
) {
  if (!salesUserId) return searchParams;
  if (kpiSalesUserId && salesUserId === kpiSalesUserId) searchParams.set("kpiSalesUserId", salesUserId);
  else searchParams.set(normalKey, salesUserId);
  return searchParams;
}
