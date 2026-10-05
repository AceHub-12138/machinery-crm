type LoginAttempt = {
  count: number;
  firstAttemptAt: number;
  blockedUntil: number;
};

const attempts = new Map<string, LoginAttempt>();

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function now() {
  return Date.now();
}

function cleanupExpiredAttempts(currentTime = now()) {
  for (const [key, attempt] of attempts) {
    const windowExpired = currentTime - attempt.firstAttemptAt > WINDOW_MS;
    const blockExpired = attempt.blockedUntil > 0 && attempt.blockedUntil <= currentTime;

    if (windowExpired && (attempt.blockedUntil === 0 || blockExpired)) {
      attempts.delete(key);
    }
  }
}

export function checkLoginRateLimit(key: string) {
  const currentTime = now();
  cleanupExpiredAttempts(currentTime);

  const attempt = attempts.get(key);
  if (!attempt || attempt.blockedUntil <= currentTime) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((attempt.blockedUntil - currentTime) / 1000),
  };
}

export function recordLoginFailure(key: string) {
  const currentTime = now();
  const existing = attempts.get(key);

  if (!existing || currentTime - existing.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, {
      count: 1,
      firstAttemptAt: currentTime,
      blockedUntil: 0,
    });
    return;
  }

  const count = existing.count + 1;
  attempts.set(key, {
    count,
    firstAttemptAt: existing.firstAttemptAt,
    blockedUntil: count >= MAX_FAILED_ATTEMPTS ? currentTime + BLOCK_MS : existing.blockedUntil,
  });
}

export function resetLoginRateLimit(key: string) {
  attempts.delete(key);
}
