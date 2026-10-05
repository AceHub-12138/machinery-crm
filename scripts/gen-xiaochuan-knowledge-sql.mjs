#!/usr/bin/env node
/**
 * 小川知识库数据 SQL 生成脚本（第 2 期段 1）。
 *
 * 读取四份知识 Excel + 一份西门子 JSON，生成可由宝塔「导入」直接执行的
 * upsert SQL（重复导入=更新+新增，永不删除既有知识行）。
 *
 * 用法（本地 Windows，Git Bash）：
 *   node scripts/gen-xiaochuan-knowledge-sql.mjs \
 *     --machines "<机型能力参数表.xlsx 路径>" \
 *     --rules    "<同一文件时可不传；工艺规则卡在该文件的第三个工作表>" \
 *     --gsk      "<数控插床程序注解（GSK）.xlsx 路径>" \
 *     --knd      "<数控插床程序注解（KND）.xlsx 路径>" \
 *     --out      "<输出 SQL 路径>"
 *
 * 机型参数表与工艺规则卡在同一个工作簿的两个工作表里（--rules 可省略）。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key) continue;
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

const argv = parseArgs(process.argv);
const machinesPath = argv.machines;
const gskPath = argv.gsk;
const kndPath = argv.knd;
const rulesPath = argv.rules || machinesPath; // 工艺规则卡与机型表同一工作簿
const outPath = argv.out || "scripts/out/xiaochuan-knowledge-data.sql";

if (!machinesPath || !gskPath || !kndPath) {
  console.error("缺少参数。示例：node scripts/gen-xiaochuan-knowledge-sql.mjs --machines <xlsx> --gsk <xlsx> --knd <xlsx> --out <sql>");
  process.exit(1);
}

// ---------- 通用工具 ----------
/** 提取文本中所有数字（支持小数），用于把「350/320」「2.2（伺服）」等复合文本解析为筛选用数值 */
function extractNumbers(text) {
  const matches = String(text ?? "").match(/\d+(?:\.\d+)?/g);
  return matches ? matches.map(Number) : [];
}

function maxNumber(text) {
  const numbers = extractNumbers(text);
  return numbers.length ? Math.max(...numbers) : null;
}

/** SQL 字符串字面量转义；null/undefined/空串 → NULL */
function sqlStr(value) {
  if (value === null || value === undefined) return "NULL";
  const text = String(value);
  if (!text) return "NULL";
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "")}'`;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** 程序行 + 行内注解的统一拼接格式：代码（注解） */
function joinProgramLine(code, note) {
  if (!note) return code;
  const trimmed = note.trim();
  return `${code}    ${trimmed.startsWith("（") ? trimmed : `（${trimmed}）`}`;
}

/** 在工作表行数组里定位表头行（标题/空行之后的第一个表头行） */
function findHeaderRow(rows, firstHeader) {
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    if (rows[i].some((cell) => cellText(cell).startsWith(firstHeader))) return i;
  }
  throw new Error(`找不到以「${firstHeader}」开头的表头行`);
}

// ---------- 1. 机型能力参数表 ----------
function loadMachines(xlsxPath) {
  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets["机型能力参数表"];
  if (!sheet) throw new Error(`文件里找不到工作表「机型能力参数表」：${xlsxPath}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // 前几行是大标题和空行，表头行动态定位；按表头名映射列，避免硬编码列序
  const headerIndex = findHeaderRow(rows, "机型大类");
  const headerRow = rows[headerIndex].map(cellText);
  const col = (name) => headerRow.findIndex((header) => header.startsWith(name));
  const columns = {
    category: col("机型大类"),
    model: col("型号"),
    fullName: col("设备全称"),
    mainObjects: col("主要加工对象"),
    maxStroke: col("最大插削/刨削长度"),
    tableSize: col("工作台尺寸"),
    tableLoad: col("工作台最大承重"),
    maxModule: col("最大模数"),
    maxGearWidth: col("最大齿宽"),
    maxOuterGearDia: col("最大工件外齿直径"),
    maxInnerGearDia: col("最大工件内齿直径"),
    ramStroke: col("滑枕/冲头往复次数"),
    power: col("主电机/总功率"),
    maxSpindleRpm: col("主轴最高转速"),
    travels: col("X/Y/Z"),
    ramTilt: col("滑枕倾斜角度"),
    netWeight: col("机床净重"),
    dimensions: col("机床外形尺寸"),
    options: col("选配能力/附件"),
    notSuitable: col("典型不适用工件"),
  };
  if (columns.model < 0 || columns.category < 0) throw new Error("机型参数表表头不完整，请检查文件格式");

  // 来源信息写在「使用说明」表的最后一行备注里
  const usageSheet = workbook.Sheets["使用说明"];
  let sourceNote = null;
  if (usageSheet) {
    for (const row of XLSX.utils.sheet_to_json(usageSheet, { header: 1, defval: "" })) {
      const text = row.map(cellText).join(" ");
      if (text.includes("数据来源") || text.includes("画册")) sourceNote = text;
    }
  }

  const machines = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const model = cellText(row[columns.model]);
    if (!model) continue;
    const category = cellText(row[columns.category]);
    const maxStrokeText = cellText(row[columns.maxStroke]) || null;
    // 筛选用数值只给插削/刨床/插齿类机型；五轴加工中心、键槽铣床的「行程」语义不同，置空防止误导选型
    const strokeIsSlotting = /插|刨/.test(category);
    machines.push({
      category,
      model,
      fullName: cellText(row[columns.fullName]) || model,
      mainObjects: cellText(row[columns.mainObjects]) || null,
      maxStrokeText,
      maxStrokeLengthMm: strokeIsSlotting ? maxNumber(maxStrokeText) : null,
      tableSizeText: cellText(row[columns.tableSize]) || null,
      tableLoadKg: maxNumber(cellText(row[columns.tableLoad])),
      maxModuleMm: maxNumber(cellText(row[columns.maxModule])),
      maxGearWidthMm: maxNumber(cellText(row[columns.maxGearWidth])),
      maxOuterGearDiaMm: maxNumber(cellText(row[columns.maxOuterGearDia])),
      maxInnerGearText: cellText(row[columns.maxInnerGearDia]) || null,
      ramStrokeText: cellText(row[columns.ramStroke]) || null,
      powerText: cellText(row[columns.power]) || null,
      powerKw: maxNumber(cellText(row[columns.power])),
      maxSpindleRpm: maxNumber(cellText(row[columns.maxSpindleRpm])),
      travelsText: cellText(row[columns.travels]) || null,
      ramTiltText: cellText(row[columns.ramTilt]) || null,
      netWeightText: cellText(row[columns.netWeight]) || null,
      dimensionsText: cellText(row[columns.dimensions]) || null,
      optionsText: cellText(row[columns.options]) || null,
      notSuitableText: cellText(row[columns.notSuitable]) || null,
      sourceNote,
      sortOrder: machines.length + 1,
    });
  }
  return machines;
}

// ---------- 2. 工艺规则卡 ----------
function loadRules(xlsxPath) {
  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets["工艺规则卡"];
  if (!sheet) throw new Error(`文件里找不到工作表「工艺规则卡」：${xlsxPath}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const headerIndex = findHeaderRow(rows, "规则编号");
  const rules = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i].map(cellText);
    const ruleNo = row[0] || "";
    if (!/^R\d+$/i.test(ruleNo)) continue; // 跳过标题行、填写提示行等非规则行
    if (!row[1] || !row[2]) continue; // 条件与推荐机型为必填
    rules.push({
      ruleNo: ruleNo.toUpperCase(),
      conditionText: row[1],
      recommendModels: row[2],
      recommendProcess: row[3] || null,
      notRecommended: row[4] || null,
      rationale: row[5] || null,
      enabled: true,
      sortOrder: rules.length + 1,
    });
  }
  return rules;
}

// ---------- 3. GSK 程序注解 ----------
/** GSK 工作表：A 列=程序行/说明文字，F 列=行注解；模板以「××模板」标题行分隔 */
function loadGsk(xlsxPath) {
  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets["Sheet1"];
  if (!sheet) throw new Error(`GSK 文件里找不到 Sheet1：${xlsxPath}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const templates = [];
  let current = null;
  let paramBuffer = "";
  let headerTitle = "";

  for (const raw of rows) {
    const code = cellText(raw[0]);
    const note = cellText(raw[5]);
    if (!code) continue;
    if (!headerTitle) {
      headerTitle = code; // 首行大标题，如「GSK98OMDI插削程序注解」
      continue;
    }
    if (/模板$/.test(code)) {
      current = {
        name: code.replace(/模板$/, ""),
        program: [],
        paramNotes: "",
        extraNotes: "",
      };
      templates.push(current);
      paramBuffer = "";
      continue;
    }
    if (!current) continue;
    // 括号开头的说明文字 = G65 宏参数含义（跨行累积到括号闭合）
    if (code.startsWith("（") || (paramBuffer && !paramBuffer.endsWith("）"))) {
      paramBuffer = paramBuffer ? paramBuffer + code : code;
      if (paramBuffer.endsWith("）")) {
        current.paramNotes = paramBuffer.replace(/^（/, "").replace(/）$/, "");
        paramBuffer = "";
      }
      continue;
    }
    if (/^注[:：]/.test(code)) {
      current.extraNotes = code.replace(/^注[:：]\s*/, "注：");
      continue;
    }
    current.program.push(joinProgramLine(code, note));
  }

  // 同一份宏参数说明在每个模板里重复出现，保留各自一份即可
  return {
    system: "GSK",
    machineNote: headerTitle || "广州数控（GSK）系统",
    templates: templates.map((template) => ({
      name: template.name,
      program: template.program.join("\n"),
      paramNotes: template.paramNotes || null,
      extraNotes: template.extraNotes || null,
    })),
  };
}

// ---------- 4. KND 程序注解 ----------
/** KND 工作表：A 列=序号，B 列=程序行/说明，C 列=行注解；标题行含「拼刀」判定模板名 */
function loadKnd(xlsxPath) {
  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = Object.keys(workbook.Sheets)[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`KND 文件里找不到工作表：${xlsxPath}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const templates = [];
  let current = null;
  let paramBuffer = "";

  for (const raw of rows) {
    const code = cellText(raw[1]);
    const note = cellText(raw[2]);
    if (!code) continue;
    if (/^数控插床程序/.test(code) || /程序（KND）注解/.test(code)) {
      const isComposite = /拼刀/.test(code);
      const nameMatch = code.match(/[（(]([^（）()]*拼刀[^（）()]*)[)）]/);
      current = {
        name: isComposite ? `拼刀插削（${nameMatch ? nameMatch[1] : "多刀分段插削"}）` : "标准插削",
        program: [],
        paramNotes: "",
        extraNotes: "",
        title: code,
      };
      templates.push(current);
      paramBuffer = "";
      continue;
    }
    if (!current) continue;
    if (code.startsWith("（X 表示") || code.startsWith("（X表示") || (paramBuffer && !paramBuffer.endsWith("）"))) {
      paramBuffer = paramBuffer ? paramBuffer + code : code;
      if (paramBuffer.endsWith("）")) {
        current.paramNotes = paramBuffer.replace(/^（/, "").replace(/）$/, "");
        paramBuffer = "";
      }
      continue;
    }
    if (/^注[:：]/.test(code)) {
      current.extraNotes = code.replace(/^注[:：]\s*/, "注：");
      continue;
    }
    current.program.push(joinProgramLine(code, note));
  }

  return {
    system: "KND",
    machineNote: "凯恩帝（KND）数控系统",
    templates: templates.map(({ name, program, paramNotes, extraNotes, title }) => ({
      name,
      title,
      program: program.join("\n"),
      paramNotes: paramNotes || null,
      extraNotes: extraNotes || null,
    })),
  };
}

// ---------- 5. 西门子（JSON 固化） ----------
function loadSiemens() {
  const jsonPath = new URL("./knowledge-source/siemens-nc-programs.json", import.meta.url);
  return JSON.parse(readFileSync(jsonPath, "utf-8"));
}

// ---------- 6. 生成 SQL ----------
function machineUpsert(machine) {
  const columns = [
    "category", "model", "fullName", "mainObjects",
    "maxStrokeText", "maxStrokeLengthMm", "tableSizeText", "tableLoadKg",
    "maxModuleMm", "maxGearWidthMm", "maxOuterGearDiaMm", "maxInnerGearText",
    "ramStrokeText", "powerText", "powerKw", "maxSpindleRpm",
    "travelsText", "ramTiltText", "netWeightText", "dimensionsText",
    "optionsText", "notSuitableText", "sourceNote", "sortOrder",
  ];
  const values = columns.map((key) => {
    const value = machine[key];
    return typeof value === "number" ? String(value) : sqlStr(value);
  });
  const updates = columns
    .filter((key) => key !== "model")
    .map((key) => `\`${key}\` = VALUES(\`${key}\`)`);
  return `INSERT INTO \`machine_capabilities\` (\`id\`, \`updatedAt\`, \`${columns.join("`, `")}\`)\nVALUES (UUID(), NOW(3), ${values.join(", ")})\nON DUPLICATE KEY UPDATE ${updates.join(", ")};`;
}

function ruleUpsert(rule) {
  const columns = ["ruleNo", "conditionText", "recommendModels", "recommendProcess", "notRecommended", "rationale", "enabled", "sortOrder"];
  const values = columns.map((key) => {
    const value = rule[key];
    return typeof value === "number" || typeof value === "boolean" ? String(value) : sqlStr(value);
  });
  const updates = columns.filter((key) => key !== "ruleNo").map((key) => `\`${key}\` = VALUES(\`${key}\`)`);
  return `INSERT INTO \`process_rule_cards\` (\`id\`, \`updatedAt\`, \`${columns.join("`, `")}\`)\nVALUES (UUID(), NOW(3), ${values.join(", ")})\nON DUPLICATE KEY UPDATE ${updates.join(", ")};`;
}

function templateUpsert(template, system, machineNote, sortOrder) {
  const columns = ["system", "name", "machineNote", "program", "paramNotes", "extraNotes", "sortOrder"];
  const row = { system, machineNote, sortOrder, ...template };
  const values = columns.map((key) => {
    const value = row[key];
    return typeof value === "number" ? String(value) : sqlStr(value);
  });
  const updates = columns.filter((key) => key !== "system" && key !== "name").map((key) => `\`${key}\` = VALUES(\`${key}\`)`);
  return `INSERT INTO \`nc_program_templates\` (\`id\`, \`updatedAt\`, \`${columns.join("`, `")}\`)\nVALUES (UUID(), NOW(3), ${values.join(", ")})\nON DUPLICATE KEY UPDATE ${updates.join(", ")};`;
}

// ---------- 主流程 ----------
const machines = loadMachines(machinesPath);
const rules = loadRules(rulesPath);
const gsk = loadGsk(gskPath);
const knd = loadKnd(kndPath);
const siemens = loadSiemens();

if (!machines.length) throw new Error("机型参数表没有解析到任何机型行");
if (!gsk.templates.length) throw new Error("GSK 没有解析到任何程序模板");
if (!knd.templates.length) throw new Error("KND 没有解析到任何程序模板");

const statements = [
  "-- 小川知识库数据（由 scripts/gen-xiaochuan-knowledge-sql.mjs 生成，可重复导入：更新+新增，不删除）",
  `-- 生成时间：${new Date().toISOString()}`,
  `-- 来源：机型 ${machines.length} 行；工艺规则 ${rules.length} 条；程序模板 GSK ${gsk.templates.length} 套 / KND ${knd.templates.length} 套 / SIEMENS ${siemens.templates.length} 套`,
  "",
  "-- ========== 机型能力参数表 ==========",
  ...machines.map(machineUpsert),
  "",
  "-- ========== 工艺规则卡 ==========",
  ...rules.map(ruleUpsert),
  "",
  "-- ========== 数控程序模板 ==========",
  ...[gsk, knd, siemens].flatMap((book) =>
    book.templates.map((template, index) => templateUpsert(template, book.system, book.machineNote, index + 1)),
  ),
  "",
];

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, statements.join("\n"), "utf-8");

console.log(`已生成 ${outPath}`);
console.log(`机型 ${machines.length} 行：${machines.map((m) => m.model).join("、")}`);
console.log(`工艺规则 ${rules.length} 条：${rules.map((r) => r.ruleNo).join("、")}`);
console.log(`程序模板：GSK=[${gsk.templates.map((t) => t.name).join("、")}] KND=[${knd.templates.map((t) => t.name).join("、")}] SIEMENS=[${siemens.templates.map((t) => t.name).join("、")}]`);
