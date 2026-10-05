import { describe, expect, it } from "vitest";
import { extractPhones, sanitizeLlmPhone } from "@/lib/lead-hunter/phone";

describe("extractPhones", () => {
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
    expect(sanitizeLlmPhone("+86 13812345678")).toBe("+86 13812345678");
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
