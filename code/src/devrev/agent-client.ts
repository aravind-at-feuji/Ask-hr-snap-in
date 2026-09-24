/**
 * DevRev Agent client — dispatch messages to the AskHR agent
 * via ai-agents.events.execute-async and extract responses.
 *
 * CRITICAL: This is the ONLY permitted way to invoke the agent.
 * DO NOT use conversations.list or add the agent to a conversation.
 */
import axios from "axios";
import { TeamsReplyContext } from "./types";

/**
 * Dispatch a message to the AskHR agent via execute-async.
 *
 * @param devrevEndpoint  The DevRev API base URL
 * @param token           Service account token
 * @param agentId         The AskHR agent DON (e.g. don:core:dvrv-us-1:devo/118bWKFTfx:ai_agent/61)
 * @param message         The enriched message (with Employee Context header)
 * @param replyContext    Teams reply context to pack into client_metadata
 * @param callbackUrl     The agent-response event source webhook URL for async callback
 */
export async function dispatchToAgent(
  devrevEndpoint: string,
  token: string,
  agentId: string,
  message: string,
  replyContext: TeamsReplyContext,
  callbackUrl: string
): Promise<void> {
  const url = `${devrevEndpoint}/ai-agents.events.execute-async`;

  // Pack Teams reply context into client_metadata as flat string values
  const clientMetadata: Record<string, string> = {
    serviceUrl: replyContext.serviceUrl,
    conversationId: replyContext.conversationId,
    tenantId: replyContext.tenantId,
    botId: replyContext.botId,
    botName: replyContext.botName,
    recipientId: replyContext.recipientId,
    recipientName: replyContext.recipientName,
  };

  if (replyContext.activityId) {
    clientMetadata["activityId"] = replyContext.activityId;
  }

  const payload = {
    agent_id: agentId,
    message,
    client_metadata: clientMetadata,
    callback_url: callbackUrl,
  };

  console.log(`[agent-client] Dispatching to agent ${agentId} via execute-async`);
  console.log(`[agent-client] Message length: ${message.length} chars`);
  console.log(`[agent-client] Callback URL configured: ${callbackUrl ? "yes" : "no"}`);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
    });

    console.log(`[agent-client] Agent dispatch successful. Status: ${response.status}`);
  } catch (error: any) {
    const status = error.response?.status ?? "unknown";
    const body = error.response?.data
      ? JSON.stringify(error.response.data).substring(0, 500)
      : error.message;
    console.error(`[agent-client] Agent dispatch FAILED. Status: ${status}. Detail: ${body}`);
    throw new Error(`Agent dispatch failed with status ${status}`);
  }
}

/**
 * Extract the agent's reply message from the agent-response event payload.
 */
export function extractAgentResponse(payload: any): {
  message: string;
  clientMetadata: Record<string, string>;
  isGreeting: boolean;
} {
  // The agent response comes in via the webhook payload
  const message = payload?.message ?? payload?.data?.message ?? payload?.response?.message ?? "";
  const clientMetadata = payload?.client_metadata ?? payload?.data?.client_metadata ?? {};

  // Detect greeting: check if the agent flagged it or if it matches greeting patterns
  const isGreeting =
    payload?.is_greeting === true ||
    payload?.data?.is_greeting === true ||
    detectGreeting(message);

  console.log(`[agent-client] Extracted agent response: ${message.substring(0, 200)}...`);
  console.log(`[agent-client] Is greeting: ${isGreeting}`);

  return { message, clientMetadata, isGreeting };
}

/**
 * Simple greeting detection heuristic.
 * The agent's first response to a new user is typically a greeting.
 */
function detectGreeting(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  const greetingPatterns = [
    "welcome to askhr",
    "hello! i'm askhr",
    "hi there! i'm askhr",
    "how can i help you today",
    "what can i assist you with",
    "i'm here to help with your hr",
    "welcome! i can help you with",
  ];
  return greetingPatterns.some((pattern) => lower.includes(pattern));
}
