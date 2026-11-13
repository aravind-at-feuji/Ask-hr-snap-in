const REDACTED = "***REDACTED***";

/**
 * Extracts a secret value from a keyring entry stored either as a plain string
 * (live DevRev Lambda runtime) or as an object with a `secret` property
 * (`input_data.resources.keyrings` or local test fixtures).
 */
function readSecretEntry(entry: unknown): string {
  if (typeof entry === "string") {
    return entry.trim();
  }
  if (entry && typeof entry === "object" && "secret" in entry) {
    const { secret } = entry as { secret?: unknown };
    return typeof secret === "string" ? secret.trim() : "";
  }
  return "";
}

/**
 * Resolves the first non-empty trimmed secret across candidate keyring names,
 * checking `event.input_data.keyrings` first and falling back to
 * `event.input_data.resources.keyrings`.
 */
export function getKeyringSecret(event: any, ...names: string[]): string {
  const keyrings = event?.input_data?.keyrings as Record<string, unknown> | undefined;
  const resourceKeyrings = event?.input_data?.resources?.keyrings as
    | Record<string, unknown>
    | undefined;

  for (const name of names) {
    const direct = readSecretEntry(keyrings?.[name]);
    if (direct) {
      return direct;
    }
    const resource = readSecretEntry(resourceKeyrings?.[name]);
    if (resource) {
      return resource;
    }
  }

  return "";
}

/**
 * Masks string and object entries inside a keyring map without mutating the source map.
 */
function redactKeyringMap(map: unknown): Record<string, unknown> | unknown {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return map;
  }
  const safeMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (typeof v === "string") {
      safeMap[k] = v ? REDACTED : "";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      safeMap[k] = {
        ...obj,
        secret: obj["secret"] ? REDACTED : undefined,
      };
    } else {
      safeMap[k] = v;
    }
  }
  return safeMap;
}

/**
 * Returns a shallow-cloned copy of a DevRev snap-in event with secrets masked
 * across `input_data.keyrings`, `input_data.resources.keyrings`, and `context.secrets`.
 */
export function redactEventForLog(event: any): any {
  if (!event || typeof event !== "object") {
    return event;
  }

  const safeEvent = { ...event };

  if (safeEvent.input_data && typeof safeEvent.input_data === "object") {
    const safeInputData = { ...safeEvent.input_data };

    if (safeInputData.keyrings) {
      safeInputData.keyrings = redactKeyringMap(safeInputData.keyrings);
    }

    if (safeInputData.resources && typeof safeInputData.resources === "object") {
      const safeResources = { ...safeInputData.resources };
      if (safeResources.keyrings) {
        safeResources.keyrings = redactKeyringMap(safeResources.keyrings);
      }
      safeInputData.resources = safeResources;
    }

    safeEvent.input_data = safeInputData;
  }

  if (safeEvent.context && typeof safeEvent.context === "object") {
    const safeContext = { ...safeEvent.context };
    if (safeContext.secrets && typeof safeContext.secrets === "object") {
      const safeSecrets: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(safeContext.secrets as Record<string, unknown>)) {
        safeSecrets[k] = v ? REDACTED : v;
      }
      safeContext.secrets = safeSecrets;
    }
    safeEvent.context = safeContext;
  }

  return safeEvent;
}

