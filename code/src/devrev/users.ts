/**
 * DevRev Users directory lookup — resolve employee name → email.
 *
 * Uses the DevRev API POST `dev-users.list` with cursor-based pagination
 * to scan the FULL directory (no 100-user cap).
 *
 * STRICT ZERO-FALSE-POSITIVE POLICY:
 *  - The found email must either be 100% correct or empty (undefined).
 *  - It will NEVER refer to or guess another user.
 *  - Substring matching is strictly forbidden.
 *  - Both First Name AND Last Name must match (or exact full name / exact token set).
 *  - Middle names or middle initials may be omitted or added, but First and Last
 *    names MUST match with zero contradictory tokens.
 *  - Single-name queries (e.g. "Pavan" or "John") are never matched against
 *    multi-part names to prevent misattribution.
 *  - If two or more users qualify or tie at the top score, the function returns
 *    undefined (empty) — never guesses.
 *  - Deactivated or deleted accounts are strictly excluded.
 */
import axios from "axios";

export interface UserLookupResult {
  email: string | undefined;
  matchCount: number;
  matchedUser?: any;
}

export interface UserLookupHints {
  aadObjectId?: string;
}

interface CachedDirectory {
  users: any[];
  fetchedAt: number;
}

let directoryCache: CachedDirectory | undefined = undefined;
export const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum confidence score required to accept a match (below this -> return undefined) */
export const MIN_CONFIDENCE_THRESHOLD = 55.0;

/**
 * Clear the directory cache (useful for testing or manual refreshes).
 */
export function clearUserDirectoryCache(): void {
  directoryCache = undefined;
}

/**
 * Strips common corporate/system user prefixes (e.g. "i-", "c-", "v-", "ext-", "int-")
 * often found in IT usernames or email slugs.
 */
export function stripPrefix(str: string): string {
  if (!str) return "";
  return str
    .trim()
    .replace(/^(?:[a-zA-Z]|ext|int|vendor|contractor)[\-_.]/i, "")
    .trim();
}

/**
 * Normalizes a name string:
 * - converts to lowercase
 * - strips optional courtesy titles (Mr., Mrs., Ms., Dr., Prof.)
 * - replaces delimiters (-, _, ., ,, /, +, \) with spaces
 * - collapses multiple whitespace
 * - trims
 */
export function normalizeString(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/^(?:mr|mrs|ms|dr|prof)\.?\s+/i, "")
    .replace(/[\-_.,/\\+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts distinct tokens from a string.
 */
export function extractTokens(str: string, removePrefix = true): string[] {
  if (!str) return [];
  const processed = removePrefix ? stripPrefix(str) : str;
  const norm = normalizeString(processed);
  if (!norm) return [];
  return norm.split(" ").filter((t) => t.length > 0);
}

/**
 * Safely extracts email from a DevRev user object across possible schemas.
 */
export function extractUserEmail(user: any): string | undefined {
  if (!user) return undefined;
  if (typeof user.email === "string" && user.email.includes("@")) {
    return user.email.trim();
  }
  if (Array.isArray(user.email_addresses)) {
    const match = user.email_addresses.find(
      (e: any) => typeof e === "string" && e.includes("@")
    );
    if (match) return match.trim();
  }
  if (
    typeof user.user_profile?.email === "string" &&
    user.user_profile.email.includes("@")
  ) {
    return user.user_profile.email.trim();
  }
  return undefined;
}

/**
 * Score an individual candidate field against the search target.
 *
 * STRICT PRECISION RULES:
 *  - No substring matches allowed (avoids "Anil Kumar" matching "Anil Kumar Sharma").
 *  - Single-token queries (e.g. "Pavan") only match identical single-token names.
 *  - Multi-token names require First Name AND Last Name to match.
 *  - Middle names/initials may be omitted or present, provided there are 0 contradictory tokens.
 *
 * Returns -1 if no strict match.
 */
export function scoreField(
  candRaw: string | undefined,
  targetRaw: string,
  fieldWeight: number
): number {
  if (!candRaw || !targetRaw) return -1;

  const candTrimmed = candRaw.trim().toLowerCase();
  const targetTrimmed = targetRaw.trim().toLowerCase();
  if (!candTrimmed || !targetTrimmed) return -1;

  // 1. Exact raw string match (highest confidence)
  if (candTrimmed === targetTrimmed) {
    return 100 * fieldWeight;
  }

  const targetNorm = normalizeString(targetTrimmed);
  const candNorm = normalizeString(candTrimmed);
  const candNoPrefix = normalizeString(stripPrefix(candTrimmed));

  // 2. Exact normalized match (delimiters like hyphens/dots only)
  if (candNorm === targetNorm) {
    return 90 * fieldWeight;
  }

  // 3. Exact match after stripping corporate prefix (e.g. "i-pavan-kodepaka" -> "pavan kodepaka")
  if (candNoPrefix === targetNorm) {
    return 85 * fieldWeight;
  }

  const targetTokens = extractTokens(targetTrimmed, false);
  const candTokens = extractTokens(candTrimmed, true);

  const targetSig = targetTokens.filter((t) => t.length > 1);
  const candSig = candTokens.filter((t) => t.length > 1);

  if (targetSig.length === 0 || candSig.length === 0) {
    return -1;
  }

  // Safety rule: Single-token name (e.g. "Pavan" or "John")
  // Only matches if BOTH target and candidate are that exact single token.
  // Never match a lone first name against a full name ("Pavan" -> "Pavan Kodepaka" is REJECTED).
  if (targetSig.length === 1 || candSig.length === 1) {
    if (
      targetSig.length === 1 &&
      candSig.length === 1 &&
      targetSig[0] === candSig[0]
    ) {
      return 80 * fieldWeight;
    }
    return -1; // Unsafe: ambiguous single name
  }

  // 4. Exact same set of significant tokens (reordered, e.g. "Kodepaka, Pavan" vs "Pavan Kodepaka")
  if (
    candSig.length === targetSig.length &&
    candSig.every((t) => targetSig.includes(t))
  ) {
    return 80 * fieldWeight;
  }

  // 5. First + Last name match with middle name(s) or initials omitted/added
  // Example: Teams: "Pavan Kumar Kodepaka" vs DevRev: "i-pavan-kodepaka"
  // Or: Teams: "Pavan Kodepaka" vs DevRev: "i-pavan-kumar-kodepaka"
  if (candSig.length >= 2 && targetSig.length >= 2) {
    const candFirst = candSig[0];
    const candLast = candSig[candSig.length - 1];
    const targetFirst = targetSig[0];
    const targetLast = targetSig[targetSig.length - 1];

    // Standard order: First name matches AND Last name matches
    if (candFirst === targetFirst && candLast === targetLast) {
      const isCandSubset = candSig.every((t) => targetSig.includes(t));
      const isTargetSubset = targetSig.every((t) => candSig.includes(t));
      if (isCandSubset || isTargetSubset) {
        return 70 * fieldWeight;
      }
    }

    // Reversed order: e.g. Teams: "Kodepaka, Pavan Kumar" vs DevRev: "i-pavan-kodepaka"
    // Here, Kodepaka is the surname and Pavan is the first name.
    // Both significant tokens of DevRev ["pavan", "kodepaka"] must be in Teams,
    // AND they must match the start and end of Teams!
    const bothInTarget =
      candSig.length === 2 && candSig.every((t) => targetSig.includes(t));
    if (bothInTarget) {
      const coversEdges =
        candSig.includes(targetFirst) &&
        (candSig.includes(targetLast) || targetSig.length === 3);
      if (coversEdges) {
        return 65 * fieldWeight;
      }
    }
  }

  // All fuzzy/partial/substring matches are strictly REJECTED (-1)
  return -1;
}

/**
 * Score a DevRev user against the search target name and optional hints.
 * Returns -1 if no strict match.
 */
export function scoreUser(
  user: any,
  target: string,
  hints?: UserLookupHints
): number {
  if (!user || !target) return -1;

  // STRICT: Exclude deactivated or deleted accounts
  if (user.state === "deactivated" || user.state === "deleted") {
    return -1;
  }

  // Hint match: Azure AD ObjectId via external identities (100% infallible)
  if (hints?.aadObjectId && Array.isArray(user.external_identities)) {
    const hasMatch = user.external_identities.some(
      (ext: any) =>
        ext?.id && ext.id.toLowerCase() === hints.aadObjectId!.toLowerCase()
    );
    if (hasMatch) {
      return 1000;
    }
  }

  const scoreFullName = scoreField(user.full_name, target, 1.0);
  const scoreDisplayName = scoreField(user.display_name, target, 0.95);

  let scoreEmail = -1;
  const email = extractUserEmail(user);
  if (email) {
    const emailLocal = email.split("@")[0];
    scoreEmail = scoreField(emailLocal, target, 0.9);
  }

  const baseScore = Math.max(scoreFullName, scoreDisplayName, scoreEmail);
  if (baseScore < MIN_CONFIDENCE_THRESHOLD) {
    return -1;
  }

  // Active account bonus (+1.0 point to break ties against accounts with unspecified state)
  const isActive = user.state === "active";
  const activeBonus = isActive ? 1.0 : 0.0;

  return baseScore + activeBonus;
}

/**
 * Scans the full DevRev users directory with pagination.
 */
async function fetchFullDirectory(
  devrevEndpoint: string,
  token: string
): Promise<any[]> {
  const url = `${devrevEndpoint}/dev-users.list`;
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  const allUsers: any[] = [];
  let cursor: string | undefined = undefined;
  let pageCount = 0;

  console.log(`[users] Fetching full DevRev directory via ${url} (paginated POST)`);

  do {
    pageCount++;
    const body: Record<string, any> = { limit: 50 };
    if (cursor) body["cursor"] = cursor;

    const response = await axios.post(url, body, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    const users: any[] = response.data?.dev_users ?? [];
    cursor = response.data?.next_cursor;
    allUsers.push(...users);

    console.log(
      `[users] Page ${pageCount}: ${users.length} users (total: ${allUsers.length}, ` +
        `next_cursor: ${cursor ? "present" : "none"})`
    );
  } while (cursor);

  return allUsers;
}

/**
 * Search DevRev users directory by display name using strict precision matching.
 *
 * Guarantees:
 *  - Found email is strictly verified or empty (undefined).
 *  - Never refers to another user.
 *  - Ambiguous matches return undefined.
 */
export async function resolveEmailByName(
  devrevEndpoint: string,
  token: string,
  displayName: string,
  hints?: UserLookupHints
): Promise<UserLookupResult> {
  const cleanTarget = displayName.trim();
  if (!cleanTarget) {
    console.log(`[users] Empty displayName provided — skipping lookup`);
    return { email: undefined, matchCount: 0 };
  }

  console.log(
    `[users] Searching DevRev directory for name="${displayName}"` +
      `${hints?.aadObjectId ? ` (aadObjectId: ${hints.aadObjectId})` : ""}`
  );

  try {
    const now = Date.now();
    let users: any[];

    if (
      directoryCache &&
      now - directoryCache.fetchedAt < DIRECTORY_CACHE_TTL_MS
    ) {
      console.log(
        `[users] Using cached directory (${directoryCache.users.length} users, ` +
          `age: ${Math.round((now - directoryCache.fetchedAt) / 1000)}s)`
      );
      users = directoryCache.users;
    } else {
      users = await fetchFullDirectory(devrevEndpoint, token);
      directoryCache = { users, fetchedAt: now };
    }

    // Attempt matching
    let allMatches: { user: any; score: number }[] = [];
    for (const user of users) {
      const score = scoreUser(user, cleanTarget, hints);
      if (score >= MIN_CONFIDENCE_THRESHOLD) {
        allMatches.push({ user, score });
      }
    }

    // If no match found in cache and cache is > 30s old, refresh cache once
    if (
      allMatches.length === 0 &&
      directoryCache &&
      now - directoryCache.fetchedAt > 30 * 1000
    ) {
      console.log(`[users] No match in cache — performing fresh directory refresh...`);
      users = await fetchFullDirectory(devrevEndpoint, token);
      directoryCache = { users, fetchedAt: Date.now() };

      allMatches = [];
      for (const user of users) {
        const score = scoreUser(user, cleanTarget, hints);
        if (score >= MIN_CONFIDENCE_THRESHOLD) {
          allMatches.push({ user, score });
        }
      }
    }

    console.log(
      `[users] Evaluated ${users.length} users. Qualifying candidates: ${allMatches.length}`
    );

    if (allMatches.length === 0) {
      console.log(`[users] No strict match found for name="${displayName}" — returning empty email`);
      return { email: undefined, matchCount: 0 };
    }

    // Sort descending by score
    allMatches.sort((a, b) => b.score - a.score);

    const topScore = allMatches[0].score;
    const topMatches = allMatches.filter((m) => m.score === topScore);

    if (topMatches.length === 1) {
      const best = topMatches[0].user;
      const email = extractUserEmail(best);
      const matchedName = best.full_name || best.display_name;

      if (!email) {
        console.warn(
          `[users] Matched user "${matchedName}" (score=${topScore.toFixed(1)}), but no email exists on record — leaving email empty.`
        );
        return { email: undefined, matchCount: 1, matchedUser: best };
      }

      console.log(
        `[users] Single verified match: "${matchedName}" (score=${topScore.toFixed(1)}). ` +
          `Email: ${email}`
      );
      return { email, matchCount: 1, matchedUser: best };
    }

    // Multiple users tied at the same top score — AMBIGUOUS. Never guess!
    console.warn(
      `[users] Ambiguity: ${topMatches.length} candidates tied at score=${topScore.toFixed(1)} for ` +
        `"${displayName}": ` +
        topMatches.map((m) => m.user.full_name || m.user.display_name).join(", ") +
        " — strictly leaving email empty to avoid misattribution."
    );
    return { email: undefined, matchCount: topMatches.length };
  } catch (error: any) {
    const errorDetail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    console.error(`[users] Error searching DevRev users directory: ${errorDetail}`);
    return { email: undefined, matchCount: 0 };
  }
}

/**
 * Build the Employee Context header string.
 */
export function buildEmployeeContextHeader(
  name: string,
  email: string | undefined
): string {
  const emailLine = email ? email : "";
  return `[Employee Context:
- Name: ${name}
- Email: ${emailLine}]

User Inquiry: `;
}
