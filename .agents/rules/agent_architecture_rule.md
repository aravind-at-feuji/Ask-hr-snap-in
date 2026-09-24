# AskHR Snap-in — Architecture Rule

## Mandated Architecture: Two-Phase Async

The AskHR snap-in uses a **two-phase asynchronous** design to bridge Microsoft Teams to the DevRev AskHR agent. This is necessary because DevRev's serverless runtime has no persistent HTTP server — a single function cannot wait/poll for the agent reply.

### Phase 1: `handle_teams_message` (Event source: `teams-inbound`)
1. Parse the Teams Bot Framework activity payload.
2. Detect regular messages vs. `Action.Submit` (topic selection from greeting card).
3. Resolve employee email by searching the DevRev users directory by display name.
4. Build the `[Employee Context: ...]` header and prepend to the inquiry.
5. Dispatch to the AskHR agent via `ai-agents.events.execute-async`.
6. Pack Teams reply context (`serviceUrl`, `conversationId`, `tenantId`, bot info, recipient info) into `client_metadata`.
7. **Exit immediately** — no polling, no waiting.

### Phase 2: `handle_agent_response` (Event source: `agent-response`)
1. Extract the agent's reply message from the response payload.
2. Reconstruct the `TeamsReplyContext` from `client_metadata`.
3. If the turn is a **greeting**, send the Adaptive Card (agent text + 18-topic dropdown + "Ask HR" button).
4. Otherwise, send the answer as a plain text/markdown message.
5. Authenticate to Bot Framework and POST the reply to Teams.

---

## CRITICAL: Agent Invocation Method

### ✅ ALLOWED — `ai-agents.events.execute-async`
This is the **ONLY** permitted method to invoke the AskHR agent.

### ❌ FORBIDDEN — `conversations.list` / Adding agent to a conversation
**DO NOT** use the conversations API or add the agent into a DevRev conversation. This approach causes **hand-off problems** where the agent competes with or is handed off to other responders. This is explicitly forbidden.

### ❌ FORBIDDEN — Conversations / Timelines for message flow
The snap-in does **NOT** use DevRev conversations or timelines for the Teams ↔ Agent message flow.

---

## Secrets & Keyrings Model

All secrets are stored in **keyrings / connection settings** declared in `manifest.yaml`:

| Secret | Storage | Access in Code |
|--------|---------|----------------|
| Teams App Password | `keyrings.organization[teams-bot-credentials]` | `event.input_data.keyrings["teams-bot-credentials"].secret` |
| Teams App ID | `inputs.organization[teams_bot_app_id]` | `event.input_data.global_values.teams_bot_app_id` |
| Teams Tenant ID | `inputs.organization[teams_bot_tenant_id]` | `event.input_data.global_values.teams_bot_tenant_id` |
| AskHR Agent ID | `inputs.organization[askhr_agent_id]` | `event.input_data.global_values.askhr_agent_id` |
| DevRev Service Account Token | Auto-provisioned | `event.context.secrets.service_account_token` |

**Never** hardcode secrets. **Never** log secret values.

---

## Ticket Creation

The snap-in does **NOT** create tickets. The AskHR agent classifies issues and calls its own ticket-creation workflow. The snap-in only relays messages.

---

## Email Resolution

- Search DevRev users directory by display name.
- **Exactly one match** → use that user's email.
- **Zero or multiple matches** → leave email blank. **Never guess or fabricate.**
