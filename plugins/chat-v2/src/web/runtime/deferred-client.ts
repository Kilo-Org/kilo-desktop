import type { KiloClient } from "@kilo-desktop/react-opencode-v2";

/**
 * A Kilo client usable at once whose calls wait for the real one, resolved
 * per call: the runtime needs its clients synchronously, while the server's
 * connection (and a chat's directory) may arrive later or change.
 */
export function createDeferredKiloClient(resolve: () => Promise<KiloClient>): KiloClient {
	return awaitingProxy(resolve) as KiloClient;
}

function awaitingProxy(getTarget: () => Promise<object>, getReceiver?: () => Promise<object>) {
	const cache = new Map<PropertyKey, object>();
	return new Proxy(function deferredKiloClientProperty() {} as object, {
		get(_target, prop) {
			// Not a thenable, or `await client.foo` would try to resolve it.
			if (prop === "then") return undefined;
			const cached = cache.get(prop);
			if (cached) return cached;
			const nested = awaitingProxy(async () => {
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
		async apply(_target, _thisArg, args) {
			const value = await getTarget();
			if (typeof value !== "function")
				throw new TypeError("Kilo client property is not a function");
			const receiver = getReceiver ? await getReceiver() : undefined;
			return Reflect.apply(value, receiver, args);
		},
	});
}
