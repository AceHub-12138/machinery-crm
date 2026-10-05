import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const buildWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/build-standalone.yml"), "utf8");
const validationWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/validate-phase4-artifact.yml"), "utf8");
const middleware = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
const loginPage = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
const reminderCronRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/delivery-reminders/run/route.ts"), "utf8");
const kitCronRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/kit-rechecks/process/route.ts"), "utf8");
const rollback = readFileSync(resolve(process.cwd(), "prisma/migrations/20260715100000_erp_phase4_procurement_delivery/rollback.sql"), "utf8");

describe("phase 4 release audit guards", () => {
  it("compares migration manifests without a fixed migration count", () => {
    expect(buildWorkflow).toContain("source-migrations.sha256");
    expect(buildWorkflow).toContain("extracted-migrations.sha256");
    expect(buildWorkflow).not.toMatch(/MIGRATION_COUNT[^\n]*(?:-ne|-eq)\s+\d+/);
    expect(validationWorkflow).not.toMatch(/migration_dirs\[@\][^\n]*(?:-ne|-eq)\s+\d+/);
  });

  it("keeps environment files and the external upload root outside the package", () => {
    expect(buildWorkflow).toContain('test ! -e "$VERIFY_APP/.env"');
    expect(buildWorkflow).toContain('test ! -d "$VERIFY_APP/src/app/uploads"');
    expect(buildWorkflow).toContain('UPLOAD_DIR="$PERSISTENT_UPLOADS"');
  });

  it("lets only the exact cron endpoints reach their own secret checks", () => {
    expect(middleware).toContain('"/api/erp/delivery-reminders/run"');
    expect(middleware).toContain('"/api/erp/kit-rechecks/process"');
    expect(reminderCronRoute).toContain("ERP_CRON_SECRET");
    expect(kitCronRoute).toContain("ERP_CRON_SECRET");
  });

  it("keeps ERP dashboard reachable for internal ERP roles and makes login fail closed", () => {
    expect(middleware).toMatch(/const warehouseAllowed =\s+erpDashboard \|\|/);
    expect(loginPage.match(/<form onSubmit=\{handleSubmit\} method="post" action="\/login"/g)).toHaveLength(2);
  });

  it("requires every login static asset to be validated from the extracted standalone package", () => {
    expect(buildWorkflow).toContain("Login static asset is unavailable");
    expect(validationWorkflow).toContain("for (const asset of staticAssets)");
    expect(validationWorkflow).toContain("find \"$APP_DIR/.next/static\" -type f -name '*.css'");
  });

  it("keeps rollback explicit and forbids database-wide destructive statements", () => {
    expect(rollback).not.toMatch(/\b(?:DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM|migrate\s+reset)\b/i);
    expect(rollback).toContain("DROP TABLE `erp_purchase_demands`");
    expect(rollback).toContain("DROP COLUMN `deliveryDateSnapshot`");
  });
});
