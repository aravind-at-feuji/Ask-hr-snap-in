/**
 * handle_agent_response — Phase 2 of the two-phase async flow.
 *
 * Triggered by the `agent-response` event source when the AskHR agent
 * sends back its response asynchronously.
 *
 * Steps:
 * 1. Extract the agent's reply message from the payload
 * 2. Extract Teams reply context from client_metadata
 * 3. If greeting → send Adaptive Card with 18-topic dropdown
 * 4. Otherwise → send the agent's answer as a plain text message
 * 5. Authenticate to Bot Framework and POST the reply to Teams
 */
import { extractAgentResponse } from "../../devrev/agent-client";
import { TeamsReplyContext } from "../../devrev/types";
import {
  acquireBotToken,
  sendTextMessage,
  sendGreetingCard,
} from "../../teams/teams-client";

export async function handleEvent(event: any): Promise<void> {
  console.log("[handle_agent_response] ===== Agent response received =====");

  try {
    // 1. Log the FULL raw callback payload so we can inspect the exact structure from DevRev.
    // Redact secret values in keyrings to ensure security compliance.
    const safeEvent = { ...event };
    if (safeEvent.input_data?.keyrings) {
      const safeKeyrings: Record<string, any> = {};
      for (const [k, v] of Object.entries(safeEvent.input_data.keyrings as Record<string, any>)) {
        safeKeyrings[k] = { ...v, secret: v.secret ? "***REDACTED***" : undefined };
      }
      safeEvent.input_data = { ...safeEvent.input_data, keyrings: safeKeyrings };
    }
    console.log(`[handle_agent_response] FULL raw event: ${JSON.stringify(safeEvent)}`);
    console.log(`[handle_agent_response] FULL raw callback payload: ${JSON.stringify(event?.payload)}`);

    // Extract secrets and configuration strictly from keyrings
    const keyrings = event.input_data?.keyrings ?? {};

    const teamsAppPassword = keyrings["teams-app-secret"]?.secret ?? "";
    const teamsAppId = keyrings["teams-bot-app-id"]?.secret ?? "";
    const teamsTenantId = keyrings["teams-bot-tenant-id"]?.secret ?? "";

    // Extract the agent response from the actual payload structure
    const {
      message,
      clientMetadata,
      isGreeting,
      agentResponseStatus,
      isFinal,
      errorMessage,
    } = extractAgentResponse(event.payload ?? event);

    // If agent sent an explicit error
    if (agentResponseStatus === "error" || errorMessage) {
      console.error(
        `[handle_agent_response] Agent reported error: ${errorMessage || "Unknown error"}. Skipping.`
      );
      return;
    }

    // Ignore intermediate / streaming / non-final events without treating as failure
    if (!isFinal || !message) {
      console.log(
        `[handle_agent_response] Intermediate/non-final event received (status: "${agentResponseStatus ?? "none"}", messageLength: ${message.length}). Ignoring and awaiting final message.`
      );
      return;
    }

    console.log(
      `[handle_agent_response] Final message extracted successfully! Status: "${agentResponseStatus ?? "message"}"`
    );
    console.log(
      `[handle_agent_response] Agent reply (first 200 chars): "${message.substring(0, 200)}"`
    );
    console.log(`[handle_agent_response] Is greeting: ${isGreeting}`);

    // Reconstruct Teams reply context from client_metadata (supports camelCase and snake_case)
    let serviceUrl = clientMetadata["serviceUrl"] ?? clientMetadata["service_url"] ?? "";
    if (serviceUrl && !serviceUrl.endsWith("/")) {
      serviceUrl += "/";
    }

    const replyContext: TeamsReplyContext = {
      serviceUrl,
      conversationId: clientMetadata["conversationId"] ?? clientMetadata["conversation_id"] ?? "",
      tenantId: clientMetadata["tenantId"] ?? clientMetadata["tenant_id"] ?? teamsTenantId,
      botId: clientMetadata["botId"] ?? clientMetadata["bot_id"] ?? teamsAppId,
      botName: clientMetadata["botName"] ?? clientMetadata["bot_name"] ?? "AskHR",
      recipientId: clientMetadata["recipientId"] ?? clientMetadata["recipient_id"] ?? "",
      recipientName: clientMetadata["recipientName"] ?? clientMetadata["recipient_name"] ?? "",
      activityId: clientMetadata["activityId"] ?? clientMetadata["activity_id"],
    };

    if (!replyContext.serviceUrl || !replyContext.conversationId) {
      console.error(
        "[handle_agent_response] Missing Teams reply context — cannot send reply"
      );
      console.error(
        `[handle_agent_response] serviceUrl: "${replyContext.serviceUrl}", conversationId: "${replyContext.conversationId}"`
      );
      console.error(
        `[handle_agent_response] clientMetadata received: ${JSON.stringify(clientMetadata)}`
      );
      return;
    }

    // Acquire Bot Framework token
    console.log("[handle_agent_response] Acquiring Bot Framework token...");
    let botToken = "";
    try {
      botToken = await acquireBotToken(
        teamsAppId,
        teamsAppPassword,
        replyContext.tenantId
      );
    } catch (tokenErr: any) {
      if (replyContext.serviceUrl.includes("webhook.site")) {
        console.warn(
          `[handle_agent_response] Bot Framework token failed (${tokenErr.message}), but serviceUrl is webhook.site — proceeding with test token for verification.`
        );
        botToken = "test-bot-token";
      } else {
        throw tokenErr;
      }
    }

    // Send the response back to Teams
    if (isGreeting) {
      console.log("[handle_agent_response] Sending greeting Adaptive Card with topic dropdown");
      await sendGreetingCard(botToken, replyContext, message);
    } else {
      console.log("[handle_agent_response] Sending plain text response to Teams");
      await sendTextMessage(botToken, replyContext, message);
    }

    console.log("[handle_agent_response] ===== Reply sent to Teams. Done. =====");
  } catch (error: any) {
    console.error(`[handle_agent_response] ERROR: ${error.message}`);
    console.error(`[handle_agent_response] Stack: ${error.stack}`);
  }
}

export const run = async (events: any[]) => {
  for (const event of events) {
    await handleEvent(event);
  }
};

export default run;
