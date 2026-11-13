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
 * @param agentId         The AskHR agent DON (e.g. don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134)
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

  if (replyContext.isGreeting) {
    clientMetadata["isGreeting"] = "true";
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
  const devOrgId = devoMatch?.[1];

  // Configure callback target (webhook_target) strictly from provided target
  if (callbackTarget) {
    configureCallbackTarget(payload, callbackTarget, devOrgId);
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

export interface ExtractedAgentResponse {
  message: string;
  rawMessage?: string;
  clientMetadata: Record<string, string>;
  isGreeting: boolean;
  agentResponseStatus?: string;
  isFinal: boolean;
  errorMessage?: string;
}

/**
 * Clean agent response text by stripping DevRev internal DON (DevRev Object Notation)
 * citations, knowledge article references, and residual citation formatting.
 *
 * DevRev AI Agents frequently output RAG citations such as:
 * - `[<don:core:dvrv-us-1:devo/...:article/1169>]`
 * - `[don:core:dvrv-us-1:devo/...:article/1169]`
 * - `<don:core:dvrv-us-1:devo/...:article/1169>`
 * - `[Article 1169](don:core:...)`
 *
 * In Microsoft Teams (and other chat channels), these render as ugly, unclickable
 * raw DON strings. This function strips them cleanly and normalizes spacing and punctuation.
 */
export function cleanAgentResponseText(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  let cleaned = text;

  // 1. Handle markdown links pointing to DONs, e.g. [Title](don:...) or [1](<don:...>)
  cleaned = cleaned.replace(
    /\[([^\]]*)\]\(\s*<?don:[^>)\r\n]+>?\s*\)/gi,
    (_match, linkText) => {
      const trimmed = linkText.trim();
      // If the link text is just a citation label (empty, numbers, 'article', 'source', or a DON itself)
      if (
        !trimmed ||
        /^\d+$/.test(trimmed) ||
        /^<?don:/i.test(trimmed) ||
        /^(?:source|article|reference|ref|link)s?(?:\s*#?\d+)?$/i.test(trimmed)
      ) {
        return "";
      }
      // Otherwise keep the human-readable anchor text (e.g. "Leave Policy")
      return trimmed;
    }
  );

  // 2. Remove bracketed DON citations: [<don:...>], [don:...], [[<don:...>]]
  // Handles: `[<don:core:dvrv-us-1:devo/118bWKFTfx:article/1169>]`
  cleaned = cleaned.replace(/\[+\s*<?don:[^>\]\r\n]+>?\s*\]+/gi, "");

  // 3. Remove parenthesized DON citations: (<don:...>) or (don:...)
  cleaned = cleaned.replace(/\(+\s*<?don:[^>)\r\n]+>?\s*\)+/gi, "");

  // 4. Remove angle-bracketed bare DONs: <don:core:...>
  cleaned = cleaned.replace(/<\s*don:[^>\s\r\n]+\s*>/gi, "");

  // 5. Remove any remaining bare DON identifiers (e.g. don:core:dvrv-us-1:...)
  cleaned = cleaned.replace(/\bdon:[a-zA-Z0-9_\-\/:]+\b/gi, "");

  // 6. Clean up trailing citation commas or list artifacts left behind
  // e.g. "discussions. ," or "discussions, ." or "discussions, ,"
  cleaned = cleaned.replace(/([.?!])[ \t]*,+/g, "$1");
  cleaned = cleaned.replace(/,+[ \t]*([.?!])/g, "$1");
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/,[ \t]*$/gm, "");

  // 7. Clean up spaces before punctuation marks (e.g. "approved ." -> "approved.")
  cleaned = cleaned.replace(/[^\S\r\n]+([.,;?!])/g, "$1");

  // 8. Collapse duplicate periods (e.g. "approved. .") while preserving ellipsis "..."
  cleaned = cleaned.replace(/(?<!\.)\.\s*\.(?!\.)/g, ".");

  // 9. Clean up empty "Source:" or "References:" lines left behind
  cleaned = cleaned.replace(/^[ \t]*(?:sources?|references?):?[ \t]*$/gim, "");

  // 10. Normalize horizontal spaces (collapse 2+ spaces to 1, without affecting newlines)
  cleaned = cleaned.replace(/[^\S\r\n]{2,}/g, " ");

  // 11. Trim whitespace at the end of each line
  cleaned = cleaned.replace(/[^\S\r\n]+$/gm, "");

  // 12. Normalize multiple empty lines (limit consecutive newlines to 2)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

/**
 * Extract the agent's reply message from the agent-response event payload.
 *
 * In DevRev's execute-async architecture, the agent response callback webhook
 * delivers events with type `ai_agent_response`.
 * The payload structure is typically:
 * {
 *   "type": "ai_agent_response",
 *   "payload": {
 *     "ai_agent_response": {
 *       "agent_response": "message", // "message" for final, or intermediate status
 *       "message": "...",            // real agent text
 *       "client_metadata": { ... }   // Teams reply context
 *     }
 *   }
 * }
 */
export function extractAgentResponse(rawPayload: any): ExtractedAgentResponse {
  let payload = rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      // ignore
    }
  }

  // If passed the entire event wrapper, unwrap to payload
  if (
    payload &&
    payload.payload &&
    (payload.context || payload.execution_metadata || payload.input_data)
  ) {
    payload = payload.payload;
  }

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      // ignore
    }
  }

  // Locate the ai_agent_response container across standard DevRev paths
  const aiAgentResp =
    payload?.payload?.ai_agent_response ??
    payload?.ai_agent_response ??
    payload?.data?.ai_agent_response ??
    payload?.payload ??
    payload?.data ??
    payload;

  // Extract response status (e.g. "message", "thought", "error", etc.)
  const agentResponseStatus: string | undefined =
    aiAgentResp?.agent_response ??
    payload?.payload?.ai_agent_response?.agent_response ??
    payload?.ai_agent_response?.agent_response ??
    payload?.agent_response ??
    payload?.type;

  // Extract error message if present
  const errorMessage: string | undefined =
    aiAgentResp?.error?.message ??
    aiAgentResp?.error?.error ??
    (typeof aiAgentResp?.error === "string" ? aiAgentResp.error : undefined) ??
    payload?.payload?.ai_agent_response?.error?.message ??
    payload?.error?.message;

  // Extract reply text from actual DevRev ai_agent_response fields as well as fallback fields
  let extractedText: any =
    aiAgentResp?.message ??
    payload?.payload?.ai_agent_response?.message ??
    payload?.ai_agent_response?.message ??
    payload?.data?.ai_agent_response?.message ??
    payload?.event?.output_message?.message ??
    payload?.output_message?.message ??
    payload?.message ??
    payload?.data?.message ??
    payload?.response?.message ??
    aiAgentResp?.text ??
    payload?.text ??
    "";

  if (typeof extractedText === "object" && extractedText !== null) {
    extractedText =
      extractedText.message ??
      extractedText.text ??
      extractedText.content ??
      extractedText.value ??
      "";
  }

  const rawMessage = typeof extractedText === "string" ? extractedText.trim() : "";
  const message = cleanAgentResponseText(rawMessage);

  if (rawMessage.length > 0 && rawMessage.length !== message.length) {
    console.log(
      `[agent-client] Cleaned agent response (stripped DON citations/links, length ${rawMessage.length} -> ${message.length})`
    );
  }

  // Extract client metadata (handling nested paths and case variations)
  const rawMetadata =
    aiAgentResp?.client_metadata ??
    aiAgentResp?.clientMetadata ??
    payload?.payload?.ai_agent_response?.client_metadata ??
    payload?.payload?.ai_agent_response?.clientMetadata ??
    payload?.ai_agent_response?.client_metadata ??
    payload?.ai_agent_response?.clientMetadata ??
    payload?.client_metadata ??
    payload?.clientMetadata ??
    payload?.data?.client_metadata ??
    payload?.data?.clientMetadata ??
    payload?.event?.client_metadata ??
    payload?.metadata ??
    {};

  const clientMetadata: Record<string, string> = {};
  if (typeof rawMetadata === "object" && rawMetadata !== null) {
    for (const [key, value] of Object.entries(rawMetadata)) {
      if (typeof value === "string") {
        clientMetadata[key] = value;
      } else if (value !== undefined && value !== null) {
        clientMetadata[key] = String(value);
      }
    }
  }

  // Detect greeting: check if flagged in clientMetadata or payload or matches greeting patterns
  const isGreeting =
    clientMetadata["isGreeting"] === "true" ||
    clientMetadata["is_greeting"] === "true" ||
    payload?.is_greeting === true ||
    payload?.data?.is_greeting === true ||
    aiAgentResp?.is_greeting === true ||
    detectGreeting(message);

  // Determine if this is the final complete message event:
  // In DevRev execute-async callbacks, final response has agent_response === "message"
  // (or message is non-empty when status is absent).
  // Intermediate events (like thought/action/stream_start) or empty messages are NOT final.
  const isFinal =
    (agentResponseStatus === "message" || !agentResponseStatus) &&
    message.length > 0 &&
    !errorMessage &&
    agentResponseStatus !== "error";

  console.log(
    `[agent-client] Extracted agent response: status="${agentResponseStatus ?? "unknown"}", isFinal=${isFinal}, messageLength=${message.length}, text="${message.substring(0, 200)}..."`
  );
  console.log(`[agent-client] Is greeting: ${isGreeting}`);

  return {
    message,
    rawMessage,
    clientMetadata,
    isGreeting,
    agentResponseStatus,
    isFinal,
    errorMessage,
  };
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
    "how can i help you",
    "what can i assist you with",
    "how can i assist you today",
    "how can i assist you",
    "i'm here to help with your hr",
    "welcome! i can help you with",
    "feuji india ask hr",
    "feuji ask hr",
    "internal hr assistant",
    "dedicated internal hr assistant",
    "welcome! i'm feuji",
    "welcome! i am feuji",
    "queries or requests. how can i assist",
  ];
  return greetingPatterns.some((pattern) => lower.includes(pattern));
}
