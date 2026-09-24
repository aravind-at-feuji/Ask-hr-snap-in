/**
 * DevRev Users directory lookup — resolve employee name → email.
 *
 * Uses the DevRev API POST `dev-users.list` with cursor-based pagination
 * to scan the FULL directory (no 100-user cap).
 *
 * Resolution strategy (priority order):
 *  1. Exact case-insensitive full_name match  (score 2)
 *  2. Exact case-insensitive display_name match (score 1)
 *  3. Partial substring match                 (score 0)
 *
 * Picks the single user with the highest score.
 * If zero or multiple users share the top score → return undefined (never guess).
 */
import axios from "axios";

export interface UserLookupResult {
  email: string | undefined;
  matchCount: number;
}

/**
 * Score a user against the normalised target name.
 * Returns -1 if no match at all.
 */
function scoreMatch(user: any, target: string): number {
  const fullName = (user.full_name ?? "").trim().toLowerCase();
  const dispName = (user.display_name ?? "").trim().toLowerCase();

  if (fullName === target) return 2;
  if (dispName === target) return 1;

  if (
    target.length > 2 &&
    (fullName.includes(target) ||
      dispName.includes(target) ||
      target.includes(fullName) ||
      target.includes(dispName))
  ) {
    return 0;
  }

  return -1;
}

/**
 * Search DevRev users directory by display name using paginated POST requests.
 * Scans the entire directory — not capped at 100 users.
 */
export async function resolveEmailByName(
  devrevEndpoint: string,
  token: string,
  displayName: string
): Promise<UserLookupResult> {
  const url = `${devrevEndpoint}/dev-users.list`;
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  const cleanTarget = displayName.trim().toLowerCase();

  console.log(`[users] Searching full DevRev directory for name="${displayName}" (paginated POST)`);

  const allMatches: { user: any; score: number }[] = [];
  let cursor: string | undefined = undefined;
  let pageCount = 0;
  let totalScanned = 0;

  try {
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
      totalScanned += users.length;

      console.log(
        `[users] Page ${pageCount}: ${users.length} users (total: ${totalScanned}, ` +
          `next_cursor: ${cursor ? "present" : "none"})`
      );

      for (const user of users) {
        const score = scoreMatch(user, cleanTarget);
        if (score >= 0) {
          allMatches.push({ user, score });
        }
      }
    } while (cursor);

    console.log(
      `[users] Scan complete: ${totalScanned} users across ${pageCount} page(s). ` +
        `Raw matches: ${allMatches.length}`
    );

    if (allMatches.length === 0) {
      console.log(`[users] No match found for name="${displayName}"`);
      return { email: undefined, matchCount: 0 };
    }

    // Sort descending by score; prefer exact full_name matches
    allMatches.sort((a, b) => b.score - a.score);

    const topScore = allMatches[0].score;
    const topMatches = allMatches.filter((m) => m.score === topScore);

    if (topMatches.length === 1) {
      const best = topMatches[0].user;
      const email = best.email ?? undefined;
      const matchedName = best.full_name || best.display_name;
      console.log(
        `[users] Single best match: "${matchedName}" (score=${topScore}). ` +
          `Email: ${email ? "(resolved)" : "(no email on record)"}`
      );
      return { email, matchCount: 1 };
    }

    // Multiple users tied at the same top score — ambiguous
    console.log(
      `[users] ${topMatches.length} matches tied at score=${topScore} for ` +
        `"${displayName}": ` +
        topMatches.map((m) => m.user.full_name || m.user.display_name).join(", ") +
        " — leaving email blank."
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
