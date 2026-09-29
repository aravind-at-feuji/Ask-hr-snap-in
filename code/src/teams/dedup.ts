/**
 * Deduplication manager for inbound Teams messages.
 *
 * Prevents multiple agent invocations and duplicate responses caused by:
 * 1. Microsoft Bot Framework automatic retries (delivering duplicate activity IDs).
 * 2. Rapid double-submits / double-clicks on Action.Submit buttons in Teams.
 */

// Time-to-live for activity IDs (5 minutes — Bot Framework retries happen within 15–60s)
export const ACTIVITY_ID_TTL_MS = 5 * 60 * 1000;

// Time-to-live for identical message texts in the same conversation (4 seconds — protects against double-clicks)
export const RAPID_MESSAGE_TTL_MS = 4 * 1000;

// Maximum cache entries to prevent memory growth in warm serverless instances
const MAX_CACHE_SIZE = 1000;

interface CacheEntry {
  timestamp: number;
}

// Stores seen Teams activity IDs -> timestamp
const activityIdCache = new Map<string, CacheEntry>();

// Stores `${conversationId}:${hash(message)}` -> timestamp
const rapidMessageCache = new Map<string, CacheEntry>();

/**
 * Periodically purge expired entries from the cache.
 */
function cleanupExpiredEntries(cache: Map<string, CacheEntry>, ttlMs: number, now: number): void {
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > ttlMs) {
      cache.delete(key);
    }
  }
}

/**
 * Basic hash function for message strings to keep memory footprint minimal.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}

export interface DedupCheckResult {
  isDuplicate: boolean;
  reason?: string;
}

/**
 * Check whether an incoming Teams activity is a duplicate.
 * If it is NOT a duplicate, it automatically records the activity and message to prevent future duplicates.
 *
 * @param activityId      The unique Teams activity ID (from `teamsActivity.id`)
 * @param conversationId  The Teams conversation ID
 * @param messageText     The user query or topic text
 */
export function checkAndRecordIncomingActivity(
  activityId?: string,
  conversationId?: string,
  messageText?: string
): DedupCheckResult {
  const now = Date.now();

  // 1. Check activity ID deduplication (exact Bot Framework delivery retry)
  if (activityId && activityId.trim()) {
    const trimmedId = activityId.trim();
    const existing = activityIdCache.get(trimmedId);

    if (existing && now - existing.timestamp < ACTIVITY_ID_TTL_MS) {
      const ageSec = ((now - existing.timestamp) / 1000).toFixed(1);
      return {
        isDuplicate: true,
        reason: `Duplicate activity ID "${trimmedId}" detected (received ${ageSec}s ago)`,
      };
    }

    // Enforce size limit before adding
    if (activityIdCache.size >= MAX_CACHE_SIZE) {
      cleanupExpiredEntries(activityIdCache, ACTIVITY_ID_TTL_MS, now);
    }
    activityIdCache.set(trimmedId, { timestamp: now });
  }

  // 2. Check rapid double-submit / double-click deduplication
  if (conversationId && conversationId.trim() && messageText && messageText.trim()) {
    const trimmedConv = conversationId.trim();
    const hash = simpleHash(messageText.trim().toLowerCase());
    const rapidKey = `${trimmedConv}:${hash}`;

    const existingMsg = rapidMessageCache.get(rapidKey);
    if (existingMsg && now - existingMsg.timestamp < RAPID_MESSAGE_TTL_MS) {
      const ageMs = now - existingMsg.timestamp;
      return {
        isDuplicate: true,
        reason: `Rapid duplicate message detected in conversation "${trimmedConv}" within ${ageMs}ms window`,
      };
    }

    // Enforce size limit before adding
    if (rapidMessageCache.size >= MAX_CACHE_SIZE) {
      cleanupExpiredEntries(rapidMessageCache, RAPID_MESSAGE_TTL_MS, now);
    }
    rapidMessageCache.set(rapidKey, { timestamp: now });
  }

  return { isDuplicate: false };
}

/**
 * Clear deduplication caches (useful for testing).
 */
export function clearDedupCache(): void {
  activityIdCache.clear();
  rapidMessageCache.clear();
}
