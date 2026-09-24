/**
 * handle_teams_message — Phase 1 of the two-phase async flow.
 *
 * Triggered by the `teams-inbound` event source when Teams sends a message
 * (or an Action.Submit from the greeting card).
 *
 * Steps:
 * 1. Parse the Teams activity (message text, from.name, reply context)
 * 2. Detect Action.Submit (topic selection from greeting card)
 * 3. Resolve employee email by name via DevRev users directory
 * 4. Build Employee Context header + user inquiry
 * 5. Dispatch to AskHR agent via ai-agents.events.execute-async
 * 6. Exit immediately — no polling
 */
import { dispatchToAgent } from "../../devrev/agent-client";
import { resolveEmailByName, buildEmployeeContextHeader } from "../../devrev/users";
import { TeamsReplyContext } from "../../devrev/types";

export async function handleEvent(event: any): Promise<void> {
  console.log("[handle_teams_message] ===== Inbound Teams activity received =====");

  try {
    // Extract secrets and configuration
    const devrevToken = event.context.secrets.service_account_token;
    const devrevEndpoint = event.execution_metadata.devrev_endpoint;

    // Teams bot credentials from keyring
    const teamsSecrets = event.input_data.keyrings?.["teams-bot-credentials"];
    const teamsAppPassword = teamsSecrets?.secret ?? "";

    // Configuration inputs
    const inputData = event.input_data.global_values ?? {};
    const teamsAppId = inputData.teams_bot_app_id ?? "";
    const teamsTenantId = inputData.teams_bot_tenant_id ?? "";
    const agentId =
      inputData.askhr_agent_id ??
      "don:core:dvrv-us-1:devo/118bWKFTfx:ai_agent/61";

    // The agent-response event source URL for the callback
    // This is derived from event source config in the snap-in
    const agentResponseUrl =
      event.execution_metadata?.event_sources?.["agent-response"]?.webhook_url ?? "";

    // Parse the inbound payload
    const payload = event.payload ?? {};
    const teamsActivity = payload.data ?? payload;

    console.log(`[handle_teams_message] Activity type: ${teamsActivity.type}`);

    // Determine if this is an Action.Submit (topic selection) or a regular message
    let messageText: string;
    let isTopicSubmit = false;

    if (teamsActivity.type === "invoke" || teamsActivity.value?.action === "askhr_topic_submit") {
      // Action.Submit from the greeting Adaptive Card
      const selectedTopic = teamsActivity.value?.selectedTopic ?? "";
      messageText = selectedTopic;
      isTopicSubmit = true;
      console.log(`[handle_teams_message] Action.Submit detected — topic: "${selectedTopic}"`);
    } else if (teamsActivity.value?.action === "askhr_topic_submit") {
      // Alternative Action.Submit path
      const selectedTopic = teamsActivity.value?.selectedTopic ?? "";
      messageText = selectedTopic;
      isTopicSubmit = true;
      console.log(`[handle_teams_message] Action.Submit detected (alt) — topic: "${selectedTopic}"`);
    } else {
      // Regular message
      messageText = teamsActivity.text ?? "";
      // Strip bot mention from the text if present (Teams group chats include @mention)
      messageText = stripBotMention(messageText);
      console.log(`[handle_teams_message] Regular message: "${messageText.substring(0, 100)}"`);
    }

    if (!messageText.trim()) {
      console.log("[handle_teams_message] Empty message — ignoring");
      return;
    }

    // Extract sender information
    const fromName = teamsActivity.from?.name ?? "Unknown";
    const fromEmail = teamsActivity.from?.aadObjectId ? undefined : undefined; // Teams doesn't reliably provide email

    console.log(`[handle_teams_message] From: ${fromName}, ConversationId: ${teamsActivity.conversation?.id}`);

    // Build Teams reply context for the round-trip
    const replyContext: TeamsReplyContext = {
      serviceUrl: normalizeServiceUrl(teamsActivity.serviceUrl ?? ""),
      conversationId: teamsActivity.conversation?.id ?? "",
      tenantId: teamsActivity.conversation?.tenantId ?? teamsTenantId,
      botId: teamsActivity.recipient?.id ?? teamsAppId,
      botName: teamsActivity.recipient?.name ?? "AskHR",
      recipientId: teamsActivity.from?.id ?? "",
      recipientName: fromName,
      activityId: teamsActivity.id,
    };

    // Step: Resolve employee email by name
    let resolvedEmail: string | undefined = fromEmail;
    if (!resolvedEmail) {
      console.log(`[handle_teams_message] Email not in payload — resolving via DevRev users directory`);
      const lookup = await resolveEmailByName(devrevEndpoint, devrevToken, fromName);
      resolvedEmail = lookup.email;
      console.log(
        `[handle_teams_message] Email lookup result: ${
          resolvedEmail ? "resolved" : `not resolved (${lookup.matchCount} matches)`
        }`
      );
    }

    // Build the enriched message with Employee Context header
    const contextHeader = buildEmployeeContextHeader(fromName, resolvedEmail);
    const enrichedMessage = contextHeader + messageText;

    console.log(`[handle_teams_message] Enriched message built (${enrichedMessage.length} chars)`);

    // Dispatch to agent via execute-async — then exit immediately
    console.log(`[handle_teams_message] Dispatching to agent: ${agentId}`);
    await dispatchToAgent(
      devrevEndpoint,
      devrevToken,
      agentId,
      enrichedMessage,
      replyContext,
      agentResponseUrl
    );

    console.log("[handle_teams_message] ===== Dispatch complete. Exiting. =====");
  } catch (error: any) {
    console.error(`[handle_teams_message] ERROR: ${error.message}`);
    console.error(`[handle_teams_message] Stack: ${error.stack}`);
  }
}

/**
 * Normalize the service URL to ensure it ends with a slash.
 */
function normalizeServiceUrl(url: string): string {
  if (!url) return url;
  return url.endsWith("/") ? url : url + "/";
}

/**
 * Strip the bot @mention from the message text.
 * Teams prefixes group messages with `<at>BotName</at>`.
 */
function stripBotMention(text: string): string {
  // Remove HTML-style <at>...</at> tags
  return text.replace(/<at>.*?<\/at>\s*/gi, "").trim();
}

export const run = async (events: any[]) => {
  for (const event of events) {
    await handleEvent(event);
  }
};

export default run;
