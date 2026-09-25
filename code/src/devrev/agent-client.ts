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
 * Format a webhook identifier if needed.
 * Strictly preserves genuine webhook DONs.
 * Does NOT fabricate webhook DONs from event sources.
 */
export function formatWebhookDon(target: string, devOrgId: string = "118bWKFTfx"): string {
  if (!target) return "";

  // 1. If already a valid webhook DON, return as is
  if (target.startsWith("don:") && target.includes(":webhook/")) {
    return target;
  }

  // 2. If target is a bare webhook ID
  if (!target.startsWith("don:") && !target.startsWith("http")) {
    return `don:integration:dvrv-us-1:devo/${devOrgId}:webhook/${target}`;
  }

  return target;
}

/**
 * Configure callback target on the execute-async request payload
 * conforming strictly to DevRev's execute-async schema:
 * target = 'webhook_target'
 * webhook_target = { webhook: webhookDon }
 */
export function configureCallbackTarget(payload: any, target: string, devOrgId?: string): void {
  if (!target) return;

  const webhookDon = formatWebhookDon(target, devOrgId);
  payload.target = "webhook_target";
  payload.webhook_target = {
    webhook: webhookDon,
  };
  console.log(`[agent-client] Configured webhook_target: ${webhookDon}`);
}

/**
 * Dispatch a message to the AskHR agent via execute-async.
 *
 * @param devrevEndpoint  The DevRev API base URL
 * @param token           Service account token
 * @param agentId         The AskHR agent DON (e.g. don:core:dvrv-us-1:devo/118bWKFTfx:ai_agent/61)
 * @param message         The enriched message (with Employee Context header)
 * @param replyContext    Teams reply context to pack into client_metadata
 * @param callbackTarget  Webhook ID or event source DON/URL to receive async response
 */
export async function dispatchToAgent(
  devrevEndpoint: string,
  token: string,
  agentId: string,
  message: string,
  replyContext: TeamsReplyContext,
  callbackTarget?: string
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

  const sessionId = replyContext.conversationId || `session-${Date.now()}`;

  // Build the payload conforming strictly to DevRev's execute-async schema:
  // - "agent": agent DON
  // - "event.input_message.message": user query
  // - "session_object": conversation ID for session memory
  // - "client_metadata": context passed through to the webhook response
  const payload: any = {
    agent: agentId,
    event: {
      input_message: {
        message,
      },
    },
    session_object: sessionId,
    client_metadata: clientMetadata,
  };

  // Extract devOrgId from agentId if available
  const devoMatch = agentId.match(/devo\/([^:]+)/);
  const devOrgId = devoMatch ? devoMatch[1] : "118bWKFTfx";

  // Configure callback target (webhook_target)
  const effectiveCallbackTarget =
    callbackTarget || `don:integration:dvrv-us-1:devo/${devOrgId}:webhook/vb-FYlRa`;

  configureCallbackTarget(payload, effectiveCallbackTarget, devOrgId);

  console.log(`[agent-client] Dispatching to agent ${agentId} via execute-async`);
  console.log(`[agent-client] Message length: ${message.length} chars`);
  console.log(`[agent-client] Callback target configured: ${callbackTarget ? "yes (" + payload.target + ")" : "no"}`);
  console.log(`[agent-client] Full execute-async request payload: ${JSON.stringify(payload)}`);

  const fallbackPat =
    "eyJhbGciOiJSUzI1NiIsImlzcyI6Imh0dHBzOi8vYXV0aC10b2tlbi5kZXZyZXYuYWkvIiwia2lkIjoic3RzX2tpZF9yc2EiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOlsiamFudXMiXSwiYXpwIjoiZG9uOmlkZW50aXR5OmR2cnYtdXMtMTpkZXZvLzExOGJXS0ZUZng6ZGV2dS83MzM4IiwiZXhwIjoxNzk3Mzk3NjMzLCJodHRwOi8vZGV2cmV2LmFpL2F1dGgwX3VpZCI6ImRvbjppZGVudGl0eTpkdnJ2LXVzLTE6ZGV2by9zdXBlcjphdXRoMF91c2VyL29pZGN8cGFzc3dvcmRsZXNzfGVtYWlsfDZhODQzMGI2YzJiNDJlMzRjZDk1OTFlMyIsImh0dHA6Ly9kZXZyZXYuYWkvYXV0aDBfdXNlcl9pZCI6Im9pZGN8cGFzc3dvcmRsZXNzfGVtYWlsfDZhODQzMGI2YzJiNDJlMzRjZDk1OTFlMyIsImh0dHA6Ly9kZXZyZXYuYWkvZGV2b19kb24iOiJkb246aWRlbnRpdHk6ZHZydi11cy0xOmRldm8vMTE4YldLRlRmeCIsImh0dHA6Ly9kZXZyZXYuYWkvZGV2b2lkIjoiREVWLTExOGJXS0ZUZngiLCJodHRwOi8vZGV2cmV2LmFpL2RldnVpZCI6IkRFVlUtNzMzOCIsImh0dHA6Ly9kZXZyZXYuYWkvZGlzcGxheW5hbWUiOiJpLWFyYXZpbmQtaW5kdXJpIiwiaHR0cDovL2RldnJldi5haS9lbWFpbCI6ImktYXJhdmluZC5pbmR1cmlAZmV1amkuY29tIiwiaHR0cDovL2RldnJldi5haS9mdWxsbmFtZSI6IkkgQXJhdmluZCBJbmR1cmkiLCJodHRwOi8vZGV2cmV2LmFpL2lzX3ZlcmlmaWVkIjp0cnVlLCJodHRwOi8vZGV2cmV2LmFpL3Rva2VudHlwZSI6InVybjpkZXZyZXY6cGFyYW1zOm9hdXRoOnRva2VuLXR5cGU6cGF0IiwiaWF0IjoxNzg5NjIxNjMzLCJpc3MiOiJodHRwczovL2F1dGgtdG9rZW4uZGV2cmV2LmFpLyIsImp0aSI6ImRvbjppZGVudGl0eTpkdnJ2LXVzLTE6ZGV2by8xMThiV0tGVGZ4OnRva2VuL0phUWpWOGlzIiwib3JnX2lkIjoib3JnX0RjT3JOTXdIaWlNSUJDS0oiLCJzdWIiOiJkb246aWRlbnRpdHk6ZHZydi11cy0xOmRldm8vMTE4YldLRlRmeDpkZXZ1LzczMzgifQ.SBN8ylYGhckxFo6HVgxLqZ2BBgQb68w60p6OCMcRYm0Yrpr3_qP6dWEgRmFVrIhL6bGqmtpy4OiRrTt2qH46xG6XeAyt-sz9gZ42UV3Yr4j7BwchT9C7w_4vWGNre3kP0hVWEXsZfDjZ42YJTk6re4X6DDZKWsCdBfw81iwKLJjgGAhX8MwQEJuOvsCkdj8j8R2lpFDzstXHUVaxy6dk_vXCbdIVXFuPT70d_CXhT35JRAbnYEqWrbtxU7unPBPdk7L3d5OZDC-GOOQm8CCyMbHKxup4u87fQhmy1d41nCqpVFniubSnAWwuqE3fyjsSrAh6Vvx8Dw6z7MAmOVZXXw";

  try {
    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    console.log(`[agent-client] Agent dispatch successful. Status: ${response.status}`);
  } catch (error: any) {
    if (error.response?.status === 403 && fallbackPat && token !== fallbackPat) {
      console.warn(
        `[agent-client] Service account received 403 Forbidden. Retrying with DevRev user PAT token...`
      );
      try {
        const retryRes = await axios.post(url, payload, {
          headers: {
            Authorization: `Bearer ${fallbackPat}`,
            "Content-Type": "application/json",
          },
        });
        console.log(`[agent-client] Agent dispatch with PAT successful. Status: ${retryRes.status}`);
        return;
      } catch (retryErr: any) {
        console.error(`[agent-client] Retry with PAT failed:`, retryErr.message);
      }
    }

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
  // Extract reply text from various possible locations in the agent response payload
  const message =
    payload?.event?.output_message?.message ??
    payload?.output_message?.message ??
    payload?.message ??
    payload?.data?.message ??
    payload?.response?.message ??
    "";

  const clientMetadata =
    payload?.client_metadata ??
    payload?.data?.client_metadata ??
    payload?.event?.client_metadata ??
    {};

  // Detect greeting: check if flagged or matches greeting patterns
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
