import type { OpenCodeClient } from "@kilocode/client";

/**
 * Asks for a location's MCP servers (`mcp.list`) before a prompt reaches it.
 * Kilo has connected MCP servers lazily, inside whichever request first
 * needed them, keeping that attempt's outcome, an interruption included: when
 * the first caller was a prompt, Stop interrupted the connect and every later
 * turn there failed before reaching the model. A separate cheap request owns
 * the connect instead, so Stop only cancels the turn waiting on it (kilo-vscode
 * warms the same way). Best effort and never awaited; no abort signal, since
 * cancelling it would re-create the problem.
 */
export function warmMcp(client: Pick<OpenCodeClient, "mcp">, directory: string | undefined): void {
	if (!directory) return;
	try {
		void Promise.resolve(client.mcp.list({ location: { directory } })).catch(() => undefined);
	} catch {
		// The prompt still carries its own errors.
	}
}
