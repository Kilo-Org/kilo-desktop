import type { KiloClient } from "@kilocode/sdk/v2/client";

export type PromptModelRef = {
	providerID: string;
	modelID: string;
};

export type PromptOptionGetters = {
	getVariant?: () => string | undefined;
	getAgent?: () => string | undefined;
	getModel?: () => PromptModelRef | undefined;
};

/**
 * Wraps a Kilo client so `session.prompt` / `session.promptAsync` receive the
 * latest composer selection on every send.
 *
 * Agent and model are always overwritten when getters return a value —
 * RemoteThreadList can keep a stale `defaultAgent` / `defaultModel` closed
 * over in `onNew`. Variant only fills in when unset (explicit request wins).
 */
export function withPromptOptions(client: KiloClient, getters: PromptOptionGetters): KiloClient {
	const injectPromptOptions = <T extends Record<string, unknown>>(args: T): T => {
		let next: Record<string, unknown> = args;

		const variant = getters.getVariant?.();
		if (variant !== undefined && next.variant === undefined) {
			next = { ...next, variant };
		}

		const agent = getters.getAgent?.();
		if (agent !== undefined) {
			next = { ...next, agent };
		}

		const model = getters.getModel?.();
		if (model !== undefined) {
			next = { ...next, model };
		}

		return next as T;
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
							Reflect.apply(sessionValue, sessionTarget, [injectPromptOptions(args), ...rest]);
					}
					return sessionValue;
				},
			});
		},
	}) as KiloClient;
}
