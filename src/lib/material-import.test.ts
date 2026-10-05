import { describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { MAX_IMPORT_BYTES, parseMaterialWorkbook } from "./material-import";

function workbook(ref?: string) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([{ 物料编号: "A001", 物料名称: "螺母" }]);
  if (ref) sheet["!ref"] = ref;
  XLSX.utils.book_append_sheet(book, sheet, "物料");
  return new File([XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true })], "物料.xlsx");
}

describe("物料导入资源限制", () => {
  it("正常压缩工作簿仍可导入", async () => {
    expect(await parseMaterialWorkbook(workbook())).toEqual([{ 物料编号: "A001", 物料名称: "螺母" }]);
  });
  it("超限文件在读取内存前被拒绝", async () => {
    const file = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "大表.xlsx");
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(parseMaterialWorkbook(file)).rejects.toThrow("5MB");
    expect(read).not.toHaveBeenCalled();
  });
  it("拒绝空文件、伪造压缩包和不支持的格式", async () => {
    await expect(parseMaterialWorkbook(new File([], "空.xlsx"))).rejects.toThrow();
    await expect(parseMaterialWorkbook(new File(["PK-invalid"], "假.xlsx"))).rejects.toThrow();
    await expect(parseMaterialWorkbook(new File(["data"], "data.csv"))).rejects.toThrow();
  });
  it("小文件声明大量空行也必须被拒绝，不能静默截断后导入", async () => {
    await expect(parseMaterialWorkbook(workbook("A1:B10001"))).rejects.toThrow("5000");
  });
  it("拒绝压缩包伪报解压长度", async () => {
    const original = workbook();
    const buffer = Buffer.from(await original.arrayBuffer());
    const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(1, central + 24);
    await expect(parseMaterialWorkbook(new File([buffer], "伪造.xlsx"))).rejects.toThrow();
  });
});

it("实际解压超过 40MB 时中止，即使包中伪报为一个字节", async () => {
  const data = deflateRawSync(Buffer.alloc(41 * 1024 * 1024, 65));
  const local = Buffer.alloc(31);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(1, 26); local[30] = 97;
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(1, 24); central.writeUInt16LE(1, 28); central[46] = 97;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + data.length, 16);
  await expect(parseMaterialWorkbook(new File([Buffer.concat([local, data, central, end])], "bomb.xlsx"))).rejects.toThrow();
});
