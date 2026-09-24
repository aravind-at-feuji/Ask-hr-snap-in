/**
 * Teams Bot Framework client — authenticate and send messages/cards to Teams.
 *
 * Uses the Bot Framework REST API:
 * 1. Acquire OAuth token from login.microsoftonline.com
 * 2. POST activity to the conversation via serviceUrl
 */
import axios from "axios";
import { TeamsReplyContext } from "../devrev/types";

const BOT_FRAMEWORK_TOKEN_URL_TEMPLATE =
  "https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token";
const BOT_FRAMEWORK_SCOPE = "https://api.botframework.com/.default";

/** The 18 HR topics for the greeting Adaptive Card. */
export const HR_TOPICS = [
  "Onboarding & Joining Formalities",
  "BGV",
  "ID & Access Management",
  "Payroll Timelines",
  "Payroll & Statutory",
  "PF / Tax",
  "Leave Management",
  "Attendance Management",
  "Probation",
  "Variable Payout",
  "Exit Management",
  "Compensatory Offs",
  "Health Insurance",
  "HR Policy",
  "Expense Management",
  "L&D",
  "HRMS (Nicoya)",
  "Employee Letters",
];

/**
 * Acquire a Bot Framework OAuth token using client credentials.
 */
export async function acquireBotToken(
  appId: string,
  appPassword: string,
  tenantId: string
): Promise<string> {
  const tokenUrl = tenantId
    ? BOT_FRAMEWORK_TOKEN_URL_TEMPLATE.replace("{tenantId}", tenantId)
    : BOT_FRAMEWORK_TOKEN_URL_TEMPLATE.replace("{tenantId}", "botframework.com");

  console.log("[teams-client] Acquiring Bot Framework OAuth token...");

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", appId);
    params.append("client_secret", appPassword);
    params.append("scope", BOT_FRAMEWORK_SCOPE);

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const token = response.data.access_token;
    console.log("[teams-client] Bot Framework token acquired successfully");
    return token;
  } catch (error: any) {
    console.error(
      `[teams-client] Failed to acquire Bot Framework token: ${error.message}`
    );
    throw new Error("Failed to acquire Bot Framework OAuth token");
  }
}

/**
 * Send a plain text message to a Teams conversation.
 */
export async function sendTextMessage(
  botToken: string,
  replyContext: TeamsReplyContext,
  text: string
): Promise<void> {
  const url = `${replyContext.serviceUrl}v3/conversations/${replyContext.conversationId}/activities`;

  const activity = {
    type: "message",
    from: {
      id: replyContext.botId,
      name: replyContext.botName,
    },
    recipient: {
      id: replyContext.recipientId,
      name: replyContext.recipientName,
    },
    text,
    textFormat: "markdown",
  };

  console.log(
    `[teams-client] Sending text message to conversation ${replyContext.conversationId}`
  );

  try {
    const response = await axios.post(url, activity, {
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
    });
    console.log(`[teams-client] Message sent successfully. Status: ${response.status}`);
  } catch (error: any) {
    const status = error.response?.status ?? "unknown";
    console.error(
      `[teams-client] Failed to send message. Status: ${status}. Error: ${error.message}`
    );
    throw new Error(`Teams message send failed with status ${status}`);
  }
}

/**
 * Send the greeting Adaptive Card with 18-topic dropdown.
 */
export async function sendGreetingCard(
  botToken: string,
  replyContext: TeamsReplyContext,
  greetingText: string
): Promise<void> {
  const url = `${replyContext.serviceUrl}v3/conversations/${replyContext.conversationId}/activities`;

  // Build the Adaptive Card with topic dropdown
  const adaptiveCard = buildGreetingAdaptiveCard(greetingText);

  const activity = {
    type: "message",
    from: {
      id: replyContext.botId,
      name: replyContext.botName,
    },
    recipient: {
      id: replyContext.recipientId,
      name: replyContext.recipientName,
    },
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: adaptiveCard,
      },
    ],
  };

  console.log(
    `[teams-client] Sending greeting Adaptive Card to conversation ${replyContext.conversationId}`
  );

  try {
    const response = await axios.post(url, activity, {
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
    });
    console.log(
      `[teams-client] Greeting card sent successfully. Status: ${response.status}`
    );
  } catch (error: any) {
    const status = error.response?.status ?? "unknown";
    console.error(
      `[teams-client] Failed to send greeting card. Status: ${status}. Error: ${error.message}`
    );
    throw new Error(`Teams greeting card send failed with status ${status}`);
  }
}

/**
 * Build an Adaptive Card JSON with the agent greeting text,
 * an 18-topic compact dropdown (Input.ChoiceSet), and an "Ask HR" submit button.
 */
function buildGreetingAdaptiveCard(greetingText: string): object {
  const choices = HR_TOPICS.map((topic) => ({
    title: topic,
    value: topic,
  }));

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: greetingText,
        wrap: true,
        size: "Medium",
        weight: "Default",
      },
      {
        type: "TextBlock",
        text: "Select a topic to get started:",
        wrap: true,
        size: "Small",
        weight: "Bolder",
        spacing: "Medium",
      },
      {
        type: "Input.ChoiceSet",
        id: "selectedTopic",
        style: "compact",
        isRequired: true,
        placeholder: "Choose a topic...",
        choices,
      },
    ],
    actions: [
      {
        type: "Action.Submit",
        title: "Ask HR",
        data: {
          action: "askhr_topic_submit",
        },
      },
    ],
  };
}
