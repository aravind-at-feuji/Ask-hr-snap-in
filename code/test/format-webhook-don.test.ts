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
  it("extracts output message and client metadata from legacy format", () => {
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
    expect(result.isFinal).toBe(true);
  });

  it("extracts final message and client_metadata from DevRev ai_agent_response webhook payload", () => {
    const webhookEvent = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "message",
          message: "According to our policy, you have 24 days of annual leave.",
          client_metadata: {
            serviceUrl: "https://smba.trafficmanager.net/in/",
            conversationId: "a:12345",
            recipientId: "user-1",
          },
        },
      },
    };

    const result = extractAgentResponse(webhookEvent);
    expect(result.message).toBe("According to our policy, you have 24 days of annual leave.");
    expect(result.agentResponseStatus).toBe("message");
    expect(result.isFinal).toBe(true);
    expect(result.isGreeting).toBe(false);
    expect(result.clientMetadata["serviceUrl"]).toBe("https://smba.trafficmanager.net/in/");
    expect(result.clientMetadata["conversationId"]).toBe("a:12345");
  });

  it("identifies intermediate / non-final events correctly", () => {
    const intermediateEvent = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "thought",
          client_metadata: {
            conversationId: "a:12345",
          },
        },
      },
    };

    const result = extractAgentResponse(intermediateEvent);
    expect(result.agentResponseStatus).toBe("thought");
    expect(result.message).toBe("");
    expect(result.isFinal).toBe(false);
  });

  it("handles agent error payloads gracefully", () => {
    const errorEvent = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "error",
          error: {
            message: "Knowledge base unreachable",
          },
        },
      },
    };

    const result = extractAgentResponse(errorEvent);
    expect(result.agentResponseStatus).toBe("error");
    expect(result.errorMessage).toBe("Knowledge base unreachable");
    expect(result.isFinal).toBe(false);
  });

  it("handles full DevRev snap-in event wrapper", () => {
    const snapInEvent = {
      context: { secrets: {} },
      input_data: {},
      payload: {
        type: "ai_agent_response",
        payload: {
          ai_agent_response: {
            agent_response: "message",
            message: "Hello! I'm AskHR. How can I help you today?",
            is_greeting: true,
            client_metadata: {
              conversation_id: "conv-999",
            },
          },
        },
      },
    };

    const result = extractAgentResponse(snapInEvent);
    expect(result.message).toBe("Hello! I'm AskHR. How can I help you today?");
    expect(result.isGreeting).toBe(true);
    expect(result.isFinal).toBe(true);
    expect(result.clientMetadata["conversation_id"]).toBe("conv-999");
  });

  it("handles empty payload gracefully", () => {
    const result = extractAgentResponse({});
    expect(result.message).toBe("");
    expect(result.isGreeting).toBe(false);
    expect(result.isFinal).toBe(false);
  });
});
