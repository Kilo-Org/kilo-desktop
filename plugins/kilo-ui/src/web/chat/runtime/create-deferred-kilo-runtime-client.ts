import type { KiloClient } from "@kilocode/sdk/v2/client";

export function createDeferredKiloRuntimeClient(clientPromise: Promise<KiloClient>): KiloClient {
	const ready = clientPromise;
	// Callers still observe rejections via await; attach a handler so a rejected
	// client does not become an unhandled rejection when it is unused.
	void ready.catch(() => undefined);
	return createAwaitingProxy(() => ready) as KiloClient;
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
