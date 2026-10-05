import { describe, expect, it } from "vitest";
import { normalizeSupplierInput, validateNewSupplierInput } from "./supplier-input";

describe("validateSupplierInput", () => {
  it("requires supplier name, contact and phone", () => {
    expect(() => validateNewSupplierInput({ name: "", contactName: "张工", phone: "13800000000" })).toThrow("供应商名称为必填项");
    expect(() => validateNewSupplierInput({ name: "大川供应商", contactName: "", phone: "13800000000" })).toThrow("联系人为必填项");
    expect(() => validateNewSupplierInput({ name: "大川供应商", contactName: "张工", phone: "" })).toThrow("联系电话为必填项");
  });

  it("trims required supplier fields and preserves optional empty values as null", () => {
    expect(validateNewSupplierInput({
      name: "  大川供应商  ",
      contactName: "  张工 ",
      phone: " 0531-12345678 ",
      email: " ",
    })).toMatchObject({
      name: "大川供应商",
      contactName: "张工",
      phone: "0531-12345678",
      email: null,
    });
  });

  it("keeps legacy suppliers editable when historical contact fields are empty", () => {
    expect(normalizeSupplierInput({ name: "历史供应商", contactName: "", phone: "" })).toMatchObject({
      name: "历史供应商",
      contactName: null,
      phone: null,
    });
  });
});
