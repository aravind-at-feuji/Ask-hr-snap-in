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
    // Extract secrets and configuration
    const teamsSecrets = event.input_data.keyrings?.["teams-bot-credentials"];
    const teamsAppPassword = teamsSecrets?.secret ?? "";

    const inputData = event.input_data.global_values ?? {};
    const teamsAppId = inputData.teams_bot_app_id ?? "";
    const teamsTenantId = inputData.teams_bot_tenant_id ?? "";

    // Extract the agent response payload
    const payload = event.payload ?? {};
    const agentPayload = payload.data ?? payload;

    const { message, clientMetadata, isGreeting } =
      extractAgentResponse(agentPayload);

    if (!message) {
      console.log("[handle_agent_response] Empty agent response — ignoring");
      return;
    }

    console.log(
      `[handle_agent_response] Agent reply (first 200 chars): "${message.substring(0, 200)}"`
    );
    console.log(`[handle_agent_response] Is greeting: ${isGreeting}`);

    // Reconstruct Teams reply context from client_metadata
    const replyContext: TeamsReplyContext = {
      serviceUrl: clientMetadata["serviceUrl"] ?? "",
      conversationId: clientMetadata["conversationId"] ?? "",
      tenantId: clientMetadata["tenantId"] ?? teamsTenantId,
      botId: clientMetadata["botId"] ?? teamsAppId,
      botName: clientMetadata["botName"] ?? "AskHR",
      recipientId: clientMetadata["recipientId"] ?? "",
      recipientName: clientMetadata["recipientName"] ?? "",
      activityId: clientMetadata["activityId"],
    };

    if (!replyContext.serviceUrl || !replyContext.conversationId) {
      console.error(
        "[handle_agent_response] Missing Teams reply context — cannot send reply"
      );
      console.error(
        `[handle_agent_response] serviceUrl: "${replyContext.serviceUrl}", conversationId: "${replyContext.conversationId}"`
      );
      return;
    }

    // Acquire Bot Framework token
    console.log("[handle_agent_response] Acquiring Bot Framework token...");
    const botToken = await acquireBotToken(
      teamsAppId,
      teamsAppPassword,
      replyContext.tenantId
    );

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
