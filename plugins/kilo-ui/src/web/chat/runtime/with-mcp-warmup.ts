import type { KiloClient } from "@kilocode/sdk/v2/client";

const PROMPT_METHODS = new Set<PropertyKey>(["prompt", "promptAsync", "command", "shell"]);

/**
 * Kilo connects a directory's MCP servers lazily, inside whichever request first
 * needs them, and caches that attempt's outcome for the life of the directory's
 * instance — an interruption included. When the first caller is a prompt, Stop
 * interrupts the connect and every later turn in that directory aborts before
 * reaching the model. Asking for MCP status first makes a separate request own
 * the connect, so Stop only cancels the turn waiting on it (kilo-vscode warms the
 * same way). Warming again before each prompt covers instances the server has
 * disposed since; once MCP is loaded the status call is cheap.
 */
export function withMcpWarmup(client: KiloClient): KiloClient {
	const warm = () => {
		try {
			const mcp = (client as Partial<KiloClient>).mcp;
			// No abort signal: cancelling this request would re-create the problem.
			void Promise.resolve(mcp?.status?.()).catch(() => undefined);
		} catch {
			// Warm-up is best effort; the prompt still carries its own errors.
		}
	};
	warm();

	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session" || value === null || typeof value !== "object") return value;
			return new Proxy(value as object, {
				get(sessionTarget, sessionProp, sessionReceiver) {
					const method = Reflect.get(sessionTarget, sessionProp, sessionReceiver);
					if (!PROMPT_METHODS.has(sessionProp) || typeof method !== "function") return method;
					return (...args: unknown[]) => {
						warm();
						return Reflect.apply(method, sessionTarget, args);
					};
				},
			});
		},
	}) as KiloClient;
}
