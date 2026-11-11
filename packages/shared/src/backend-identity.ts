import type { AppConfiguration } from "./app-config";

export function assertBackendIdentity(
  value: unknown,
  app: AppConfiguration,
  genesis: string,
) {
  const identity = value as Record<string, unknown> | null;
  if (
    !identity ||
    identity.version !== 1 ||
    identity.cluster !== app.cluster ||
    identity.programId !== app.programId ||
    identity.mint !== app.tokenMint ||
    identity.genesisHash !== genesis
  )
    throw new Error("Backend deployment identity mismatch");
}

export async function checkBackendIdentity(
  app: AppConfiguration,
  genesis: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${app.apiUrl}/api/deployment`, {
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error("Backend deployment identity unavailable");
    assertBackendIdentity(await response.json(), app, genesis);
  } finally {
    clearTimeout(timeout);
  }
}
