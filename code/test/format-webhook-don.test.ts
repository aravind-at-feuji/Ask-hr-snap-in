import {
  formatWebhookDon,
  configureCallbackTarget,
  extractAgentResponse,
} from "../src/devrev/agent-client";

describe("formatWebhookDon", () => {
  const TEST_UUID = "d523eee8-49d1-4743-a293-e9ac673c5263";

  it("keeps an existing webhook DON unchanged", () => {
    const input = `don:integration:dvrv-us-1:devo/118bWKFTfx:webhook/${TEST_UUID}`;
    expect(formatWebhookDon(input)).toBe(input);
  });

  it("formats bare ID if devOrgId is provided", () => {
    const expected = `don:integration:dvrv-us-1:devo/myorg:webhook/${TEST_UUID}`;
    expect(formatWebhookDon(TEST_UUID, "myorg")).toBe(expected);
  });

  it("returns empty string if input is empty", () => {
    expect(formatWebhookDon("")).toBe("");
  });
});

describe("configureCallbackTarget", () => {
  const TEST_WEBHOOK =
    "don:integration:dvrv-us-1:devo/118bWKFTfx:webhook/vb-FYlRa";
  const TEST_BARE_ID = "vb-FYlRa";

  it("configures webhook_target when target is a webhook DON", () => {
    const payload: any = {};
    configureCallbackTarget(payload, TEST_WEBHOOK);
    expect(payload.target).toBe("webhook_target");
    expect(payload.webhook_target).toEqual({
      webhook: TEST_WEBHOOK,
    });
    expect(payload.event_source_target).toBeUndefined();
  });

  it("configures webhook_target when target is a bare webhook ID", () => {
    const payload: any = {};
    configureCallbackTarget(payload, TEST_BARE_ID, "118bWKFTfx");
    expect(payload.target).toBe("webhook_target");
    expect(payload.webhook_target).toEqual({
      webhook: TEST_WEBHOOK,
    });
    expect(payload.event_source_target).toBeUndefined();
  });

  it("does nothing if target is empty", () => {
    const payload: any = {};
    configureCallbackTarget(payload, "");
    expect(payload.target).toBeUndefined();
  });
});

describe("extractAgentResponse", () => {
  it("extracts output message and client metadata", () => {
    const payload = {
      event: {
        output_message: {
          message: "Welcome to AskHR! How can I help you?",
        },
      },
      client_metadata: {
        conversationId: "test-conv-123",
      },
    };

    const result = extractAgentResponse(payload);
    expect(result.message).toBe("Welcome to AskHR! How can I help you?");
    expect(result.clientMetadata["conversationId"]).toBe("test-conv-123");
    expect(result.isGreeting).toBe(true);
  });

  it("handles empty payload gracefully", () => {
    const result = extractAgentResponse({});
    expect(result.message).toBe("");
    expect(result.isGreeting).toBe(false);
  });
});
