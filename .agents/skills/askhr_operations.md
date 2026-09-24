# Add a New HR Topic

## When to use
When you need to add a new topic to the greeting card's 18-topic dropdown.

## Steps

1. **Update `HR_TOPICS` array** in `code/src/teams/teams-client.ts`:
   - Add the new topic string to the `HR_TOPICS` array.
   - The Adaptive Card is generated dynamically from this array.

2. **Verify the agent supports the topic**:
   - Confirm with the AskHR agent team that the agent can handle the new topic.
   - The snap-in simply relays the topic string to the agent — no special handling needed.

3. **Test**:
   - Use the `teams_inbound_message.json` fixture to trigger a greeting.
   - Verify the new topic appears in the Adaptive Card dropdown in the snap-in logs.

4. **Deploy**:
   ```bash
   cd code && npm run build
   devrev snap_in_version create-one --path . --create-package
   devrev snap_in draft
   devrev snap_in update
   devrev snap_in activate
   ```

---

# Rotate Teams Bot Secret

## When to use
When the Microsoft Teams bot app password (client secret) needs rotation.

## Steps

1. **Generate new secret** in Azure Portal → App Registrations → Your Bot → Certificates & secrets → New client secret.
2. **Update the keyring** in DevRev:
   - Go to DevRev Settings → Snap-ins → AskHR → Configuration.
   - Update the `Teams Bot Credentials` keyring with the new secret.
3. **Verify**: Send a test message in Teams and check snap-in logs for successful token acquisition.
4. No code changes or redeployment needed — keyrings are read at runtime.

---

# Redeploy & Test

## Build and Deploy

```bash
cd code
npm install
npm run build
devrev snap_in_version create-one --path . --create-package
devrev snap_in draft
devrev snap_in update
devrev snap_in activate
```

## Test Outside Teams (Real Responses)

POST a Teams-shaped payload to the `teams-inbound` event source URL:

```bash
curl -X POST "https://<your-teams-inbound-webhook-url>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "serviceUrl": "https://smba.trafficmanager.net/in/",
    "from": { "id": "test-user-1", "name": "Test User" },
    "conversation": { "id": "test-conv-1", "tenantId": "your-tenant-id" },
    "recipient": { "id": "your-bot-id", "name": "AskHR" },
    "text": "What is the leave policy?"
  }'
```

### Expected log output (handle_teams_message):
```
[handle_teams_message] ===== Inbound Teams activity received =====
[handle_teams_message] Activity type: message
[handle_teams_message] Regular message: "What is the leave policy?"
[handle_teams_message] From: Test User, ConversationId: test-conv-1
[users] Searching DevRev users directory for name="Test User"
[users] Exactly one match found. Email: (resolved)
[handle_teams_message] Enriched message built (xxx chars)
[handle_teams_message] Dispatching to agent: don:core:dvrv-us-1:devo/118bWKFTfx:ai_agent/61
[agent-client] Dispatching to agent ... via execute-async
[agent-client] Agent dispatch successful. Status: 200
[handle_teams_message] ===== Dispatch complete. Exiting. =====
```

### Expected log output (handle_agent_response — triggered async):
```
[handle_agent_response] ===== Agent response received =====
[handle_agent_response] Agent reply (first 200 chars): "According to our leave policy..."
[handle_agent_response] Is greeting: false
[handle_agent_response] Acquiring Bot Framework token...
[teams-client] Bot Framework token acquired successfully
[handle_agent_response] Sending plain text response to Teams
[teams-client] Message sent successfully. Status: 200/201
[handle_agent_response] ===== Reply sent to Teams. Done. =====
```
