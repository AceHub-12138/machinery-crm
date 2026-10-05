/**
 * 天眼查「企业基本信息(含主要人员) V3」REST 直调客户端（不走 MCP，便于精确计数与限额）。
 * 端点/参数来自用户提供的接口信息：GET baseinfoV3/2.0?keyword=公司名，Token 走 Authorization 头。
 * 真实返回结构以充值后联调为准，字段解析从宽（电话/法人/注册地址命中即回填）。
 */

export type TianyanchaLookup = {
  found: boolean;
  phone: string | null;
  legalPerson: string | null;
  regAddress: string | null;
  raw: Record<string, unknown>;
};

export type TianyanchaClient = {
  lookupCompany(companyName: string): Promise<TianyanchaLookup>;
  /** 今日已调用次数（进程内存计数，服务重启清零——只会让护栏更早放开，不会多扣费） */
  todayCallCount(): number;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const ENDPOINT = "http://open.api.tianyancha.com/services/open/ic/baseinfoV3/2.0";

const globalCounter = globalThis as unknown as { __leadHunterTycDaily?: { date: string; count: number } };

function todayKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

function readDailyCount(now: Date) {
  const counter = globalCounter.__leadHunterTycDaily;
  return counter && counter.date === todayKey(now) ? counter.count : 0;
}

function bumpDailyCount(now: Date) {
  const date = todayKey(now);
  const counter = globalCounter.__leadHunterTycDaily;
  globalCounter.__leadHunterTycDaily = counter && counter.date === date
    ? { date, count: counter.count + 1 }
    : { date, count: 1 };
  return globalCounter.__leadHunterTycDaily.count;
}

/** 从返回 result 中从宽提取首个电话字段（真实字段名以联调为准） */
function pickPhone(result: Record<string, unknown>): string | null {
  for (const key of ["phoneNumber", "phone", "contactPhoneNumber", "taxPhoneNumber"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function createTianyanchaClient(options?: { fetchImpl?: FetchLike; now?: () => Date }): TianyanchaClient {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? (() => new Date());
  const useMock = process.env.LEAD_TYC_MOCK?.trim() === "1" || !process.env.LEAD_TYC_TOKEN?.trim();

  return {
    todayCallCount() {
      return readDailyCount(now());
    },

    async lookupCompany(companyName) {
      bumpDailyCount(now());

      if (useMock) {
        // Mock：内置两家模拟企业，一家有电话一家无（公司名含「集团」命中无电话那家，确定性可测）
        const found = !companyName.includes("集团");
        return {
          found,
          phone: found ? "13957881234" : null,
          legalPerson: found ? "陈某某" : null,
          regAddress: found ? "浙江省宁波市鄞州区恒精路88号" : null,
          raw: { mock: true, keyword: companyName, found },
        };
      }

      const token = process.env.LEAD_TYC_TOKEN!.trim();
      let response: Response;
      try {
        response = await fetchImpl(`${ENDPOINT}?keyword=${encodeURIComponent(companyName)}`, {
          headers: { authorization: token },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return { found: false, phone: null, legalPerson: null, regAddress: null, raw: { error: String(error) } };
      }
      const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
      const result = (raw.result && typeof raw.result === "object" ? raw.result : null) as Record<string, unknown> | null;
      if (!response.ok || !result) {
        return { found: false, phone: null, legalPerson: null, regAddress: null, raw };
      }
      const legalPerson = typeof result.legalPersonName === "string" ? result.legalPersonName : null;
      const regAddress = typeof result.regLocation === "string" ? result.regLocation : null;
      return { found: true, phone: pickPhone(result), legalPerson, regAddress, raw };
    },
  };
}
