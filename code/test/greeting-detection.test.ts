import { extractAgentResponse } from "../src/devrev/agent-client";
import { stripLeadingEmoji } from "../src/functions/handle_teams_message";
import { HR_TOPICS } from "../src/teams/teams-client";

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

  it("does not classify as greeting when clientMetadata has isGreeting = 'false' even if message includes intro text", () => {
    const payload = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "message",
          message:
            "Hello! I'm Feuji India Ask HR. Regarding Payroll and P&F: Your salary is credited on the last working day of the month. PF deductions are 12% of basic pay.",
          client_metadata: {
            conversationId: "conv-1",
            serviceUrl: "https://smba.trafficmanager.net/in/",
            isGreeting: "false",
          },
        },
      },
    };

    const result = extractAgentResponse(payload);
    expect(result.isGreeting).toBe(false);
  });

  it("does not classify long answers as greetings even if intro phrase appears", () => {
    const longAnswer =
      "Welcome to Feuji! I'm Feuji India Ask HR — your dedicated internal HR assistant at Feuji. " +
      "Regarding your inquiry about the leave policy, all full-time employees are eligible for 24 days of paid leave per year. " +
      "Leaves can be requested through the Nicoya HRMS portal at least 3 days in advance. Please reach out to your manager for urgent approvals. " +
      "How can I assist you with anything else?";

    const payload = {
      type: "ai_agent_response",
      payload: {
        ai_agent_response: {
          agent_response: "message",
          message: longAnswer,
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

  it("verifies all 18 HR topics have emojis and stripLeadingEmoji cleans them", () => {
    expect(HR_TOPICS).toHaveLength(18);

    for (const topic of HR_TOPICS) {
      // Must contain an emoji at the start
      expect(topic).toMatch(/^[\p{Emoji}\p{Extended_Pictographic}]/u);

      const cleaned = stripLeadingEmoji(topic);
      expect(cleaned.length).toBeGreaterThan(0);
      // Cleaned topic should no longer start with an emoji
      expect(cleaned).not.toMatch(/^[\p{Emoji}\p{Extended_Pictographic}]/u);
    }

    expect(stripLeadingEmoji("🌴 Leave Management")).toBe("Leave Management");
    expect(stripLeadingEmoji("Leave Management")).toBe("Leave Management");
  });
});

