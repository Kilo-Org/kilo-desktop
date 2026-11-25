import type { OpenCodeClient } from "@kilocode/client";

/*
 * A Kilo client usable at once whose calls wait for the real one, resolved
 * per call: the runtime needs its client synchronously, while the server's
 * connection may arrive later or change.
 *
 * - A path into the client (`client.session.form`) is not a thenable, or
 *   `await client.session` would try to resolve it; calling it calls the
 *   member with its own namespace as receiver.
 * - A call starts at once (a call nobody awaits still reaches the server)
 *   and gives back a deferred result: awaiting it gives the call's value,
 *   iterating it iterates the value (`event.subscribe` returns its stream
 *   synchronously), and its members are paths into the value
 *   (`client.rpc(definition).method(input)`).
 */
export function createDeferredKiloClient(resolve: () => Promise<OpenCodeClient>): OpenCodeClient {
	return deferredPath(resolve) as OpenCodeClient;
}

type Resolve = () => Promise<unknown>;

function asObject(value: unknown, prop: PropertyKey): object {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) {
		throw new TypeError(`Kilo client property ${String(prop)} is not an object`);
	}
	return value;
}

function member(parent: Resolve, prop: PropertyKey): unknown {
	return deferredPath(async () => Reflect.get(asObject(await parent(), prop), prop), parent);
}

function deferredPath(resolve: Resolve, receiver?: Resolve): unknown {
	const members = new Map<PropertyKey, unknown>();
	return new Proxy(function deferredKiloClientMember() {}, {
		get(_target, prop) {
			if (prop === "then") return undefined;
			let found = members.get(prop);
			if (!found) {
				found = member(resolve, prop);
				members.set(prop, found);
			}
			return found;
		},
		apply(_target, _thisArg, args) {
			return deferredResult(
				(async () => {
					const value = await resolve();
					if (typeof value !== "function") {
						throw new TypeError("Kilo client property is not a function");
					}
					return Reflect.apply(value, receiver ? await receiver() : undefined, args);
				})(),
			);
		},
	});
}

async function* iterate(result: Promise<unknown>): AsyncGenerator<unknown> {
	yield* (await result) as AsyncIterable<unknown>;
}

function deferredResult(result: Promise<unknown>): unknown {
	const parent = () => result;
	return new Proxy(Object.create(null) as object, {
		get(_target, prop) {
			if (prop === "then") return result.then.bind(result);
			if (prop === "catch") return result.catch.bind(result);
			if (prop === "finally") return result.finally.bind(result);
			if (prop === Symbol.asyncIterator) return () => iterate(result);
			return member(parent, prop);
		},
	});
}
