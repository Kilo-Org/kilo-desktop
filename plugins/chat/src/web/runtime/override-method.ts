type Method = (...args: never[]) => unknown;

/**
 * `client` with `client[namespace][name]` replaced by `replace(original)`;
 * everything else, the namespace's other members included, is the client's
 * own. The namespace's proxy is made once, so it keeps its identity.
 */
export function overrideMethod<T extends object>(
	client: T,
	namespace: string,
	name: string,
	replace: (original: (...args: unknown[]) => unknown) => Method,
): T {
	let wrapped: object | undefined;
	return new Proxy(client, {
		get(target, prop, receiver) {
			const value: unknown = Reflect.get(target, prop, receiver);
			const isNamespace =
				value !== null && (typeof value === "object" || typeof value === "function");
			if (prop !== namespace || !isNamespace) return value;
			wrapped ??= namespaceWith(value as object, name, replace);
			return wrapped;
		},
	});
}

function namespaceWith(
	namespace: object,
	name: string,
	replace: (original: (...args: unknown[]) => unknown) => Method,
): object {
	let method: Method | undefined;
	return new Proxy(namespace, {
		get(target, prop, receiver) {
			const value: unknown = Reflect.get(target, prop, receiver);
			if (prop !== name || typeof value !== "function") return value;
			method ??= replace((...args) => Reflect.apply(value as Method, target, args as never[]));
			return method;
		},
	});
}
