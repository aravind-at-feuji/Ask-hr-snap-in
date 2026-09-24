/**
 * Shared type definitions for the AskHR snap-in.
 */

/** Teams reply context packed into client_metadata for the two-phase async flow. */
export interface TeamsReplyContext {
  serviceUrl: string;
  conversationId: string;
  tenantId: string;
  botId: string;
  botName: string;
  recipientId: string;
  recipientName: string;
  activityId?: string;
}

/** Parsed inbound Teams activity (message or Action.Submit). */
export interface ParsedTeamsActivity {
  type: "message" | "action_submit";
  text: string;
  fromName: string;
  fromEmail?: string;
  replyContext: TeamsReplyContext;
}

/** Payload sent to the agent via ai-agents.events.execute-async. */
export interface AgentDispatchPayload {
  agent_id: string;
  message: string;
  client_metadata: Record<string, string>;
}

/** Shape of the agent response payload received on agent-response event source. */
export interface AgentResponsePayload {
  message: string;
  client_metadata: Record<string, string>;
  is_greeting?: boolean;
}

/** DevRev user search result (simplified). */
export interface DevRevUser {
  id: string;
  display_name: string;
  email?: string;
  full_name?: string;
}
