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

### Event Sources
Both event sources use `flow-custom-webhook` type with `custom:action` event type:
- `teams-inbound` → `handle_teams_message` (automation: `on-teams-inbound`)
- `agent-response` → `handle_agent_response` (automation: `on-agent-response`)

---

## CRITICAL: Agent Invocation Method

### ✅ ALLOWED — `ai-agents.events.execute-async`
This is the **ONLY** permitted method to invoke the AskHR agent.

### ❌ FORBIDDEN — `conversations.list` / Adding agent to a conversation
**DO NOT** use the conversations API or add the agent into a DevRev conversation. This approach causes **hand-off problems** where the agent competes with or is handed off to other responders. This is explicitly forbidden.

### ❌ FORBIDDEN — Conversations / Timelines for message flow
The snap-in does **NOT** use DevRev conversations or timelines for the Teams ↔ Agent message flow.

---

## Authentication & Service Account Model

The snap-in authenticates to DevRev strictly as a **service account**. DevRev automatically provisions the service account credentials (`event.context.secrets.service_account_token`) at runtime.

- **NO DevRev user token (PAT)**: Do not require, store, or accept a DevRev user token anywhere. All DevRev operations (agent invocation, users directory lookup) use the service account token.
- **Service account scopes**: Declared under `service_account.scopes.self` in `manifest.yaml`:
  - `dev_user:read`: Query the DevRev users directory (`dev-users.list`) to match employee display names to emails.
  - `ai_agent:read`: Invoke the AskHR AI agent (`don:core:dvrv-us-1:devo/...:ai_agent/...`) via `ai-agents.events.execute-async`.
- **No ticket scopes**: The snap-in does **NOT** create tickets; the agent handles ticket creation via its own workflow.

---

## Secrets & Keyrings Model

Keyrings are used **exclusively for external secrets** (Microsoft Teams bot credentials). No DevRev tokens belong in keyrings:

| Secret | Storage | Access in Code |
|--------|---------|----------------|
| Teams App Password | `keyrings.organization[teams-app-secret]` (type: `snap_in_secret`) | `event.input_data.keyrings["teams-app-secret"].secret` |
| Teams App ID | `keyrings.organization[teams-bot-app-id]` (type: `snap_in_secret`) | `event.input_data.keyrings["teams-bot-app-id"].secret` |
| Teams Tenant ID | `keyrings.organization[teams-bot-tenant-id]` (type: `snap_in_secret`) | `event.input_data.keyrings["teams-bot-tenant-id"].secret` |
| AskHR Agent ID | `inputs.organization[askhr_agent_id]` (field_type: `text`, default provided) | `event.input_data.global_values.askhr_agent_id` |
| DevRev Service Account Token | Auto-provisioned by DevRev platform | `event.context.secrets.service_account_token` |

**Never** hardcode secrets. **Never** log secret values.

---

## Ticket Creation

The snap-in does **NOT** create tickets. The AskHR agent classifies issues and calls its own ticket-creation workflow. The snap-in only relays messages.

---

## Email Resolution

- Search DevRev users directory by display name via `dev-users.list`.
- **Exactly one match** → use that user's email.
- **Zero or multiple matches** → leave email blank. **Never guess or fabricate.**

---

## Manifest Schema Pitfalls (Validated Against DevRev API)

These are real issues encountered during deployment — follow strictly:

| ❌ Invalid / Missing Field | Context | Fix |
|-----------------------------|---------|-----|
| `is_optional` | Not a recognized field on `keyrings` entries | Remove entirely; keyrings are required by default |
| Missing `service_account.scopes` | Validation error: `service_account.scopes is required by the snap-in to function` | Declare `scopes.self` with required permissions (`dev_user:read`, `ai_agent:read`) |

### Valid service_account structure
```yaml
service_account:
  display_name: AskHR Bot
  scopes:
    self:
      - scope: dev_user:read
        optional: false
        reason: "Search DevRev users directory to resolve employee email"
      - scope: ai_agent:read
        optional: false
        reason: "Invoke the AskHR agent via execute-async"
```

### Valid keyring fields
Only these fields are accepted on a keyring entry:
- `name`, `description`, `display_name`, `types`

### Valid input fields
- `name`, `description`, `field_type`, `default_value`, `is_required`, `ui` (with `display_name`)

---

## Deployment Rules

### ⚠️ Never run snap-in deployment commands automatically
Always **provide commands to the user** for manual execution. Never execute these directly:
```
devrev snap_in_version create-one ...
devrev snap_in draft
devrev snap_in update
devrev snap_in activate
```

### ⚠️ Run from the project root, not `code/`
The DevRev CLI looks for `manifest.yaml` in the current directory. Always run from:
```
devrev-snaps-typescript-template/     ← HERE (contains manifest.yaml)
├── manifest.yaml
├── code/
│   ├── package.json
│   └── src/
```
**Not** from `code/` — that will fail with `could not find 'manifest.yaml'`.

### Build before deploy
```bash
cd code && npm install && npm run build
cd ..
devrev snap_in_version create-one --path . --create-package
```
