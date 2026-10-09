export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function beijingParts(date: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
}
export function formatClock(date: Date) {
  const p = beijingParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function formatMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100000000) {
    return `¥${(value / 100000000).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}亿`;
  }
  if (abs >= 10000) {
    return `¥${(value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}万`;
  }
  return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

/** 公开 payload 的金额是十进制字符串；只做展示格式化，异常值安全归零。 */
export function formatMoneyAmount(value: string) {
  const numeric = Number(value);
  return formatMoney(Number.isFinite(numeric) ? numeric : 0);
}

export function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const p = beijingParts(date);
  return `${p.month}-${p.day}`;
}

export function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}
