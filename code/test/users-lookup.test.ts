import axios from "axios";
import {
  stripPrefix,
  normalizeString,
  extractTokens,
  extractUserEmail,
  scoreField,
  scoreUser,
  resolveEmailByName,
  clearUserDirectoryCache,
  buildEmployeeContextHeader,
} from "../src/devrev/users";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("User Resolution & Strict Precision (users.ts)", () => {
  beforeEach(() => {
    clearUserDirectoryCache();
    jest.clearAllMocks();
  });

  describe("stripPrefix", () => {
    it("strips single-letter IT prefixes with hyphens, dots, and underscores", () => {
      expect(stripPrefix("i-pavan-kodepaka")).toBe("pavan-kodepaka");
      expect(stripPrefix("i.aravind.induri")).toBe("aravind.induri");
      expect(stripPrefix("i_pavan_kodepaka")).toBe("pavan_kodepaka");
      expect(stripPrefix("c-john-doe")).toBe("john-doe");
      expect(stripPrefix("v-jane-smith")).toBe("jane-smith");
    });

    it("strips common system prefixes like ext-, int-, vendor-", () => {
      expect(stripPrefix("ext-contractor-alex")).toBe("contractor-alex");
      expect(stripPrefix("vendor-support")).toBe("support");
    });

    it("preserves standard names without prefix", () => {
      expect(stripPrefix("Pavan Kumar Kodepaka")).toBe("Pavan Kumar Kodepaka");
      expect(stripPrefix("Aravind Induri")).toBe("Aravind Induri");
      expect(stripPrefix("")).toBe("");
    });
  });

  describe("normalizeString & extractTokens", () => {
    it("normalizes delimiters and whitespace", () => {
      expect(normalizeString("Pavan Kumar Kodepaka")).toBe("pavan kumar kodepaka");
      expect(normalizeString("i-pavan-kodepaka")).toBe("i pavan kodepaka");
      expect(normalizeString("Dr. Pavan Kodepaka")).toBe("pavan kodepaka");
    });

    it("extracts tokens with and without prefix stripping", () => {
      expect(extractTokens("Pavan Kumar Kodepaka", true)).toEqual([
        "pavan",
        "kumar",
        "kodepaka",
      ]);
      expect(extractTokens("i-pavan-kodepaka", true)).toEqual([
        "pavan",
        "kodepaka",
      ]);
      expect(extractTokens("i-pavan-kodepaka", false)).toEqual([
        "i",
        "pavan",
        "kodepaka",
      ]);
    });
  });

  describe("extractUserEmail", () => {
    it("extracts primary email field", () => {
      expect(
        extractUserEmail({ email: "pavan.kodepaka@feuji.com" })
      ).toBe("pavan.kodepaka@feuji.com");
    });

    it("extracts from email_addresses array if email is not set", () => {
      expect(
        extractUserEmail({ email_addresses: ["backup@feuji.com"] })
      ).toBe("backup@feuji.com");
    });

    it("extracts from user_profile.email", () => {
      expect(
        extractUserEmail({ user_profile: { email: "profile@feuji.com" } })
      ).toBe("profile@feuji.com");
    });

    it("returns undefined when no valid email is present", () => {
      expect(extractUserEmail({})).toBeUndefined();
      expect(extractUserEmail({ email: "invalid-email" })).toBeUndefined();
    });
  });

  describe("Strict Zero-False-Positive Rejection Rules", () => {
    it("NEVER matches when last names conflict (Pavan Sharma vs i-pavan-kodepaka)", () => {
      const user = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      expect(scoreUser(user, "Pavan Sharma")).toBe(-1);
    });

    it("NEVER matches when first names conflict (Kiran Kodepaka vs i-pavan-kodepaka)", () => {
      const user = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      expect(scoreUser(user, "Kiran Kodepaka")).toBe(-1);
    });

    it("NEVER matches partial full names with different surnames (Pavan Kumar vs i-pavan-kumar-kodepaka)", () => {
      const user = {
        display_name: "i-pavan-kumar-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      expect(scoreUser(user, "Pavan Kumar")).toBe(-1);
    });

    it("NEVER matches single-token mononyms to full names (Pavan vs i-pavan-kodepaka)", () => {
      const user = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      expect(scoreUser(user, "Pavan")).toBe(-1);
    });

    it("NEVER matches by arbitrary substring (Anil Kumar vs i-anil-kumar-sharma)", () => {
      const user = {
        display_name: "i-anil-kumar-sharma",
        email: "anil.sharma@feuji.com",
        state: "active",
      };
      expect(scoreUser(user, "Anil Kumar")).toBe(-1);
    });

    it("STRICTLY excludes deactivated or deleted accounts", () => {
      const deactivated = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "deactivated",
      };
      const deleted = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "deleted",
      };
      expect(scoreUser(deactivated, "Pavan Kumar Kodepaka")).toBe(-1);
      expect(scoreUser(deleted, "Pavan Kumar Kodepaka")).toBe(-1);
    });
  });

  describe("Valid Match Scenarios", () => {
    it("matches exact full_name with highest score", () => {
      const user = {
        full_name: "Pavan Kumar Kodepaka",
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      const score = scoreUser(user, "Pavan Kumar Kodepaka");
      expect(score).toBeGreaterThan(90);
    });

    it("matches prefix-stripped display_name (e.g. 'Aravind Induri' -> 'i-aravind-induri')", () => {
      const user = {
        display_name: "i-aravind-induri",
        email: "i-aravind.induri@feuji.com",
        state: "active",
      };
      const score = scoreUser(user, "Aravind Induri");
      expect(score).toBeGreaterThan(80);
    });

    it("matches middle name omitted in DevRev (Teams: 'Pavan Kumar Kodepaka' -> DevRev: 'i-pavan-kodepaka')", () => {
      const pavanKodepaka = {
        id: "user-1",
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };

      const score = scoreUser(pavanKodepaka, "Pavan Kumar Kodepaka");
      expect(score).toBeGreaterThan(65);
    });

    it("matches reverse order names (e.g. 'Kodepaka, Pavan Kumar' -> 'i-pavan-kodepaka')", () => {
      const user = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      const score = scoreUser(user, "Kodepaka, Pavan Kumar");
      expect(score).toBeGreaterThan(60);
    });

    it("matches when target has middle initial (e.g. 'Pavan K. Kodepaka' -> 'i-pavan-kodepaka')", () => {
      const user = {
        display_name: "i-pavan-kodepaka",
        email: "pavan.kodepaka@feuji.com",
        state: "active",
      };
      const score = scoreUser(user, "Pavan K. Kodepaka");
      expect(score).toBeGreaterThan(70);
    });

    it("matches external identity hint (aadObjectId) with highest priority", () => {
      const user = {
        display_name: "unknown-slug-123",
        external_identities: [{ id: "aad-object-id-999", issuer: "azure_ad" }],
        email: "aad.match@feuji.com",
        state: "active",
      };
      const score = scoreUser(user, "Random Display Name", {
        aadObjectId: "aad-object-id-999",
      });
      expect(score).toBe(1000);
    });
  });

  describe("resolveEmailByName end-to-end with DevRev API mock", () => {
    it("successfully resolves 'Pavan Kumar Kodepaka' to DevRev user 'i-pavan-kodepaka' email", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            {
              id: "don:identity:dvrv-us-1:devo/1:dev_user/1",
              display_name: "i-aravind-induri",
              email: "i-aravind.induri@feuji.com",
              state: "active",
            },
            {
              id: "don:identity:dvrv-us-1:devo/1:dev_user/2",
              display_name: "i-pavan-kodepaka",
              full_name: "i-pavan-kodepaka",
              email: "i-pavan.kodepaka@feuji.com",
              state: "active",
            },
            {
              id: "don:identity:dvrv-us-1:devo/1:dev_user/3",
              display_name: "i-kiran-kumar",
              email: "kiran.kumar@feuji.com",
              state: "active",
            },
          ],
        },
      });

      const result = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Pavan Kumar Kodepaka"
      );

      expect(result.email).toBe("i-pavan.kodepaka@feuji.com");
      expect(result.matchCount).toBe(1);
      expect(result.matchedUser?.display_name).toBe("i-pavan-kodepaka");
    });

    it("strictly leaves email undefined if the user is not found (never refers to another user)", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            {
              display_name: "i-aravind-induri",
              email: "i-aravind.induri@feuji.com",
              state: "active",
            },
            {
              display_name: "i-kiran-kumar",
              email: "kiran.kumar@feuji.com",
              state: "active",
            },
          ],
        },
      });

      const result = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Pavan Kumar Kodepaka"
      );

      expect(result.email).toBeUndefined();
      expect(result.matchCount).toBe(0);
    });

    it("strictly leaves email undefined when two distinct users tie at top score", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            {
              display_name: "John Doe",
              email: "johndoe1@feuji.com",
              state: "active",
            },
            {
              display_name: "John Doe",
              email: "johndoe2@feuji.com",
              state: "active",
            },
          ],
        },
      });

      const result = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "John Doe"
      );

      expect(result.email).toBeUndefined();
      expect(result.matchCount).toBe(2);
    });

    it("strictly leaves email undefined when matched user has no email on record", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            {
              display_name: "i-pavan-kodepaka",
              state: "active",
              // email is missing
            },
          ],
        },
      });

      const result = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Pavan Kumar Kodepaka"
      );

      expect(result.email).toBeUndefined();
      expect(result.matchCount).toBe(1);
    });

    it("handles multi-page cursor pagination across the full directory", async () => {
      // Page 1
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            { display_name: "i-user-one", email: "user1@feuji.com", state: "active" },
          ],
          next_cursor: "page-2-cursor",
        },
      });
      // Page 2
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            {
              display_name: "i-pavan-kodepaka",
              email: "pavan.kodepaka@feuji.com",
              state: "active",
            },
          ],
          next_cursor: undefined,
        },
      });

      const result = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Pavan Kumar Kodepaka"
      );

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(result.email).toBe("pavan.kodepaka@feuji.com");
      expect(result.matchCount).toBe(1);
    });

    it("caches directory and reuses on subsequent lookups", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          dev_users: [
            {
              display_name: "i-pavan-kodepaka",
              email: "pavan.kodepaka@feuji.com",
              state: "active",
            },
            {
              display_name: "i-aravind-induri",
              email: "i-aravind.induri@feuji.com",
              state: "active",
            },
          ],
        },
      });

      // First lookup - triggers API fetch
      const result1 = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Pavan Kumar Kodepaka"
      );
      expect(result1.email).toBe("pavan.kodepaka@feuji.com");
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      // Second lookup for a different employee - served from cache (0 new HTTP calls)
      const result2 = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Aravind Induri"
      );
      expect(result2.email).toBe("i-aravind.induri@feuji.com");
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it("handles API error gracefully without throwing", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await resolveEmailByName(
        "https://api.devrev.ai",
        "mock-token",
        "Pavan Kumar Kodepaka"
      );

      expect(result.email).toBeUndefined();
      expect(result.matchCount).toBe(0);
    });
  });

  describe("buildEmployeeContextHeader", () => {
    it("formats context header with resolved email", () => {
      const header = buildEmployeeContextHeader(
        "Pavan Kumar Kodepaka",
        "i-pavan.kodepaka@feuji.com"
      );
      expect(header).toContain("Name: Pavan Kumar Kodepaka");
      expect(header).toContain("Email: i-pavan.kodepaka@feuji.com");
      expect(header).toContain("User Inquiry: ");
    });

    it("formats context header when email is undefined", () => {
      const header = buildEmployeeContextHeader("Unknown User", undefined);
      expect(header).toContain("Name: Unknown User");
      expect(header).toContain("Email: ]");
    });
  });
});
