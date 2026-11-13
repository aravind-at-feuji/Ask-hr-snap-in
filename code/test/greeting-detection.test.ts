import { extractAgentResponse } from "../src/devrev/agent-client";

describe("Greeting Detection (agent-client.ts)", () => {
  it("detects greeting from Feuji AskHR welcome message", () => {
    const payload = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "message",
          message:
            "Welcome! I'm Feuji India Ask HR — your dedicated internal HR assistant at Feuji. I'm here to help you with any HR-related queries or requests. How can I assist you today? 😊",
          client_metadata: {
            conversationId: "conv-1",
            serviceUrl: "https://smba.trafficmanager.net/in/",
          },
        },
      },
    };

    const result = extractAgentResponse(payload);
    expect(result.isGreeting).toBe(true);
    expect(result.isFinal).toBe(true);
  });

  it("detects greeting when clientMetadata has isGreeting = 'true' (from inbound user message)", () => {
    const payload = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "message",
          message: "Greetings! How can I support your HR journey?",
          client_metadata: {
            conversationId: "conv-1",
            serviceUrl: "https://smba.trafficmanager.net/in/",
            isGreeting: "true",
          },
        },
      },
    };

    const result = extractAgentResponse(payload);
    expect(result.isGreeting).toBe(true);
  });

  it("does not classify non-greeting inquiries as greetings", () => {
    const payload = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "message",
          message:
            "Employees are entitled to 24 days of paid leave per year. You can apply on the Nicoya portal.",
          client_metadata: {
            conversationId: "conv-1",
            serviceUrl: "https://smba.trafficmanager.net/in/",
          },
        },
      },
    };

    const result = extractAgentResponse(payload);
    expect(result.isGreeting).toBe(false);
  });
});

