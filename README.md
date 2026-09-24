# AskHR — DevRev Snap-in for Microsoft Teams

A DevRev snap-in that bridges Microsoft Teams to the DevRev AskHR agent. Employees send HR questions in Teams; the snap-in enriches messages with employee context, dispatches them to the AskHR agent, and returns real agent responses — including greeting cards with an 18-topic dropdown.

## Architecture

```
Teams User ──► [teams-inbound webhook] ──► handle_teams_message()
                                              │
                                              ├─ Resolve employee email (DevRev users API)
                                              ├─ Build Employee Context header
                                              └─ ai-agents.events.execute-async ──► AskHR Agent
                                                                                        │
                                                                                        ▼
Teams User ◄── Bot Framework REST API ◄── handle_agent_response() ◄── [agent-response webhook]
```

**Two-phase async** design: DevRev's serverless runtime cannot hold an HTTP connection open while waiting for the agent. The flow is split into two functions connected by two event sources.

### Critical Constraint
- Agent invocation uses **`ai-agents.events.execute-async` ONLY**.
- **No** `conversations.list` / conversation-add approach (causes hand-off problems).
- The snap-in does **not** create tickets — the agent handles ticket creation internally.

## Prerequisites

1. **DevRev CLI** installed and authenticated (`devrev profiles authenticate`)
2. **Node.js** ≥ 18 and **npm**
3. **Microsoft Azure Bot** registered with:
   - App ID (Microsoft App ID)
   - App Password (Client Secret)
   - Tenant ID (for single-tenant bots)
4. **AskHR Agent** configured in DevRev (ID: `don:core:dvrv-us-1:devo/118bWKFTfx:ai_agent/61`)

## Secrets & Configuration (Provided at Install)

| Setting | Type | Description |
|---------|------|-------------|
| **Teams Bot Credentials** | Keyring (snap_in_secret) | Microsoft App Password (client secret) |
| **Teams Bot App ID** | Input (text) | Microsoft App ID for the bot |
| **Teams Bot Tenant ID** | Input (text, optional) | Azure AD Tenant ID |
| **AskHR Agent ID** | Input (text) | DevRev agent DON identifier |

The DevRev service account token is automatically provisioned.

## Project Structure

```
├── manifest.yaml                          # Snap-in manifest (event sources, functions, keyrings)
├── .agents/
│   ├── rules/agent_architecture_rule.md   # Architecture constraints documentation
│   └── skills/askhr_operations.md         # Operational runbooks
├── code/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── function-factory.ts            # Function registry
│       ├── index.ts                       # Exports
│       ├── main.ts                        # Local test runner
│       ├── devrev/
│       │   ├── types.ts                   # Shared type definitions
│       │   ├── agent-client.ts            # execute-async dispatch + response extraction
│       │   └── users.ts                   # Name → email lookup via DevRev users API
│       ├── teams/
│       │   └── teams-client.ts            # Bot Framework auth + send messages/cards
│       ├── functions/
│       │   ├── handle_teams_message/
│       │   │   └── index.ts               # Phase 1: Teams inbound → agent dispatch
│       │   └── handle_agent_response/
│       │       └── index.ts               # Phase 2: Agent reply → Teams response
│       └── fixtures/
│           ├── teams_inbound_message.json  # Test: regular message
│           ├── teams_topic_submit.json     # Test: topic selection from card
│           └── agent_response_event.json   # Test: agent response
```

## Deploy

```bash
# 1. Install dependencies and build
cd code
npm install
npm run build

# 2. Create snap-in version (creates package on first run)
devrev snap_in_version create-one --path . --create-package

# 3. Draft → Update → Activate
devrev snap_in draft
devrev snap_in update
devrev snap_in activate
```

After activation, configure the **Teams bot messaging endpoint** to point to the `teams-inbound` event source URL (visible in DevRev snap-in settings).

## Testing Outside Teams (Real Responses)

Since the flow is async, you verify the **real agent reply in snap-in logs**, not in the HTTP response.

### 1. Send a test message

```bash
curl -X POST "https://<your-teams-inbound-webhook-url>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "serviceUrl": "https://smba.trafficmanager.net/in/",
    "from": { "id": "test-user-1", "name": "Aravind Induri" },
    "conversation": { "id": "test-conv-1", "tenantId": "YOUR_TENANT_ID" },
    "recipient": { "id": "YOUR_BOT_ID", "name": "AskHR" },
    "text": "What is the leave policy?"
  }'
```

### 2. Check snap-in logs for Phase 1 (`handle_teams_message`)

```
[handle_teams_message] ===== Inbound Teams activity received =====
[handle_teams_message] Activity type: message
[handle_teams_message] Regular message: "What is the leave policy?"
[handle_teams_message] From: Aravind Induri, ConversationId: test-conv-1
[users] Searching DevRev users directory for name="Aravind Induri"
[users] Exactly one match found. Email: (resolved)
[handle_teams_message] Enriched message built (xxx chars)
[handle_teams_message] Dispatching to agent: don:core:dvrv-us-1:devo/118bWKFTfx:ai_agent/61
[agent-client] Agent dispatch successful. Status: 200
[handle_teams_message] ===== Dispatch complete. Exiting. =====
```

### 3. Check snap-in logs for Phase 2 (`handle_agent_response`)

```
[handle_agent_response] ===== Agent response received =====
[handle_agent_response] Agent reply (first 200 chars): "According to our leave policy..."
[handle_agent_response] Is greeting: false
[teams-client] Bot Framework token acquired successfully
[handle_agent_response] Sending plain text response to Teams
[teams-client] Message sent successfully. Status: 200
[handle_agent_response] ===== Reply sent to Teams. Done. =====
```

### Local test runner (fixture-based)

```bash
cd code
npm run start -- --functionName=handle_teams_message --fixturePath=teams_inbound_message.json
npm run start -- --functionName=handle_agent_response --fixturePath=agent_response_event.json
```

> **Note:** Replace `YOUR_*` placeholders in fixture files with real values before running.

## Greeting Flow

On greeting turns, the snap-in sends an **Adaptive Card** with:
- The agent's greeting text
- A compact dropdown (`Input.ChoiceSet`) with 18 HR topics:
  - Onboarding & Joining Formalities, BGV, ID & Access Management, Payroll Timelines, Payroll & Statutory, PF / Tax, Leave Management, Attendance Management, Probation, Variable Payout, Exit Management, Compensatory Offs, Health Insurance, HR Policy, Expense Management, L&D, HRMS (Nicoya), Employee Letters
- An **"Ask HR"** submit button

When the user selects a topic and clicks "Ask HR", Teams sends an `Action.Submit` back to `teams-inbound`, which is detected and dispatched to the agent as a regular inquiry.

## License

Internal use only.
