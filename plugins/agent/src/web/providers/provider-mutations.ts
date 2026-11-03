import {
	isCustomProviderPackage,
	sanitizeCustomProviderConfig,
	validateProviderID,
	withCustomProviderDeletions,
	resolveCustomProviderAuth,
	type SanitizedProviderConfig,
} from "./custom-provider";

export type GlobalConfigSnapshot = {
	provider?: Record<string, unknown>;
};

export type KiloProviderClient = {
	auth: {
		set(
			input: { providerID: string; auth: { type: "api"; key: string } },
			opts?: { throwOnError: true },
		): Promise<unknown>;
		remove(input: { providerID: string }, opts?: { throwOnError: true }): Promise<unknown>;
	};
	global: {
		dispose(): Promise<unknown>;
		config: {
			get(opts?: { throwOnError: true }): Promise<{ data?: GlobalConfigSnapshot | null }>;
			update(
				input: { config: GlobalConfigSnapshot },
				opts?: { throwOnError: true },
			): Promise<{ data?: unknown }>;
		};
	};
};

function requireId(providerID: string): string {
	const result = validateProviderID(providerID);
	if ("error" in result) throw new Error(result.error);
	return result.value;
}

async function readGlobal(client: KiloProviderClient): Promise<GlobalConfigSnapshot> {
	const { data } = await client.global.config.get({ throwOnError: true });
	return data ?? {};
}

async function dispose(client: KiloProviderClient): Promise<void> {
	await client.global.dispose();
}

export async function connectApiKey(
	client: KiloProviderClient,
	providerID: string,
	apiKey: string,
): Promise<void> {
	const id = requireId(providerID);
	const key = apiKey.trim();
	if (!key) throw new Error("API key is required");
	await client.auth.set({ providerID: id, auth: { type: "api", key } }, { throwOnError: true });
	await dispose(client);
}

function isCustomEntry(value: unknown): boolean {
	return (
		!!value &&
		typeof value === "object" &&
		isCustomProviderPackage((value as { npm?: unknown }).npm)
	);
}

export async function disconnectProvider(
	client: KiloProviderClient,
	providerID: string,
): Promise<void> {
	const id = requireId(providerID);
	const global = await readGlobal(client);
	const custom = isCustomEntry(global.provider?.[id]);
	await client.auth.remove({ providerID: id }, { throwOnError: true });
	if (custom) {
		await client.global.config.update(
			{ config: { provider: { [id]: null } } },
			{ throwOnError: true },
		);
	}
	await dispose(client);
}

export async function saveCustom(
	client: KiloProviderClient,
	providerID: string,
	provider: unknown,
	apiKey: string | undefined,
	apiKeyChanged: boolean,
): Promise<void> {
	const id = requireId(providerID);
	const sanitized = sanitizeCustomProviderConfig(provider);
	if ("error" in sanitized) throw new Error(sanitized.error);

	const global = await readGlobal(client);
	const existing = global.provider?.[id];
	const patch = withCustomProviderDeletions(existing, sanitized.value);

	const auth = resolveCustomProviderAuth(apiKey, apiKeyChanged);
	if (auth.mode === "set") {
		await client.auth.set(
			{ providerID: id, auth: { type: "api", key: auth.key } },
			{ throwOnError: true },
		);
	}
	if (auth.mode === "clear") {
		await client.auth.remove({ providerID: id }, { throwOnError: true });
	}

	await client.global.config.update(
		{
			config: {
				provider: { [id]: patch as SanitizedProviderConfig },
			},
		},
		{ throwOnError: true },
	);
	await dispose(client);
}

export async function deleteCustom(client: KiloProviderClient, providerID: string): Promise<void> {
	const id = requireId(providerID);
	await client.auth.remove({ providerID: id }, { throwOnError: true });
	await client.global.config.update(
		{ config: { provider: { [id]: null } } },
		{ throwOnError: true },
	);
	await dispose(client);
}
