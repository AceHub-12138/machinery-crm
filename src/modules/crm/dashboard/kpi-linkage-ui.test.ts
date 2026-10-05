import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const occurrences = (value: string, needle: string) => value.split(needle).length - 1;

describe("Dashboard KPI list linkage UI", () => {
  it("uses the Dashboard response range and applied filters for all four KPI links", () => {
    const dashboard = source("src/app/(app)/dashboard/page.tsx");

    expect(dashboard).toContain("dashboardKpiHrefs(data.range, data.filters)");
    for (const key of ["periodNewCustomers", "periodContractAmount", "periodShipments", "overdueShipmentDue"]) {
      expect(dashboard).toContain(`href: kpiHrefs.${key}`);
    }
  });

  it("initializes Customer dates once and forwards both API filters", () => {
    const customers = source("src/app/(app)/customers/page.tsx");

    expect(customers).toContain('readInitialDateFilters(searchParams, "createdStart", "createdEnd")');
    expect(customers).toContain("useState(initialCreatedDates.start)");
    expect(customers).toContain("useState(initialCreatedDates.end)");
    expect(customers).toContain('useState(searchParams.get("province") || "")');
    expect(customers).toContain('useState(searchParams.get("status") || "")');
    expect(customers).toContain('readInitialSalesUserFilter(searchParams, "assignedUserId")');
    expect(customers).toContain("useState(initialSalesFilter.salesUserId)");
    expect(customers).toContain("useState(initialSalesFilter.kpiSalesUserId)");
    expect(customers).toContain('appendSalesUserFilter(params, assignedUserId, kpiSalesUserId, "assignedUserId")');
    expect(customers).toContain('setAssignedUserId(event.target.value); setKpiSalesUserId("")');
    expect(customers).toContain('appendDateFilters(params, { start: createdStart, end: createdEnd }, "createdStart", "createdEnd")');
    expect(customers).not.toContain("setCreatedStart(searchParams.get");
    expect(customers).not.toContain("setCreatedEnd(searchParams.get");
    expect(occurrences(customers, 'fetch(`/api/customers?${params.toString()}`)')).toBe(1);
    expect(customers).toContain("创建开始日期");
    expect(customers).toContain("创建结束日期");
  });

  it("initializes Contract dates and overdue state before the first query", () => {
    const contracts = source("src/app/(app)/contracts/page.tsx");

    expect(contracts).toContain('readInitialDateFilters(searchParams, "createdStart", "createdEnd")');
    expect(contracts).toContain("readInitialSalesUserFilter(searchParams)");
    expect(contracts).toContain('useState(searchParams.get("province") || "")');
    expect(contracts).toContain('useState(searchParams.get("contractStatus") || "")');
    expect(contracts).toContain("useState(initialSalesFilter.salesUserId)");
    expect(contracts).toContain("useState(initialSalesFilter.kpiSalesUserId)");
    expect(contracts).toContain("appendSalesUserFilter(params, salesUserId, kpiSalesUserId)");
    expect(contracts).toContain('setKpiSalesUserId("")');
    expect(contracts).toContain('setSalesUserId(event.target.value); setKpiSalesUserId("")');
    expect(contracts).toContain('useState(searchParams.get("overdueShipment") === "1")');
    expect(contracts).toContain('appendDateFilters(params, { start: createdStart, end: createdEnd }, "createdStart", "createdEnd")');
    expect(contracts).toContain('params.set("overdueShipment", "1")');
    expect(contracts).not.toContain("setCreatedStart(searchParams.get");
    expect(contracts).not.toContain("setCreatedEnd(searchParams.get");
    expect(occurrences(contracts, 'fetch(`/api/contracts?${query}`)')).toBe(1);
    expect(contracts).toContain("逾期未发货");
  });

  it("initializes existing Shipment date filters without a second period calculation", () => {
    const shipments = source("src/app/(app)/shipments/page.tsx");

    expect(shipments).toContain('readInitialDateFilters(searchParams, "dateStart", "dateEnd")');
    expect(shipments).toContain("readInitialSalesUserFilter(searchParams)");
    expect(shipments).toContain('useState(searchParams.get("province") || "")');
    expect(shipments).toContain('useState(searchParams.get("status") || "")');
    expect(shipments).toContain('useState(searchParams.get("contractStatus") || "")');
    expect(shipments).toContain("useState(initialSalesFilter.salesUserId)");
    expect(shipments).toContain("useState(initialSalesFilter.kpiSalesUserId)");
    expect(shipments).toContain("appendSalesUserFilter(params, salesUserId, kpiSalesUserId)");
    expect(shipments).toContain('setKpiSalesUserId("")');
    expect(shipments).toContain('setSalesUserId(event.target.value); setKpiSalesUserId("")');
    expect(shipments).toContain('<option value="OVERDUE">逾期未发货</option>');
    expect(shipments).toContain("useState(initialShipmentDates.start)");
    expect(shipments).toContain("useState(initialShipmentDates.end)");
    expect(shipments).toContain('appendDateFilters(params, { start: dateStart, end: dateEnd }, "dateStart", "dateEnd")');
    expect(shipments).not.toContain("setDateStart(searchParams.get");
    expect(shipments).not.toContain("setDateEnd(searchParams.get");
    expect(occurrences(shipments, 'fetch(`/api/shipments?${query}`')).toBe(1);
  });
});
