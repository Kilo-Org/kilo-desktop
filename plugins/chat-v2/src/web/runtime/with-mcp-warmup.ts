import type { KiloClient } from "@kilo-desktop/react-opencode-v2";

const PROMPT_METHODS = new Set<PropertyKey>(["prompt", "command", "shell"]);

/** One wrapper per client and directory, so it warms once when first wrapped. */
const wrapped = new WeakMap<KiloClient, Map<string, KiloClient>>();

/**
 * Kilo connects a directory's MCP servers lazily, inside whichever request first
 * needs them, and caches that attempt's outcome for the life of the directory's
 * instance — an interruption included. When the first caller is a prompt, Stop
 * interrupts the connect and every later turn in that directory aborts before
 * reaching the model. Listing the directory's MCP servers first makes a separate
 * request own the connect, so Stop only cancels the turn waiting on it
 * (kilo-vscode warms the same way). Warming again before each prompt covers
 * instances the server has disposed since; once MCP is loaded the list is cheap.
 */
export function withMcpWarmup(client: KiloClient, directory: string): KiloClient {
	let byDirectory = wrapped.get(client);
	if (!byDirectory) {
		byDirectory = new Map();
		wrapped.set(client, byDirectory);
	}
	const existing = byDirectory.get(directory);
	if (existing) return existing;

	const warm = () => {
		try {
			// No abort signal: cancelling this request would re-create the problem.
			void Promise.resolve(client.mcp?.list?.({ location: { directory } })).catch(() => undefined);
		} catch {
			// Warm-up is best effort; the prompt still carries its own errors.
		}
	};
	warm();

	const proxy = new Proxy(client as object, {
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
	byDirectory.set(directory, proxy);
	return proxy;
}
