import type { KiloClient } from "@kilocode/sdk/v2/client";

import { hasAnacondaSessionMetadata } from "../session-activity/session-activity-logic.js";

/**
 * Filters `experimental.session.list` to sessions stamped with Anaconda metadata
 * so the thread-list adapter (and activity hydration) ignore Kilo CLI sessions.
 */
export function withAnacondaSessionListFilter(client: KiloClient): KiloClient {
	return new Proxy(client as object, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (prop !== "experimental") return value;
			if (value === null || (typeof value !== "object" && typeof value !== "function")) {
				return value;
			}
			return new Proxy(value as object, {
				get(experimentalTarget, experimentalProp, experimentalReceiver) {
					const experimentalValue = Reflect.get(
						experimentalTarget,
						experimentalProp,
						experimentalReceiver,
					);
					if (experimentalProp !== "session") return experimentalValue;
					if (
						experimentalValue === null ||
						(typeof experimentalValue !== "object" && typeof experimentalValue !== "function")
					) {
						return experimentalValue;
					}
					return new Proxy(experimentalValue as object, {
						get(sessionTarget, sessionProp, sessionReceiver) {
							const sessionValue = Reflect.get(sessionTarget, sessionProp, sessionReceiver);
							if (sessionProp !== "list" || typeof sessionValue !== "function") {
								return sessionValue;
							}
							return async (...args: unknown[]) => {
								const response = (await Reflect.apply(sessionValue, sessionTarget, args)) as {
									data?: Array<{ metadata?: unknown }> | undefined;
								};
								const data = response.data ?? [];
								return {
									...response,
									data: data.filter((session) => hasAnacondaSessionMetadata(session.metadata)),
								};
							};
						},
					});
				},
			});
		},
	}) as KiloClient;
}
