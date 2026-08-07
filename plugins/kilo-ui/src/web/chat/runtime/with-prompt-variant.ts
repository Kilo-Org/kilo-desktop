import type { KiloClient } from "@kilocode/sdk/v2/client";

/**
 * Wraps a Kilo client so `session.prompt` / `session.promptAsync` receive the
 * current reasoning `variant` (effort level) on every send.
 */
export function withPromptVariant(
	client: KiloClient,
	getVariant: () => string | undefined,
): KiloClient {
	const injectVariant = <T extends Record<string, unknown>>(args: T): T => {
		const variant = getVariant();
		if (variant === undefined || args.variant !== undefined) {
			return args;
		}
		return { ...args, variant };
	};

	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "session") {
				return value;
			}
			if (value === null || (typeof value !== "object" && typeof value !== "function")) {
				return value;
			}
			return new Proxy(value as object, {
				get(sessionTarget, sessionProp, sessionReceiver) {
					const sessionValue = Reflect.get(sessionTarget, sessionProp, sessionReceiver);
					if (
						(sessionProp === "prompt" || sessionProp === "promptAsync") &&
						typeof sessionValue === "function"
					) {
						return (args: Record<string, unknown>, ...rest: unknown[]) =>
							Reflect.apply(sessionValue, sessionTarget, [injectVariant(args), ...rest]);
					}
					return sessionValue;
				},
			});
		},
	}) as KiloClient;
}
