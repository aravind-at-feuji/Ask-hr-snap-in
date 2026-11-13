/**
 * Deduplication and concurrency manager for Teams messages.
 *
 * Prevents multiple agent invocations and duplicate responses caused by:
 * 1. Microsoft Bot Framework automatic retries (delivering duplicate activity IDs).
 * 2. In-flight messages in the same conversation (answers the first, ignores subsequent).
 * 3. Rapid identical messages sent within a short window.
 * 4. Duplicate agent response callbacks to prevent multiple replies to Teams.
 */

// Time-to-live for activity IDs (5 minutes — Bot Framework retries happen within 15–60s)
export const ACTIVITY_ID_TTL_MS = 5 * 60 * 1000;

// Time-to-live for an in-flight inquiry lock per conversation (20 seconds)
export const IN_FLIGHT_TTL_MS = 20 * 1000;

// Time-to-live for identical message texts in the same conversation (10 seconds)
export const RAPID_MESSAGE_TTL_MS = 10 * 1000;

// Time-to-live for agent response callback deduplication (5 minutes)
export const AGENT_RESPONSE_TTL_MS = 5 * 60 * 1000;

// Maximum cache entries to prevent memory growth in warm serverless instances
const MAX_CACHE_SIZE = 1000;

interface CacheEntry {
  timestamp: number;
}

// Stores seen Teams activity IDs -> timestamp
const activityIdCache = new Map<string, CacheEntry>();

// Stores active conversation IDs currently processing an inquiry -> timestamp
const inFlightConversationCache = new Map<string, CacheEntry>();

// Stores `${conversationId}:${hash(message)}` -> timestamp
const rapidMessageCache = new Map<string, CacheEntry>();

// Stores seen agent response keys -> timestamp
const agentResponseCache = new Map<string, CacheEntry>();

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
export function simpleHash(str: string): string {
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
 * Check whether an incoming Teams activity is a duplicate or sent while an inquiry is in-flight.
 * If it is NOT duplicate/in-flight, it records the activity, conversation lock, and message.
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

    if (activityIdCache.size >= MAX_CACHE_SIZE) {
      cleanupExpiredEntries(activityIdCache, ACTIVITY_ID_TTL_MS, now);
    }
    activityIdCache.set(trimmedId, { timestamp: now });
  }

  // 2. Rapid identical message check (e.g. repeated identical query or double-click)
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

    if (rapidMessageCache.size >= MAX_CACHE_SIZE) {
      cleanupExpiredEntries(rapidMessageCache, RAPID_MESSAGE_TTL_MS, now);
    }
    rapidMessageCache.set(rapidKey, { timestamp: now });
  }

  // 3. In-flight conversation lock check:
  // If an inquiry is currently being processed for this conversation, answer the first one
  // and ignore the second/subsequent message (even if the message text is different).
  if (conversationId && conversationId.trim()) {
    const trimmedConv = conversationId.trim();
    const existingInFlight = inFlightConversationCache.get(trimmedConv);

    if (existingInFlight && now - existingInFlight.timestamp < IN_FLIGHT_TTL_MS) {
      const ageSec = ((now - existingInFlight.timestamp) / 1000).toFixed(1);
      return {
        isDuplicate: true,
        reason: `Conversation "${trimmedConv}" is already processing an active inquiry (in-flight for ${ageSec}s). Ignoring subsequent message to prevent duplicate responses.`,
      };
    }

    // Set in-flight lock for this conversation
    if (inFlightConversationCache.size >= MAX_CACHE_SIZE) {
      cleanupExpiredEntries(inFlightConversationCache, IN_FLIGHT_TTL_MS, now);
    }
    inFlightConversationCache.set(trimmedConv, { timestamp: now });
  }

  return { isDuplicate: false };
}

/**
 * Release the in-flight lock for a conversation when the agent response has been delivered.
 */
export function releaseConversationLock(conversationId?: string): void {
  if (conversationId && conversationId.trim()) {
    inFlightConversationCache.delete(conversationId.trim());
  }
}

/**
 * Deduplicate agent response callback events to ensure Teams never receives duplicate replies
 * for the same agent response execution.
 */
export function checkAndRecordAgentResponse(responseKey: string): boolean {
  if (!responseKey || !responseKey.trim()) return false;
  const key = responseKey.trim();
  const now = Date.now();
  const existing = agentResponseCache.get(key);

  if (existing && now - existing.timestamp < AGENT_RESPONSE_TTL_MS) {
    return true; // Is duplicate
  }

  if (agentResponseCache.size >= MAX_CACHE_SIZE) {
    cleanupExpiredEntries(agentResponseCache, AGENT_RESPONSE_TTL_MS, now);
  }
  agentResponseCache.set(key, { timestamp: now });
  return false;
}

/**
 * Clear deduplication caches (useful for testing).
 */
export function clearDedupCache(): void {
  activityIdCache.clear();
  inFlightConversationCache.clear();
  rapidMessageCache.clear();
  agentResponseCache.clear();
}
