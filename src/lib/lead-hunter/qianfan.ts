/**
 * 百度千帆 AI 搜索客户端。请求格式照抄 n8n「百度获客-生产-v1-评分门槛」工作流导出：
 * POST /v2/ai_search/web_search，messages + search_source=baidu_search_v2 + resource_type_filter(web, top_k)。
 */

export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  snippet: string;
  date: string;
  website: string;
};

export type SearchClient = {
  searchWeb(keyword: string, topK: number): Promise<WebSearchResult[]>;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createQianfanSearchClient(fetchImpl: FetchLike = fetch): SearchClient {
  return {
    async searchWeb(keyword, topK) {
      const apiKey = process.env.QIANFAN_SEARCH_API_KEY?.trim();
      if (!apiKey) throw new Error("QIANFAN_SEARCH_API_KEY 未配置，无法执行真实搜索");
      const response = await fetchImpl("https://qianfan.baidubce.com/v2/ai_search/web_search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          messages: [{ role: "user", content: keyword }],
          search_source: "baidu_search_v2",
          resource_type_filter: [{ type: "web", top_k: topK }],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        throw new Error(`千帆搜索失败 ${response.status}${detail ? `：${detail}` : ""}`);
      }
      const data = await response.json() as { references?: unknown };
      const references = Array.isArray(data.references) ? data.references : [];
      return references.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          title: String(row.title ?? ""),
          url: String(row.url ?? ""),
          content: String(row.content ?? ""),
          snippet: String(row.snippet ?? ""),
          date: String(row.date ?? ""),
          website: String(row.website ?? ""),
        };
      });
    },
  };
}

/**
 * 本地/演示用假搜索（LEAD_HUNTER_FAKE_SEARCH=1）：不花千帆额度。
 * 三家固定样例企业轮换出现：一家有手机号（浙江省宁波市，可验证分单）、一家只有座机（弱信号）、一家无电话（可验证反查）。
 */
export function createFakeSearchClient(): SearchClient {
  const samples: WebSearchResult[] = [
    {
      title: "宁波恒精传动科技有限公司 - 联系我们",
      url: "https://www.example-hengjing.cn/contact",
      content: "宁波恒精传动科技有限公司专业从事精密齿轮、联轴器与键槽加工，拥有多台数控插齿机。采购请联系王经理：13812345678",
      snippet: "",
      date: "2026-08-01",
      website: "example-hengjing.cn",
    },
    {
      title: "台州洪发阀门制造有限公司 - 公司简介",
      url: "https://www.example-hongfa.com/about",
      content: "台州洪发阀门制造有限公司生产各类工业阀门，机加工车间对外协作。联系电话：0576-88012345 张厂长",
      snippet: "",
      date: "2026-08-02",
      website: "example-hongfa.com",
    },
    {
      title: "苏州拓峰自动化设备有限公司 招聘启事",
      url: "https://www.example-tuofeng.com/jobs",
      content: "苏州拓峰自动化设备有限公司因新增产线扩建，招聘机械工程师与数控操作工多名，工作地点苏州工业园区。",
      snippet: "",
      date: "2026-08-03",
      website: "example-tuofeng.com",
    },
  ];
  let call = 0;
  return {
    async searchWeb(keyword, topK) {
      call += 1;
      const offset = (call - 1) % samples.length;
      const rotated = [...samples.slice(offset), ...samples.slice(0, offset)];
      return rotated.slice(0, Math.max(1, Math.min(topK, rotated.length))).map((item, index) => ({
        ...item,
        url: `${item.url}?kw=${encodeURIComponent(keyword)}&c=${call}-${index}`,
      }));
    },
  };
}
