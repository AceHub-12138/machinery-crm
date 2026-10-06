import * as XLSX from "xlsx";
import { inflateRawSync } from "node:zlib";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_CELLS = 50_000;
const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;

/** 在 SheetJS 解析前验证 ZIP 的实际解压量，不能只信压缩包声明的大小。 */
function validateWorkbookArchive(buffer: Buffer) {
  if (buffer.readUInt16LE(0) !== 0x4b50) return; // 兼容旧 .xls 二进制格式。
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Excel 压缩包格式无效");
  const entries = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 8) !== entries || buffer.readUInt32LE(end + 12) + cursor !== end || entries > 1_024 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) {
    throw new Error("Excel 压缩包过于复杂");
  }
  let total = 0;
  const offsets = new Set<number>();
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Excel 压缩包格式无效");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const expanded = buffer.readUInt32LE(cursor + 24);
    const local = buffer.readUInt32LE(cursor + 42);
    if (expanded > MAX_EXPANDED_BYTES - total || offsets.has(local) || local + 30 > cursor || buffer.readUInt32LE(local) !== 0x04034b50) {
      throw new Error("Excel 解压数据超过限制或格式无效");
    }
    const localFlags = buffer.readUInt16LE(local + 6);
    const flags = buffer.readUInt16LE(cursor + 8);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const localNameLength = buffer.readUInt16LE(local + 26);
    if (flags !== localFlags || (flags & 1) !== 0 || buffer.readUInt16LE(cursor + 34) !== 0
      || method !== buffer.readUInt16LE(local + 8) || localNameLength !== nameLength
      || !buffer.subarray(cursor + 46, cursor + 46 + nameLength).equals(buffer.subarray(local + 30, local + 30 + localNameLength))
      || (flags & 8) === 0 && (buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== expanded)) {
      throw new Error("Excel 压缩包目录与文件声明不一致");
    }
    offsets.add(local);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.readUInt32LE(end + 16) || (method !== 0 && method !== 8)) throw new Error("Excel 压缩包格式无效");
    const bytes = buffer.subarray(start, start + compressed);
    const actual = method === 0 ? bytes.length : inflateRawSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES - total }).length;
    if (actual !== expanded) throw new Error("Excel 压缩包大小声明不一致");
    total += actual;
    if (total > MAX_EXPANDED_BYTES) throw new Error("Excel 解压数据不能超过 40MB");
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  if (cursor !== end) throw new Error("Excel 压缩包格式无效");
}

export async function parseMaterialWorkbook(file: File) {
  if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) throw new Error("导入文件必须非空且不能超过 5MB");
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("仅支持 .xlsx 或 .xls 格式的 Excel 文件");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length < 2) throw new Error("Excel 文件格式无效");
  validateWorkbookArchive(buffer);
  const workbook = XLSX.read(buffer, { type: "buffer", sheets: 0, sheetRows: MAX_IMPORT_ROWS + 2 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const ref = sheet["!fullref"] || sheet["!ref"];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    if (rows > MAX_IMPORT_ROWS + 1 || rows * columns > MAX_IMPORT_CELLS) {
      throw new Error("导入不能超过 5000 行数据或 50000 个单元格");
    }
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}
