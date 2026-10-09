const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 3_600_000;

/** DATE 列存业务日期（UTC 零点编码），createdAt 则存真正时间戳，两者不能共用边界。 */
export function beijingPeriod(now: Date) {
  const local = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const dateToday = new Date(Date.UTC(year, month, local.getUTCDate()));
  const dateStart = new Date(Date.UTC(year, month, 1));
  const dateTomorrow = new Date(dateToday.getTime() + DAY_MS);
  const dateSevenDays = new Date(dateToday.getTime() + 7 * DAY_MS);
  return {
    year, month: month + 1,
    label: `${year}年${month + 1}月`,
    dateStart, dateToday, dateTomorrow, dateSevenDays,
    start: new Date(dateStart.getTime() - BEIJING_OFFSET_MS),
    end: new Date(dateTomorrow.getTime() - BEIJING_OFFSET_MS),
    startDate: dateStart.toISOString().slice(0, 10),
    endDate: dateToday.toISOString().slice(0, 10),
  };
}
