import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloWorkspaceConnection } from "../../../contracts/chat/schemas.js";
import { createKiloRuntimeClient } from "./create-kilo-runtime-client.js";

export type DeferredKiloRuntimeClient = KiloClient & {
	/** Replace the pending/resolved connection without changing client identity. */
	retarget(connectionPromise: Promise<KiloWorkspaceConnection>): void;
};

/**
 * Stable Kilo client that waits for `connectionPromise` before forwarding
 * any nested SDK calls. Identity stays fixed for the page lifetime so
 * OpenCode's registry/adapter memos do not thrash when the server becomes ready
 * or when the directory target is retargeted (workspace ↔ unscoped).
 */
export function createDeferredKiloRuntimeClient(
	connectionPromise: Promise<KiloWorkspaceConnection>,
): DeferredKiloRuntimeClient {
	const state = {
		ready: connectionPromise.then(createKiloRuntimeClient),
	};
	// Callers still observe rejections via await; attach a handler so a rejected
	// connection does not become an unhandled rejection when the client is unused.
	void state.ready.catch(() => undefined);

	const retarget = (nextPromise: Promise<KiloWorkspaceConnection>) => {
		state.ready = nextPromise.then(createKiloRuntimeClient);
		void state.ready.catch(() => undefined);
	};

	const proxy = createAwaitingProxy(() => state.ready);
	return new Proxy(proxy, {
		get(target, prop, receiver) {
			if (prop === "retarget") return retarget;
			return Reflect.get(target, prop, receiver);
		},
	}) as DeferredKiloRuntimeClient;
}

function createAwaitingProxy(
	getTarget: () => Promise<object>,
	getReceiver?: () => Promise<object>,
): object {
	const cache = new Map<PropertyKey, object>();

	return new Proxy(function deferredKiloClientProperty() {} as object, {
		get(_target, prop) {
			// Avoid being treated as a thenable (would break `await client.foo()`).
			if (prop === "then") {
				return undefined;
			}

			const cached = cache.get(prop);
			if (cached) {
				return cached;
			}

			const nested = createAwaitingProxy(async () => {
				const parent = await getTarget();
				const value = Reflect.get(parent, prop, parent);
				if (value === null || (typeof value !== "object" && typeof value !== "function")) {
					throw new TypeError(`Kilo client property ${String(prop)} is not an object`);
				}
				return value as object;
			}, getTarget);

			cache.set(prop, nested);
			return nested;
		},
		async apply(_target, _thisArg, argArray) {
			const value = await getTarget();
			if (typeof value !== "function") {
				throw new TypeError("Kilo client property is not a function");
			}
			const receiver = getReceiver ? await getReceiver() : undefined;
			return Reflect.apply(value, receiver, argArray);
		},
	});
}
