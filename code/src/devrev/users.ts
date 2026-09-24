/**
 * DevRev Users directory lookup — resolve employee name → email.
 *
 * Uses the DevRev API `dev-users.list` to search by display_name.
 * - Exactly one match → return that user's email.
 * - Zero or multiple matches → return undefined (never guess).
 */
import axios from "axios";

export interface UserLookupResult {
  email: string | undefined;
  matchCount: number;
}

/**
 * Search DevRev users directory by display name and return the email
 * if there is exactly one match.
 */
export async function resolveEmailByName(
  devrevEndpoint: string,
  token: string,
  displayName: string
): Promise<UserLookupResult> {
  const url = `${devrevEndpoint}/dev-users.list`;

  try {
    console.log(`[users] Searching DevRev users directory for name="${displayName}"`);

    const response = await axios.post(
      url,
      {
        display_name: [displayName],
      },
      {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );

    const users = response.data?.dev_users ?? [];
    const matchCount = users.length;

    if (matchCount === 1) {
      const email = users[0].email ?? undefined;
      console.log(`[users] Exactly one match found. Email: ${email ? "(resolved)" : "(no email on record)"}`);
      return { email, matchCount };
    }

    if (matchCount === 0) {
      console.log(`[users] No matches found for name="${displayName}"`);
    } else {
      console.log(`[users] Multiple matches (${matchCount}) found for name="${displayName}" — leaving email blank`);
    }

    return { email: undefined, matchCount };
  } catch (error: any) {
    console.error(`[users] Error searching DevRev users directory: ${error.message}`);
    return { email: undefined, matchCount: 0 };
  }
}

/**
 * Build the Employee Context header that the AskHR agent expects.
 */
export function buildEmployeeContextHeader(name: string, email: string | undefined): string {
  return `[Employee Context:\n- Name: ${name}\n- Email: ${email || ""}]\n\nUser Inquiry: `;
}
