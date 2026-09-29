import axios from "axios";
import {
  checkAndRecordIncomingActivity,
  clearDedupCache,
  ACTIVITY_ID_TTL_MS,
  RAPID_MESSAGE_TTL_MS,
} from "../src/teams/dedup";
import {
  acquireBotToken,
  sendTypingIndicator,
  clearBotTokenCache,
} from "../src/teams/teams-client";
import { TeamsReplyContext } from "../src/devrev/types";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Inbound Activity Deduplication (dedup.ts)", () => {
  beforeEach(() => {
    clearDedupCache();
    jest.clearAllMocks();
  });

  it("permits initial message activity", () => {
    const result = checkAndRecordIncomingActivity("act-100", "conv-1", "Hello HR");
    expect(result.isDuplicate).toBe(false);
  });

  it("blocks duplicate activity ID from Bot Framework retry", () => {
    const first = checkAndRecordIncomingActivity("act-100", "conv-1", "What is my leave balance?");
    expect(first.isDuplicate).toBe(false);

    // Exact same activity ID re-sent (e.g. Teams Bot Framework retry)
    const retry = checkAndRecordIncomingActivity("act-100", "conv-1", "What is my leave balance?");
    expect(retry.isDuplicate).toBe(true);
    expect(retry.reason).toContain("Duplicate activity ID \"act-100\" detected");
  });

  it("allows different activity IDs from the same user if messages are different", () => {
    const msg1 = checkAndRecordIncomingActivity("act-101", "conv-1", "Hello");
    expect(msg1.isDuplicate).toBe(false);

    const msg2 = checkAndRecordIncomingActivity("act-102", "conv-1", "I need help with payroll");
    expect(msg2.isDuplicate).toBe(false);
  });

  it("blocks rapid double-clicks (Action.Submit) on the same message in the same conversation", () => {
    const click1 = checkAndRecordIncomingActivity("act-201", "conv-1", "Leave Management");
    expect(click1.isDuplicate).toBe(false);

    // Rapid second click (different activity ID, but same conversation and message within 4 seconds)
    const click2 = checkAndRecordIncomingActivity("act-202", "conv-1", "Leave Management");
    expect(click2.isDuplicate).toBe(true);
    expect(click2.reason).toContain("Rapid duplicate message detected in conversation \"conv-1\"");
  });

  it("allows identical messages in different conversations", () => {
    const userA = checkAndRecordIncomingActivity("act-301", "conv-A", "Hi");
    expect(userA.isDuplicate).toBe(false);

    const userB = checkAndRecordIncomingActivity("act-302", "conv-B", "Hi");
    expect(userB.isDuplicate).toBe(false);
  });

  it("handles missing or empty activityId gracefully", () => {
    const result = checkAndRecordIncomingActivity("", "conv-1", "Unique message 123");
    expect(result.isDuplicate).toBe(false);
  });
});

describe("Bot Token Caching and Typing Indicator (teams-client.ts)", () => {
  beforeEach(() => {
    clearBotTokenCache();
    jest.clearAllMocks();
  });

  it("caches Bot Framework OAuth token and reuses it", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: "test-oauth-token-123",
        expires_in: 3600,
      },
    });

    const token1 = await acquireBotToken("app-id-1", "secret-1", "tenant-1");
    expect(token1).toBe("test-oauth-token-123");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    // Second call should return cached token without making another axios.post call
    const token2 = await acquireBotToken("app-id-1", "secret-1", "tenant-1");
    expect(token2).toBe("test-oauth-token-123");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("sends typing indicator activity to Teams", async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200 });

    const replyContext: TeamsReplyContext = {
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      conversationId: "conv-abc",
      tenantId: "tenant-xyz",
      botId: "bot-1",
      botName: "AskHR",
      recipientId: "user-1",
      recipientName: "Jane Doe",
    };

    await sendTypingIndicator("valid-bot-token", replyContext);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://smba.trafficmanager.net/amer/v3/conversations/conv-abc/activities",
      {
        type: "typing",
        from: { id: "bot-1", name: "AskHR" },
        recipient: { id: "user-1", name: "Jane Doe" },
      },
      expect.objectContaining({
        headers: {
          Authorization: "Bearer valid-bot-token",
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("gracefully catches errors when sending typing indicator without throwing", async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error("Network timeout"));

    const replyContext: TeamsReplyContext = {
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      conversationId: "conv-abc",
      tenantId: "tenant-xyz",
      botId: "bot-1",
      botName: "AskHR",
      recipientId: "user-1",
      recipientName: "Jane Doe",
    };

    // Should not throw
    await expect(sendTypingIndicator("valid-bot-token", replyContext)).resolves.not.toThrow();
  });
});
