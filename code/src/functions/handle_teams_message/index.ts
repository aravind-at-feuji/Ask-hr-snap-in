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
import { getKeyringSecret } from "../../devrev/keyrings";
import { resolveEmailByName, buildEmployeeContextHeader } from "../../devrev/users";
import { TeamsReplyContext } from "../../devrev/types";
import { checkAndRecordIncomingActivity, releaseConversationLock } from "../../teams/dedup";
import { acquireBotToken, sendTypingIndicator } from "../../teams/teams-client";

export async function handleEvent(event: any): Promise<void> {
  console.log("[handle_teams_message] ===== Inbound Teams activity received =====");

  try {
    // Extract secrets and configuration
    const devrevToken = event.context.secrets.service_account_token;
    const devrevEndpoint = event.execution_metadata.devrev_endpoint;

    // Credentials and configuration strictly from keyrings (secrets)
    const teamsAppPassword = getKeyringSecret(event, "teams-app-secret");
    const teamsAppId = getKeyringSecret(event, "teams-bot-app-id");
    const teamsTenantId = getKeyringSecret(event, "teams-bot-tenant-id");

    const agentId = getKeyringSecret(event, "askhr_agent_id", "askhr-agent-id");
    if (!agentId) {
      throw new Error("[handle_teams_message] Missing required keyring: askhr_agent_id");
    }

    // Webhook DON pointing to the agent-response event source for execute-async callback
    const agentResponseWebhookId = getKeyringSecret(
      event,
      "agent_response_webhook_id",
      "agent-response-webhook-id"
    );
    if (!agentResponseWebhookId) {
      throw new Error("[handle_teams_message] Missing required keyring: agent_response_webhook_id");
    }

    // DevRev token for agent dispatch: use PAT if configured in keyrings, otherwise fallback to service account
    const devrevPat = getKeyringSecret(event, "devrev_pat", "devrev-pat");
    const agentToken = devrevPat || event.context.secrets.service_account_token;
    const directoryToken = event.context.secrets.service_account_token;

    console.log(
      `[handle_teams_message] agentResponseWebhookId: "${agentResponseWebhookId}"`
    );
    console.log(
      `[handle_teams_message] Agent dispatch token source: ${devrevPat ? "configured PAT (keyring)" : "service account"}`
    );


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

    // Deduplication check: drop duplicate activities caused by Bot Framework retries or rapid double-submits
    const dedup = checkAndRecordIncomingActivity(
      teamsActivity.id,
      teamsActivity.conversation?.id,
      messageText
    );
    if (dedup.isDuplicate) {
      console.warn(
        `[handle_teams_message] ${dedup.reason}. Dropping event to prevent duplicate agent responses.`
      );
      return;
    }

    // Extract sender information
    const fromName = teamsActivity.from?.name ?? "Unknown";
    const fromEmail =
      teamsActivity.from?.email ||
      teamsActivity.from?.userPrincipalName ||
      undefined;
    const aadObjectId = teamsActivity.from?.aadObjectId;

    console.log(
      `[handle_teams_message] From: ${fromName} (aadObjectId: ${aadObjectId ?? "none"}, email: ${fromEmail ?? "none"
      }), ConversationId: ${teamsActivity.conversation?.id}`
    );

    // Detect if inbound message is a greeting (e.g. "hello", "hi", "hey", "good morning")
    const GREETING_REGEX = /^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening)|namaste)\b/i;
    const isUserGreeting = !isTopicSubmit && GREETING_REGEX.test(messageText.trim());

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
      isGreeting: isUserGreeting,
    };

    // Send typing indicator to Teams in parallel so user immediately sees "AskHR is typing..."
    const typingPromise = (async () => {
      if (replyContext.serviceUrl && replyContext.conversationId && teamsAppId && teamsAppPassword) {
        try {
          const botToken = await acquireBotToken(teamsAppId, teamsAppPassword, replyContext.tenantId);
          await sendTypingIndicator(botToken, replyContext);
        } catch (typingErr: any) {
          console.warn(`[handle_teams_message] Typing indicator skipped: ${typingErr.message}`);
        }
      }
    })();

    // Step: Resolve employee email by name
    let resolvedEmail: string | undefined = fromEmail;
    if (!resolvedEmail) {
      console.log(`[handle_teams_message] Email not in payload — resolving via DevRev users directory`);
      const lookup = await resolveEmailByName(devrevEndpoint, directoryToken, fromName, {
        aadObjectId,
      });
      resolvedEmail = lookup.email;
      console.log(
        `[handle_teams_message] Email lookup result: ${resolvedEmail ? `resolved (${resolvedEmail})` : `not resolved (${lookup.matchCount} matches)`
        }`
      );
    }

    // Build the enriched message with Employee Context header
    const contextHeader = buildEmployeeContextHeader(fromName, resolvedEmail);
    const enrichedMessage = contextHeader + messageText;

    console.log(`[handle_teams_message] Enriched message built (${enrichedMessage.length} chars)`);

    // Dispatch to agent via execute-async — then exit immediately
    console.log(
      `[handle_teams_message] Dispatching to agent: ${agentId} with callback webhook: ${agentResponseWebhookId}`
    );
    await dispatchToAgent(
      devrevEndpoint,
      agentToken,
      agentId,
      enrichedMessage,
      replyContext,
      agentResponseWebhookId
    );

    // Ensure typing indicator network call concludes before function terminates
    await typingPromise;

    console.log("[handle_teams_message] ===== Dispatch complete. Exiting. =====");
  } catch (error: any) {
    console.error(`[handle_teams_message] ERROR: ${error.message}`);
    console.error(`[handle_teams_message] Stack: ${error.stack}`);
    // Release in-flight lock on failure so the user isn't stuck
    try {
      const payload = event?.payload ?? {};
      const teamsActivity = payload.data ?? payload;
      if (teamsActivity?.conversation?.id) {
        releaseConversationLock(teamsActivity.conversation.id);
      }
    } catch {
      // Ignore cleanup error
    }
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
