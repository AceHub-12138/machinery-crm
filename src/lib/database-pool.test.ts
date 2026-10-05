import { describe, expect, it } from "vitest";
import { withDatabasePoolDefaults } from "./database-pool";

describe("数据库连接池默认配置", () => {
  it("显式池参数和独立账号不被覆盖", () => {
    const url = new URL(withDatabasePoolDefaults("mysql://readonly:p%40ss@localhost/query?connection_limit=3&pool_timeout=7&connect_timeout=4", 2)!);
    expect(url.username).toBe("readonly");
    expect(url.password).toBe("p%40ss");
    expect(url.pathname).toBe("/query");
    expect(url.searchParams.get("connection_limit")).toBe("3");
    expect(url.searchParams.get("pool_timeout")).toBe("7");
    expect(url.searchParams.get("connect_timeout")).toBe("4");
  });
  it("不同连接池按各自预算补缺省值，不丢失原有选项", () => {
    const url = new URL(withDatabasePoolDefaults("mysql://audit:test@localhost/audit?sslaccept=strict", 2)!);
    expect(url.searchParams.get("connection_limit")).toBe("2");
    expect(url.searchParams.get("sslaccept")).toBe("strict");
    expect(withDatabasePoolDefaults(undefined)).toBeUndefined();
  });
});
