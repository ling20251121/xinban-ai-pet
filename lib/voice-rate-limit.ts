import { ApiError } from "@/lib/http";

const TOKENS_PER_MINUTE = 6;
const TOKEN_REFILL_PER_MS = TOKENS_PER_MINUTE / 60_000;
const MAX_CONCURRENT_PER_ISOLATE = 4;
const CLIENT_IDLE_TTL_MS = 5 * 60_000;
const REPLAY_TTL_MS = 2 * 60_000;
const MAX_TRACKED_CLIENTS = 2_048;
const MAX_TRACKED_REPLAYS = 4_096;

interface Bucket {
  lastRefillAt: number;
  lastSeenAt: number;
  tokens: number;
}

export interface VoiceRequestLease {
  claimFingerprint(fingerprint: string): void;
  release(): void;
}

const processSalt = crypto.randomUUID();
const buckets = new Map<string, Bucket>();
const recentFingerprints = new Map<string, number>();
let activeRequests = 0;

function fastHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}`;
}

function clientAddress(request: Request): string {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareAddress) return cloudflareAddress.slice(0, 128);

  // Local development and non-Cloudflare test runners do not set the header.
  // This fallback is not a trusted production identity; platform-level rate
  // limiting remains required before a public trial.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return (forwarded || "unknown-client").slice(0, 128);
}

function cleanExpired(now: number): void {
  if (buckets.size > MAX_TRACKED_CLIENTS) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastSeenAt > CLIENT_IDLE_TTL_MS) buckets.delete(key);
    }
    while (buckets.size > MAX_TRACKED_CLIENTS) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      buckets.delete(oldest);
    }
  }

  if (recentFingerprints.size > MAX_TRACKED_REPLAYS) {
    for (const [key, expiresAt] of recentFingerprints) {
      if (expiresAt <= now) recentFingerprints.delete(key);
    }
    while (recentFingerprints.size > MAX_TRACKED_REPLAYS) {
      const oldest = recentFingerprints.keys().next().value as string | undefined;
      if (!oldest) break;
      recentFingerprints.delete(oldest);
    }
  }
}

export function reserveVoiceRequest(request: Request): VoiceRequestLease {
  const now = Date.now();
  cleanExpired(now);
  const clientKey = fastHash(`${processSalt}:${clientAddress(request)}`);
  const bucket = buckets.get(clientKey) ?? {
    lastRefillAt: now,
    lastSeenAt: now,
    tokens: TOKENS_PER_MINUTE,
  };
  const elapsed = Math.max(0, now - bucket.lastRefillAt);
  bucket.tokens = Math.min(
    TOKENS_PER_MINUTE,
    bucket.tokens + elapsed * TOKEN_REFILL_PER_MS,
  );
  bucket.lastRefillAt = now;
  bucket.lastSeenAt = now;
  buckets.delete(clientKey);
  buckets.set(clientKey, bucket);

  if (bucket.tokens < 1) {
    throw new ApiError(429, "语音尝试太频繁了，请一分钟后再试或先使用文字输入。");
  }
  bucket.tokens -= 1;

  if (activeRequests >= MAX_CONCURRENT_PER_ISOLATE) {
    throw new ApiError(429, "当前使用语音的人较多，请稍后再试或先使用文字输入。");
  }
  activeRequests += 1;
  let released = false;

  return {
    claimFingerprint(fingerprint: string) {
      const replayKey = `${clientKey}:${fingerprint}`;
      const claimTime = Date.now();
      const existingExpiry = recentFingerprints.get(replayKey);
      if (existingExpiry && existingExpiry > claimTime) {
        throw new ApiError(409, "这段录音刚刚已经提交，请等待结果或重新录制。");
      }
      recentFingerprints.delete(replayKey);
      recentFingerprints.set(replayKey, claimTime + REPLAY_TTL_MS);
    },
    release() {
      if (released) return;
      released = true;
      activeRequests = Math.max(0, activeRequests - 1);
    },
  };
}
