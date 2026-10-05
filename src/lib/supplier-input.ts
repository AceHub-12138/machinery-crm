export type SupplierInput = {
  name?: unknown;
  contactName?: unknown;
  phone?: unknown;
  wechat?: unknown;
  email?: unknown;
  address?: unknown;
  mainCategory?: unknown;
  remark?: unknown;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

export function normalizeSupplierInput(input: SupplierInput) {
  const name = cleanText(input.name);
  const contactName = cleanText(input.contactName);
  const phone = cleanText(input.phone);
  if (!name) throw new Error("供应商名称为必填项");
  return {
    name,
    contactName,
    phone,
    wechat: cleanText(input.wechat),
    email: cleanText(input.email),
    address: cleanText(input.address),
    mainCategory: cleanText(input.mainCategory),
    remark: cleanText(input.remark),
  };
}

export function validateNewSupplierInput(input: SupplierInput) {
  const normalized = normalizeSupplierInput(input);
  if (!normalized.contactName) throw new Error("联系人为必填项");
  if (!normalized.phone) throw new Error("联系电话为必填项");
  return { ...normalized, contactName: normalized.contactName, phone: normalized.phone };
}
