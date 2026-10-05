type Bucket = {
  minuteStart: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

function currentMinute() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function cleanup(currentStart: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.minuteStart !== currentStart) buckets.delete(key);
  }
}

/**
 * 小川对话限流（内存级，单实例部署足够）。
 * 与登录限流同一思路：超限直接拒绝，拒绝时返回建议等待秒数。
 */
export function checkXiaochuanRateLimit(userId: string, limitPerMinute: number) {
  const minuteStart = currentMinute();
  cleanup(minuteStart);
  const bucket = buckets.get(userId) ?? { minuteStart, count: 0 };
  if (bucket.minuteStart !== minuteStart) {
    bucket.minuteStart = minuteStart;
    bucket.count = 0;
  }
  if (bucket.count >= limitPerMinute) {
    return { allowed: false, retryAfterSeconds: Math.max(1, 60 - Math.floor((Date.now() - minuteStart) / 1000)) };
  }
  bucket.count += 1;
  buckets.set(userId, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetXiaochuanRateLimitForTest(userId: string) {
  buckets.delete(userId);
}
