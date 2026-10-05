import { describe, expect, it } from "vitest";

import { appendDateFilters, appendSalesUserFilter, contractStatusWhere, dashboardKpiHrefs, dashboardRangeDates, formatLocalDate, localStartOfDay, overdueShipmentWhere, parseLocalDate, readInitialDateFilters, readInitialSalesUserFilter } from "./kpi-linkage";

describe("dashboard KPI linkage", () => {
  it("formats the inclusive local date range from an exclusive Dashboard end", () => {
    const start = new Date(2026, 7, 1, 0, 30);
    const endExclusive = new Date(2026, 7, 21, 0, 0);

    expect(formatLocalDate(start)).toBe("2026-08-01");
    expect(dashboardRangeDates(start, endExclusive)).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    });
  });

  it("builds the four KPI hrefs from the Dashboard response range", () => {
    expect(dashboardKpiHrefs({ startDate: "2026-08-01", endDate: "2026-08-20" })).toEqual({
      periodNewCustomers: "/customers?createdStart=2026-08-01&createdEnd=2026-08-20",
      periodContractAmount: "/contracts?createdStart=2026-08-01&createdEnd=2026-08-20",
      periodShipments: "/shipments?dateStart=2026-08-01&dateEnd=2026-08-20",
      overdueShipmentDue: "/contracts?overdueShipment=1",
    });
  });

  it("maps each Dashboard business filter only to the KPI where it actually affects", () => {
    const hrefs = dashboardKpiHrefs(
      { startDate: "2026-08-01", endDate: "2026-08-20" },
      {
        province: "山东省",
        salesUserId: "sales-1",
        customerStatus: "NEW_LEAD",
        contractStatus: "PRODUCTION",
        shipmentStatus: "SHIPPED",
      },
    );
    const params = (href: string) => Object.fromEntries(new URL(href, "http://localhost").searchParams);

    expect(params(hrefs.periodNewCustomers)).toEqual({
      createdStart: "2026-08-01",
      createdEnd: "2026-08-20",
      province: "山东省",
      kpiSalesUserId: "sales-1",
      status: "NEW_LEAD",
    });
    expect(params(hrefs.periodContractAmount)).toEqual({
      createdStart: "2026-08-01",
      createdEnd: "2026-08-20",
      province: "山东省",
      kpiSalesUserId: "sales-1",
      contractStatus: "PRODUCTION",
    });
    expect(params(hrefs.periodShipments)).toEqual({
      dateStart: "2026-08-01",
      dateEnd: "2026-08-20",
      province: "山东省",
      kpiSalesUserId: "sales-1",
      contractStatus: "PRODUCTION",
      status: "SHIPPED",
    });
    expect(params(hrefs.overdueShipmentDue)).toEqual({
      overdueShipment: "1",
      province: "山东省",
      kpiSalesUserId: "sales-1",
      contractStatus: "PRODUCTION",
    });
  });

  it("omits period dates when the Dashboard OVERDUE shipment filter replaces the period", () => {
    const href = dashboardKpiHrefs(
      { startDate: "2026-08-01", endDate: "2026-08-20" },
      {
        province: "山东省",
        salesUserId: "sales-1",
        contractStatus: "SIGNED",
        shipmentStatus: "OVERDUE",
      },
    ).periodShipments;

    expect(Object.fromEntries(new URL(href, "http://localhost").searchParams)).toEqual({
      province: "山东省",
      kpiSalesUserId: "sales-1",
      contractStatus: "SIGNED",
      status: "OVERDUE",
    });
  });

  it("does not leak customer or shipment status into unrelated KPI hrefs", () => {
    const hrefs = dashboardKpiHrefs(
      { startDate: "2026-08-01", endDate: "2026-08-20" },
      { customerStatus: "NEW_LEAD", shipmentStatus: "SHIPPED" },
    );
    const params = (href: string) => new URL(href, "http://localhost").searchParams;
    const keys = (href: string) => [...new URL(href, "http://localhost").searchParams.keys()];

    expect(params(hrefs.periodNewCustomers).get("status")).toBe("NEW_LEAD");
    expect(keys(hrefs.periodContractAmount)).not.toContain("status");
    expect(keys(hrefs.periodContractAmount)).not.toContain("customerStatus");
    expect(keys(hrefs.periodShipments)).not.toContain("customerStatus");
    expect(keys(hrefs.overdueShipmentDue)).not.toContain("status");
    expect(keys(hrefs.overdueShipmentDue)).not.toContain("customerStatus");
    expect(keys(hrefs.overdueShipmentDue)).not.toContain("shipmentStatus");
  });

  it("defines one overdue shipment condition for Dashboard and Contracts", () => {
    const today = new Date(2026, 7, 20, 0, 0);

    expect(overdueShipmentWhere(today)).toEqual({
      estimatedShipmentDate: { not: null, lt: today },
      shipments: { none: { shipmentStatus: "SHIPPED" } },
    });
  });

  it("defines the shared PRODUCTION contract relation predicate", () => {
    expect(contractStatusWhere("PRODUCTION")).toEqual({
      contractStatus: "SIGNED",
      shipments: {
        none: {
          shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] },
        },
      },
    });
  });

  it("defines the shared SHIPPED contract relation predicate", () => {
    expect(contractStatusWhere("SHIPPED")).toEqual({
      shipments: {
        some: {
          shipmentStatus: { in: ["PARTIAL_SHIPPED", "SHIPPED"] },
        },
      },
    });
  });

  it.each(["DRAFT", "SIGNED", "COMPLETED", "ARCHIVED", "CANCELLED"])(
    "defines the shared stored contract status predicate for %s",
    (status) => {
      expect(contractStatusWhere(status)).toEqual({ contractStatus: status });
    },
  );

  it("calculates today from local midnight", () => {
    expect(localStartOfDay(new Date(2026, 7, 20, 18, 45))).toEqual(new Date(2026, 7, 20, 0, 0));
  });

  it("reads date filters from URL parameters without deriving a new period", () => {
    const params = new URLSearchParams("createdStart=2026-08-01&createdEnd=2026-08-20");

    expect(readInitialDateFilters(params, "createdStart", "createdEnd")).toEqual({
      start: "2026-08-01",
      end: "2026-08-20",
    });
    expect(readInitialDateFilters(new URLSearchParams(), "dateStart", "dateEnd")).toEqual({
      start: "",
      end: "",
    });
  });

  it("parses YYYY-MM-DD as a local calendar date", () => {
    expect(parseLocalDate("2026-08-01")).toEqual(new Date(2026, 7, 1));
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026/08/01")).toBeNull();
  });

  it("feeds URL-initialized dates into the first list query and leaves no-parameter queries empty", () => {
    const initial = readInitialDateFilters(
      new URLSearchParams("dateStart=2026-08-01&dateEnd=2026-08-20"),
      "dateStart",
      "dateEnd",
    );
    const linkedQuery = appendDateFilters(new URLSearchParams(), initial, "dateStart", "dateEnd");
    const defaultQuery = appendDateFilters(new URLSearchParams(), { start: "", end: "" }, "dateStart", "dateEnd");

    expect(linkedQuery.toString()).toBe("dateStart=2026-08-01&dateEnd=2026-08-20");
    expect(defaultQuery.toString()).toBe("");
  });

  it("keeps KPI sales scope visible and removes hidden scope when the visible filter is cleared or changed", () => {
    expect(readInitialSalesUserFilter(new URLSearchParams("kpiSalesUserId=sales-1"))).toEqual({
      salesUserId: "sales-1",
      kpiSalesUserId: "sales-1",
    });

    const linked = appendSalesUserFilter(new URLSearchParams(), "sales-1", "sales-1");
    const cleared = appendSalesUserFilter(new URLSearchParams(), "", "sales-1");
    const changed = appendSalesUserFilter(new URLSearchParams(), "sales-2", "");

    expect(linked.toString()).toBe("kpiSalesUserId=sales-1");
    expect(cleared.toString()).toBe("");
    expect(changed.toString()).toBe("salesUserId=sales-2");

    expect(readInitialSalesUserFilter(
      new URLSearchParams("assignedUserId=sales-2&kpiSalesUserId=sales-1"),
      "assignedUserId",
    )).toEqual({
      salesUserId: "sales-2",
      kpiSalesUserId: "",
    });
    expect(appendSalesUserFilter(
      new URLSearchParams(),
      "sales-2",
      "",
      "assignedUserId",
    ).toString()).toBe("assignedUserId=sales-2");
  });
});
