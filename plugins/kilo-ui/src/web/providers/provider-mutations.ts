import {
	isCustomProviderPackage,
	sanitizeCustomProviderConfig,
	validateProviderID,
	withCustomProviderDeletions,
	resolveCustomProviderAuth,
	type SanitizedProviderConfig,
} from "./custom-provider.js";

export type GlobalConfigSnapshot = {
	disabled_providers?: string[];
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

function without(list: string[] | undefined, id: string): string[] {
	return (list ?? []).filter((item) => item !== id);
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
	await client.auth.remove({ providerID: id }, { throwOnError: true }).catch((error: unknown) => {
		if (!custom) throw error instanceof Error ? error : new Error(`Failed to disconnect ${id}`);
	});
	if (custom) {
		await client.global.config.update(
			{
				config: {
					provider: { [id]: null },
					disabled_providers: without(global.disabled_providers, id),
				},
			},
			{ throwOnError: true },
		);
	}
	await dispose(client);
}

export async function setDisabled(
	client: KiloProviderClient,
	providerID: string,
	disabled: boolean,
): Promise<void> {
	const id = requireId(providerID);
	const global = await readGlobal(client);
	const current = global.disabled_providers ?? [];
	const next = disabled
		? current.includes(id)
			? current
			: [...current, id]
		: without(current, id);
	if (next.length === current.length && next.every((item, index) => item === current[index])) {
		await dispose(client);
		return;
	}
	await client.global.config.update(
		{ config: { disabled_providers: next } },
		{ throwOnError: true },
	);
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
	await client.global.config.update(
		{
			config: {
				provider: { [id]: patch as SanitizedProviderConfig },
				disabled_providers: without(global.disabled_providers, id),
			},
		},
		{ throwOnError: true },
	);

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
	await dispose(client);
}

export async function deleteCustom(client: KiloProviderClient, providerID: string): Promise<void> {
	const id = requireId(providerID);
	const global = await readGlobal(client);
	await client.global.config.update(
		{
			config: {
				provider: { [id]: null },
				disabled_providers: without(global.disabled_providers, id),
			},
		},
		{ throwOnError: true },
	);
	await client.auth.remove({ providerID: id }, { throwOnError: true }).catch(() => undefined);
	await dispose(client);
}
