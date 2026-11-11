import { describe, expect, it } from "vitest";
import { extractPhones, pagePhoneEvidence, phoneNearCompany, sanitizeLlmPhone, verifiedPageContact } from "@/lib/lead-hunter/phone";

describe("[R7] 主体紧接不同有限公司类后缀", () => {
  it.each([
    "济南恒精机械有限责任公司 电话：0531-11112222",
    "欢迎访问济南恒精机械股份有限公司 电话：0531-11112222",
  ])("至少四字主体紧接不同后缀仍关联目标：%s", (text) => {
    expect(verifiedPageContact("0531-11112222", text, "济南恒精机械有限公司")).toBe("0531-11112222");
  });
  it("主体与后缀之间有其他字时仍拒绝姊妹公司号码", () => {
    expect(verifiedPageContact("0531-33334444", "济南恒精机械有限公司 电话 0531-11112222\n济南恒精机械设备有限公司 电话 0531-33334444", "济南恒精机械有限公司")).toBeNull();
  });
  it("主体不足四字时不接受其他后缀", () => {
    expect(verifiedPageContact("0531-33334444", "甲机械股份有限公司 电话 0531-33334444", "甲机械有限公司")).toBeNull();
  });
});

describe("[R8] 传真连续传递不跨行", () => {
  it.each(["\n", "\r", "\r\n"])("%s 后无标签手机保留", (separator) => {
    expect(extractPhones(`传真：0574-87654321${separator}13800000000`)).toEqual([{ value: "13800000000", kind: "mobile" }]);
  });
  it("同一行斜杠连接的传真仍全部过滤", () => {
    expect(extractPhones("传真：0574-87654321 / 0574-87654322")).toEqual([]);
  });
  it("传真标签和号码之间有换行制表符仍过滤", () => {
    expect(extractPhones("传真\n\t\t\t\t\t\t0574-87654321")).toEqual([]);
  });
  it.each(["\t", "\u3000", "\u00a0"])("同一行空白 %s 继续传递传真", (separator) => {
    expect(extractPhones(`传真：0574-87654321${separator}13800000000`)).toEqual([]);
  });
});

describe("[R4] 按公司后缀位置识别带前缀的目标", () => {
  it.each([
    ["欢迎访问甲机械有限公司 电话：0531-11112222", "甲机械有限公司"],
    ["本公司甲机械有限公司联系电话：0531-11112222", "甲机械有限公司"],
    ["电话：0531-11112222\n版权所有甲机械有限公司", "甲机械有限公司"],
    ["电话：0531-11112222 Copyright©2024甲机械有限公司", "甲机械有限公司"],
    ["欢迎来到山东大川重工机床股份有限公司官网 电话：0531-11112222", "山东大川重工机床股份有限公司"],
    ["欢迎访问宁波恒精 电话：0531-11112222", "宁波恒精有限公司"],
  ])("正常前缀不把目标自身判成其他公司：%s", (text, company) => {
    expect(verifiedPageContact("0531-11112222", text, company)).toBe("0531-11112222");
    expect(pagePhoneEvidence(null, text, "0531-11112222", company)?.excerpt).toContain("0531-11112222");
  });
  it("版权所有前缀后若为其他公司，仍禁止目标认领", () => {
    expect(verifiedPageContact("0531-33334444", "版权所有乙机械有限公司 电话：0531-33334444", "甲机械有限公司")).toBeNull();
  });
});

describe("[R5] 原文条目边界约束号码在前的名录", () => {
  const company = "甲机械有限公司";
  const text = "电话：0531-11112222 甲机械有限公司\n电话：0531-33334444 乙机械有限公司";
  it("不跨到上一条目认领乙的电话", () => {
    expect(verifiedPageContact("0531-33334444", text, company)).toBeNull();
  });
  it("同一份名录甲仍能认领自己的电话", () => {
    expect(verifiedPageContact("0531-11112222", text, company)).toBe("0531-11112222");
  });
  it("中文分号分隔的号码在前名录也不误配", () => {
    expect(verifiedPageContact("0531-33334444", text.replace("\n", "；"), company)).toBeNull();
  });
  it("电话所在条目无公司全称时保留名称分行联系页", () => {
    expect(verifiedPageContact("0531-11112222", "甲机械有限公司\n地址：济南市xx路\n电话：0531-11112222", company)).toBe("0531-11112222");
  });
  it("名称和号码分行的名录继续阻止甲认领乙的电话", () => {
    expect(verifiedPageContact("0531-33334444", "甲机械有限公司\n电话：0531-11112222\n乙机械有限公司\n电话：0531-33334444", company)).toBeNull();
  });
  it.each(["\r", "。", ";", "|"])("原文分隔符 %s 划分条目", (separator) => {
    expect(verifiedPageContact("0531-33334444", text.replace("\n", separator), company)).toBeNull();
  });
  it.each(["，", "、", " ", "：", "（联系）"])("%s 不拆分同一条目", (separator) => {
    expect(verifiedPageContact("0531-11112222", `甲机械有限公司${separator}电话：0531-11112222 乙机械有限公司`, company)).toBe("0531-11112222");
  });
});

describe("[R6] 装饰传真标签与连续传真号码", () => {
  it.each([
    "传真（Fax）：0574-87654321",
    "【传真】0574-87654321",
    "传真号码为：0574-87654321",
    "传真：0574-87654321 / 0574-87654322",
    "传真（Fax No.）：0574-87654321",
    "传真号码是：0574-87654321",
    "传真☆【】：0574-87654321",
    "Tel/Fax: 0574-87654321",
  ])("不提取传真：%s", (text) => {
    expect(extractPhones(text)).toEqual([]);
  });
  it.each([" ", "/", "、", ",", "，", ";", "；"])("分隔符 %s 连接的传真连续传递", (separator) => {
    expect(extractPhones(`传真：0574-87654321${separator}13900002222${separator}0574-87654322`)).toEqual([]);
  });
  it("号码后面的传真另询说明不误伤两个正常电话", () => {
    expect(extractPhones("电话：0574-11112222 / 0574-11113333（传真另询）")).toEqual([
      { value: "0574-11112222", kind: "landline" }, { value: "0574-11113333", kind: "landline" },
    ]);
  });
  it("同号后来正常标为电话时仍然保留", () => {
    expect(extractPhones("【传真】0574-87654321 / 0574-87654322；电话：0574-87654321")).toEqual([{ value: "0574-87654321", kind: "landline" }]);
  });
  it.each(["0574-87654321", "0574-87654322"])("网页核验也拒绝连续传真 %s", (phone) => {
    expect(verifiedPageContact(phone, "甲机械有限公司 传真（Fax）：0574-87654321 / 0574-87654322", "甲机械有限公司")).toBeNull();
  });
  it("正常电话与传真列表并列时只保留正常电话", () => {
    expect(extractPhones("电话：0574-11112222　传　真（Fax）：0574-87654321 / 0574-87654322")).toEqual([{ value: "0574-11112222", kind: "landline" }]);
  });
});

describe("[R1] 紧凑名录中的公司电话归属", () => {
  const company = "甲机械有限公司";
  const directory = "甲机械有限公司 电话：0531-11112222\n乙机械有限公司 电话：0531-33334444\n丙机械有限公司 电话：0531-55556666";
  it.each(["0531-33334444", "0531-55556666"])("甲不能认领名录中其他公司的 %s", (phone) => {
    expect(verifiedPageContact(phone, directory, company)).toBeNull();
    expect(pagePhoneEvidence(null, directory, phone, company)).toBeNull();
  });
  it("甲可以认领名录中自己的号码", () => {
    expect(verifiedPageContact("0531-11112222", directory, company)).toBe("0531-11112222");
  });
  it("同一行空格排列也不能认领其他公司的号码", () => {
    expect(verifiedPageContact("0531-33334444", "甲机械有限公司 电话 0531-11112222 乙机械有限公司 电话 0531-33334444", company)).toBeNull();
  });
  it("号码前最近是其他公司时，后面的目标名称不能认领号码", () => {
    expect(verifiedPageContact("0531-33334444", "乙机械有限公司 电话 0531-33334444 甲机械有限公司", company)).toBeNull();
  });
  it("号码和后面的目标名称之间有其他公司时不关联", () => {
    expect(verifiedPageContact("0531-33334444", "电话 0531-33334444 乙机械有限公司 甲机械有限公司", company)).toBeNull();
  });
  it.each(["股份有限公司", "有限责任公司", "有限公司", "集团有限公司"])("识别至少两字且带 %s 的其他公司", (suffix) => {
    expect(verifiedPageContact("0531-33334444", `甲机械有限公司 乙方${suffix} 电话 0531-33334444`, company)).toBeNull();
  });
  it("识别带字母数字的其他公司全称", () => {
    expect(verifiedPageContact("0531-33334444", "甲机械有限公司 A2有限公司 电话 0531-33334444", company)).toBeNull();
  });
  it.each([
    "甲机械有限公司 公司地址：济南市xx路 公司电话：0531-11112222",
    "甲机械有限公司 厂址：xx 电话：0531-11112222",
    "电话：0531-11112222（甲机械有限公司销售部）",
    "甲机械有限公司 公司电话：0531-11112222 乙机械有限公司",
  ])("正常目标电话不被标签或后续条目误伤：%s", (text) => {
    expect(verifiedPageContact("0531-11112222", text, company)).toBe("0531-11112222");
  });
});

describe("[R2] 带空白和英文扩展标签的传真过滤", () => {
  it.each([
    "传\u3000真：0574-87654321",
    "传 真：0574-87654321",
    "Fax No.: 0574-87654321",
    "传真\n\t\t\t\t\t\t0574-87654321",
    "传\u00a0真号：0574-87654321",
    "传真号码.: 0574-87654321",
    "fAx NuMbEr.: 0574-87654321",
    "电话/传真：0574-87654321",
  ])("不提取传真：%s", (text) => {
    expect(extractPhones(text)).toEqual([]);
  });
  it("正常电话与全角空格传真并列时只保留正常电话", () => {
    expect(extractPhones("电话：0574-11112222\u3000传\u3000真：0574-87654321")).toEqual([{ value: "0574-11112222", kind: "landline" }]);
  });
  it("超过三十字的传真标签不误伤正常号码", () => {
    expect(extractPhones("传真" + "。".repeat(31) + "电话：0574-11112222")).toEqual([{ value: "0574-11112222", kind: "landline" }]);
  });
  it("公司名称在旁边时，verifiedPageContact 也拒绝全角空格传真", () => {
    expect(verifiedPageContact("0574-87654321", "甲机械有限公司 传\u3000真：0574-87654321", "甲机械有限公司")).toBeNull();
  });
});

describe("[F1] phoneNearCompany", () => {
  const phone = "13900002222";
  const company = "宁波恒精传动科技有限公司";
  it("丢弃名录中其他公司的号码", () => {
    const text = company + "介绍".repeat(100) + "乙五金制品厂 电话 " + phone;
    expect(phoneNearCompany(text, phone, company)).toBe(false);
    expect(pagePhoneEvidence(null, text, phone, company)).toBeNull();
  });
  it.each(["股份有限公司", "有限责任公司", "有限公司", "集团", "厂", "集团有限公司"])("接受去掉 %s 后至少四字的主体", (suffix) => {
    expect(phoneNearCompany("宁波恒精 电话 " + phone, phone, "宁波恒精" + suffix)).toBe(true);
  });
  it("名称主体不足四字时必须匹配全称", () => {
    expect(phoneNearCompany("恒精 电话 " + phone, phone, "恒精有限公司")).toBe(false);
    expect(phoneNearCompany("恒精有限公司 电话 " + phone, phone, "恒精有限公司")).toBe(true);
    expect(phoneNearCompany("甲 电话 " + phone, phone, "甲公司")).toBe(false);
    expect(phoneNearCompany("电话 " + phone, phone, "")).toBe(false);
  });
  it("全称规范化支持括号、空格、英文大小写和全角字符", () => {
    expect(phoneNearCompany("ＡＢＣ（宁波） 有限公司 电话 " + phone, phone, "abc(宁波)有限公司")).toBe(true);
  });
  it.each(["before", "after"])("严格按原文字数限制 %s 侧的 80 字窗口", (side) => {
    const text = (gap: number) => side === "before" ? "甲公司" + "。".repeat(gap) + phone : phone + "。".repeat(gap) + "甲公司";
    expect(phoneNearCompany(text(77), phone, "甲公司")).toBe(true);
    expect(phoneNearCompany(text(78), phone, "甲公司")).toBe(false);
  });
  it("证据包含名称与号码，并跳过同号先前的无关联或传真记录", () => {
    const text = "乙公司电话 " + phone + "。".repeat(100) + company + " 传真：" + phone + "。".repeat(100) + company + "。".repeat(60) + "电话 +86 " + phone;
    const evidence = pagePhoneEvidence("https://example.com", text, phone, company, new Date("2026-11-06T00:00:00Z"));
    expect(evidence).toMatchObject({ sourceUrl: "https://example.com", extractedAt: "2026-11-06T00:00:00.000Z" });
    expect(evidence?.excerpt).toContain(company);
    expect(evidence?.excerpt).toContain("+86 " + phone);
    expect(verifiedPageContact(phone, text, company)).toBe(phone);
  });
});

describe("extractPhones", () => {
  it.each(["传真：", "Fax: ", "FAX：", "fax：", "传真号码："])("[F3] 不提取 %s 标记的号码", (label) => {
    expect(extractPhones(`${label}0574-87654321；电话 13812345678`)).toEqual([{ value: "13812345678", kind: "mobile" }]);
    expect(extractPhones(`${label}13812345678`)).toEqual([]);
  });
  it("[F3] 同号先作为传真出现时，仍保留后面的电话记录", () => {
    expect(extractPhones("传真：0574-87654321；电话：0574-87654321")).toEqual([{ value: "0574-87654321", kind: "landline" }]);
  });
  it("[F3] 传真标签按号码前三十字原文去空白后判断（R2 更新边界）", () => {
    expect(extractPhones("传真" + " ".repeat(4) + "0574-87654321")).toEqual([]);
    expect(extractPhones("传真" + " ".repeat(5) + "0574-87654321")).toEqual([]);
    expect(extractPhones("传真" + " ".repeat(28) + "0574-87654321")).toEqual([]);
    expect(extractPhones("传真" + " ".repeat(29) + "0574-87654321")).toHaveLength(1);
    expect(extractPhones("FAX: +86 13900002222")).toEqual([]);
  });
  it("提取手机号（含 +86/86 前缀）", () => {
    expect(extractPhones("请联系王经理 13812345678")).toEqual([{ value: "13812345678", kind: "mobile" }]);
    expect(extractPhones("电话 +86 13957881234 详谈")).toEqual([{ value: "13957881234", kind: "mobile" }]);
  });

  it("提取带区号座机", () => {
    expect(extractPhones("联系电话 0576-88012345")).toEqual([{ value: "0576-88012345", kind: "landline" }]);
    expect(extractPhones("电话 057188881234 咨询")).toEqual([{ value: "057188881234", kind: "landline" }]);
  });

  it("不识别 400 热线（2026-09-05 业务拍板：400 直接去掉）", () => {
    expect(extractPhones("全国热线 400-123-4567 欢迎来电")).toEqual([]);
    expect(extractPhones("热线 4001234567；手机 13812345678")).toEqual([{ value: "13812345678", kind: "mobile" }]);
  });

  it("手机排在座机前（手机为强信号，座机降权）", () => {
    const phones = extractPhones("座机 0571-88881234，手机 13812345678");
    expect(phones.map((phone) => phone.kind)).toEqual(["mobile", "landline"]);
  });

  it("同号去重、日期型号等不误识别", () => {
    expect(extractPhones("电话 13812345678、138-1234-5678")).toEqual([{ value: "13812345678", kind: "mobile" }]);
    expect(extractPhones("2026年08月01日交付 12345678")).toEqual([]);
  });
});

describe("sanitizeLlmPhone", () => {
  it("接受手机与带区号座机", () => {
    expect(sanitizeLlmPhone("13812345678")).toBe("13812345678");
    expect(sanitizeLlmPhone("+86 13812345678")).toBe("13812345678");
    expect(sanitizeLlmPhone("0576-88012345")).toBe("0576-88012345");
  });

  it("拒收 400/106 等非手机座机号码", () => {
    expect(sanitizeLlmPhone("400-123-4567")).toBeNull();
    expect(sanitizeLlmPhone("4001234567")).toBeNull();
    expect(sanitizeLlmPhone("1069000001")).toBeNull();
  });

  it("空值与非字符串返回 null", () => {
    expect(sanitizeLlmPhone("")).toBeNull();
    expect(sanitizeLlmPhone(null)).toBeNull();
    expect(sanitizeLlmPhone(undefined)).toBeNull();
    expect(sanitizeLlmPhone("无")).toBeNull();
  });
});
