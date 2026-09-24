/**
 * DevRev Users directory lookup — resolve employee name → email.
 *
 * Uses the DevRev API GET `dev-users.list` to retrieve organization users.
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

    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    const response = await axios.get(url, {
      params: {
        limit: 100,
      },
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    const users: any[] = response.data?.dev_users ?? [];
    console.log(`[users] Retrieved ${users.length} dev-users from directory`);

    const cleanTarget = displayName.trim().toLowerCase();
    const matches = users.filter((u: any) => {
      const fullName = (u.full_name ?? "").trim().toLowerCase();
      const dispName = (u.display_name ?? "").trim().toLowerCase();
      return (
        fullName === cleanTarget ||
        dispName === cleanTarget ||
        (cleanTarget.length > 2 && (fullName.includes(cleanTarget) || cleanTarget.includes(fullName)))
      );
    });

    const matchCount = matches.length;

    if (matchCount === 1) {
      const email = matches[0].email ?? undefined;
      const matchedName = matches[0].full_name || matches[0].display_name;
      console.log(
        `[users] Exactly one match found: "${matchedName}". Email: ${
          email ? "(resolved)" : "(no email on record)"
        }`
      );
      return { email, matchCount };
    }

    if (matchCount === 0) {
      console.log(`[users] No matches found for name="${displayName}"`);
    } else {
      console.log(
        `[users] Multiple matches (${matchCount}) found for name="${displayName}" — leaving email blank`
      );
    }

    return { email: undefined, matchCount };
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
