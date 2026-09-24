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
export function formatWebhookDon(target: string, devOrgId?: string): string {
  if (!target) return "";

  // 1. If already a valid webhook DON, return as is
  if (target.startsWith("don:") && target.includes(":webhook/")) {
    return target;
  }

  // 2. If devOrgId is provided and target is a bare webhook ID
  if (devOrgId && !target.startsWith("don:") && !target.startsWith("http")) {
    return `don:integration:dvrv-us-1:devo/${devOrgId}:webhook/${target}`;
  }

  return target;
}

/**
 * Configure callback target on the execute-async request payload
 * conforming strictly to DevRev's execute-async schema:
 * - If target is an event_source DON: use target = 'event_source_target' and event_source_target = { event_source: target }
 * - If target is a webhook DON: use target = 'webhook_target' and webhook_target = { webhook: target }
 * - If target is a URL: determine event_source or webhook URL and configure accordingly
 */
export function configureCallbackTarget(payload: any, target: string): void {
  if (!target) return;

  if (target.includes(":event_source/")) {
    payload.target = "event_source_target";
    payload.event_source_target = {
      event_source: target,
    };
    console.log(`[agent-client] Configured event_source_target: ${target}`);
  } else if (target.includes(":webhook/")) {
    payload.target = "webhook_target";
    payload.webhook_target = {
      webhook: target,
    };
    console.log(`[agent-client] Configured webhook_target: ${target}`);
  } else if (target.startsWith("http://") || target.startsWith("https://")) {
    // If a custom event-source-webhooks URL was provided
    if (target.includes("/event-source-webhooks/")) {
      const parts = target.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      const devoMatch = target.match(/\/dev-orgs\/(?:DEV-)?([^\/]+)\//);
      if (devoMatch) {
        const eventSourceDon = `don:integration:dvrv-us-1:devo/${devoMatch[1]}:event_source/${id}`;
        payload.target = "event_source_target";
        payload.event_source_target = {
          event_source: eventSourceDon,
        };
        console.log(`[agent-client] Derived event_source_target from URL: ${eventSourceDon}`);
        return;
      }
    }
    payload.target = "webhook_target";
    payload.webhook_target = {
      webhook: target,
    };
    console.log(`[agent-client] Configured webhook_target with URL: ${target}`);
  } else {
    // Default fallback: treat bare DON or ID as event_source_target
    payload.target = "event_source_target";
    payload.event_source_target = {
      event_source: target,
    };
    console.log(`[agent-client] Fallback configured event_source_target: ${target}`);
  }
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

  // Configure callback target if provided
  if (callbackTarget) {
    configureCallbackTarget(payload, callbackTarget);
  }

  console.log(`[agent-client] Dispatching to agent ${agentId} via execute-async`);
  console.log(`[agent-client] Message length: ${message.length} chars`);
  console.log(`[agent-client] Callback target configured: ${callbackTarget ? "yes (" + payload.target + ")" : "no"}`);
  console.log(`[agent-client] Full execute-async request payload: ${JSON.stringify(payload)}`);

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
