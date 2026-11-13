import { getKeyringSecret, redactEventForLog } from "../src/devrev/keyrings";

describe("getKeyringSecret", () => {
  it("reads plain string secrets from input_data.keyrings (live DevRev Lambda format)", () => {
    const event = {
      input_data: {
        keyrings: {
          askhr_agent_id: "  don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134  ",
          agent_response_webhook_id: "don:integration:dvrv-in-1:devo/2gW4bQiSjj:webhook/fVlm7HlH",
        },
      },
    };

    expect(getKeyringSecret(event, "askhr_agent_id", "askhr-agent-id")).toBe(
      "don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134"
    );
    expect(
      getKeyringSecret(event, "agent_response_webhook_id", "agent-response-webhook-id")
    ).toBe("don:integration:dvrv-in-1:devo/2gW4bQiSjj:webhook/fVlm7HlH");
  });

  it("reads { secret } object entries from input_data.keyrings (local fixture format)", () => {
    const event = {
      input_data: {
        keyrings: {
          "teams-app-secret": { secret: "app-secret-123" },
          "askhr-agent-id": { secret: "don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134" },
        },
      },
    };

    expect(getKeyringSecret(event, "teams-app-secret")).toBe("app-secret-123");
    expect(getKeyringSecret(event, "askhr_agent_id", "askhr-agent-id")).toBe(
      "don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134"
    );
  });

  it("falls back to input_data.resources.keyrings[name].secret when direct keyrings entry is empty or missing", () => {
    const event = {
      input_data: {
        keyrings: {
          askhr_agent_id: "   ",
        },
        resources: {
          keyrings: {
            askhr_agent_id: {
              id: "don:integration:dvrv-in-1:devo/2gW4bQiSjj:keyring/1",
              secret: "don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134",
              type_id: "snap_in_secret",
            },
          },
        },
      },
    };

    expect(getKeyringSecret(event, "askhr_agent_id", "askhr-agent-id")).toBe(
      "don:core:dvrv-in-1:devo/2gW4bQiSjj:ai_agent/134"
    );
  });

  it("returns empty string when event or keyrings are missing", () => {
    expect(getKeyringSecret(undefined, "askhr_agent_id")).toBe("");
    expect(getKeyringSecret({}, "askhr_agent_id")).toBe("");
    expect(getKeyringSecret({ input_data: { keyrings: {} } }, "askhr_agent_id")).toBe("");
  });
});

describe("redactEventForLog", () => {
  it("masks plain string keyrings, resource keyrings, and context.secrets without mutating the input", () => {
    const original = {
      input_data: {
        keyrings: {
          "teams-app-secret": "super-secret-password",
          devrev_pat: "eyJhbGciOi...",
          empty_key: "",
        },
        resources: {
          keyrings: {
            "teams-app-secret": {
              id: "keyring/1",
              secret: "super-secret-password",
              type_id: "snap_in_secret",
            },
          },
        },
      },
      context: {
        dev_oid: "DEV-2gW4bQiSjj",
        secrets: {
          service_account_token: "sa-jwt-secret",
        },
      },
    };

    const safe = redactEventForLog(original);

    expect(safe.input_data.keyrings["teams-app-secret"]).toBe("***REDACTED***");
    expect(safe.input_data.keyrings.devrev_pat).toBe("***REDACTED***");
    expect(safe.input_data.keyrings.empty_key).toBe("");
    expect(safe.input_data.resources.keyrings["teams-app-secret"].secret).toBe("***REDACTED***");
    expect(safe.input_data.resources.keyrings["teams-app-secret"].id).toBe("keyring/1");
    expect(safe.context.secrets.service_account_token).toBe("***REDACTED***");
    expect(safe.context.dev_oid).toBe("DEV-2gW4bQiSjj");

    // Verify original event was not mutated
    expect(original.input_data.keyrings["teams-app-secret"]).toBe("super-secret-password");
    expect(original.input_data.resources.keyrings["teams-app-secret"].secret).toBe(
      "super-secret-password"
    );
    expect(original.context.secrets.service_account_token).toBe("sa-jwt-secret");
  });
});

