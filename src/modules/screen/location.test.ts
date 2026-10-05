import { describe, it, expect } from "vitest";
import { resolveLocation, isValidLocation } from "./location";

describe("resolveLocation（自由文本 region 解析，失败封闭）", () => {
  it("标准省市正常解析", () => {
    expect(resolveLocation("山东省济南市")).toEqual({ province: "山东省", city: "济南市" });
    expect(resolveLocation("山东省济南市历下区XX路123号")).toEqual({ province: "山东省", city: "济南市" });
    expect(resolveLocation("四川省成都市武侯区")).toEqual({ province: "四川省", city: "成都市" });
  });

  it("P0：拼接敏感信息的自由文本不得进入城市字段", () => {
    expect(resolveLocation("山东省李四13900139000济南市")).toEqual({ province: "山东省", city: null });
    expect(resolveLocation("广东省张三010-12345678")).toEqual({ province: "广东省", city: null });
  });

  it("非标准省份整体拒绝", () => {
    expect(resolveLocation("假省济南市")).toBeNull();
    expect(resolveLocation("天河区珠江新城XX路123号")).toBeNull();
    expect(resolveLocation("李四13900139000山东省济南市")).toBeNull();
  });

  it("自治区全称按数据源最长前缀匹配", () => {
    expect(resolveLocation("广西壮族自治区南宁市")).toEqual({
      province: "广西壮族自治区",
      city: "南宁市",
    });
    expect(resolveLocation("新疆维吾尔自治区乌鲁木齐市")).toEqual({
      province: "新疆维吾尔自治区",
      city: "乌鲁木齐市",
    });
    expect(resolveLocation("内蒙古自治区呼和浩特市新城区")).toEqual({
      province: "内蒙古自治区",
      city: "呼和浩特市",
    });
  });

  it("直辖市按整省处理，区县不得作为城市", () => {
    expect(resolveLocation("北京市朝阳区")).toEqual({ province: "北京市", city: null });
    expect(resolveLocation("上海市浦东新区")).toEqual({ province: "上海市", city: null });
  });

  it("城市必须属于该省份", () => {
    expect(resolveLocation("河北省济南市")).toEqual({ province: "河北省", city: null });
    expect(resolveLocation("山东省石家庄市")).toEqual({ province: "山东省", city: null });
  });

  it("自治州/盟/地区等标准城市名同样按前缀匹配", () => {
    expect(resolveLocation("吉林省延边朝鲜族自治州")).toEqual({
      province: "吉林省",
      city: "延边朝鲜族自治州",
    });
    expect(resolveLocation("贵州省黔东南苗族侗族自治州凯里市")).toEqual({
      province: "贵州省",
      city: "黔东南苗族侗族自治州",
    });
  });

  it("空值与非字符串安全处理", () => {
    expect(resolveLocation(null)).toBeNull();
    expect(resolveLocation(undefined)).toBeNull();
    expect(resolveLocation("")).toBeNull();
    expect(resolveLocation("   ")).toBeNull();
    expect(resolveLocation(123 as unknown as string)).toBeNull();
  });
});

describe("isValidLocation（省市校验，数据源为 PROVINCE_CITY_MAP）", () => {
  it("标准省份通过校验", () => {
    expect(isValidLocation("山东省", null)).toBe(true);
    expect(isValidLocation("北京市", null)).toBe(true);
    expect(isValidLocation("广西壮族自治区", null)).toBe(true);
  });

  it("城市必须属于该省份", () => {
    expect(isValidLocation("山东省", "济南市")).toBe(true);
    expect(isValidLocation("山东省", "青岛市")).toBe(true);
    expect(isValidLocation("河北省", "济南市")).toBe(false);
    expect(isValidLocation("山东省", "历下区")).toBe(false);
  });

  it("整省处理的省级单位不接受城市", () => {
    expect(isValidLocation("北京市", "朝阳区")).toBe(false);
    expect(isValidLocation("国外", "某市")).toBe(false);
  });

  it("非法省份与非法输入拒绝", () => {
    expect(isValidLocation("火星省", null)).toBe(false);
    expect(isValidLocation("香港特别行政区", null)).toBe(false); // 标准名单不含港澳台，客户域使用"国外"
    expect(isValidLocation("", null)).toBe(false);
    expect(isValidLocation(undefined as unknown as string, null)).toBe(false);
  });

  it("P1：原型链键不得绕过白名单且不抛错", () => {
    expect(() => isValidLocation("toString", null)).not.toThrow();
    expect(isValidLocation("toString", null)).toBe(false);
    expect(isValidLocation("constructor", null)).toBe(false);
    expect(isValidLocation("__proto__", null)).toBe(false);
    expect(isValidLocation("valueOf", null)).toBe(false);
    expect(isValidLocation("hasOwnProperty", null)).toBe(false);

    // 带城市时此前会因访问原型链函数属性抛 TypeError
    expect(() => isValidLocation("constructor", "toString")).not.toThrow();
    expect(isValidLocation("constructor", "toString")).toBe(false);
    expect(() => isValidLocation("__proto__", "hasOwnProperty")).not.toThrow();
    expect(isValidLocation("__proto__", "hasOwnProperty")).toBe(false);
  });

  it("P1：resolveLocation 必须拒绝原型链键前缀", () => {
    expect(resolveLocation("toString济南市")).toBeNull();
    expect(resolveLocation("constructor hasOwnProperty")).toBeNull();
    expect(resolveLocation("__proto__山东省济南市")).toBeNull();
    expect(resolveLocation("valueOf")).toBeNull();
  });
});
