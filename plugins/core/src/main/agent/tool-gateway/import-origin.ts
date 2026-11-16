import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { KvStore } from "@kilo-desktop/kernel";

import type { ExternalClientsSettings } from "./external-clients.js";

export type PersistedExternalClients = ExternalClientsSettings & {
	importedFromOrigin: boolean;
	/** kilo.agent's saved apps were adopted (or there were none). */
	importedFromKiloAgent: boolean;
};

const originSettingsSchema = z.object({
	enabled: z.boolean().default(false),
	port: z.number().int().min(1024).max(65535).nullable().default(null),
	clients: z
		.array(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1),
				tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
				createdAt: z.string().min(1),
				lastUsedAt: z.string().min(1).optional(),
			}),
		)
		.default([]),
});

const kiloAgentSettingsSchema = originSettingsSchema.extend({
	importedFromOrigin: z.boolean().default(false),
});

type SavedSettings = z.output<typeof originSettingsSchema>;

async function readSaved(file: string): Promise<string | undefined> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** Saved apps added beside the store's; the saved switch and port apply only over defaults. */
function merged(store: KvStore<PersistedExternalClients>, saved: SavedSettings) {
	const current = store.snapshot();
	const known = new Set(current.clients.map((client) => client.id));
	return {
		enabled: current.enabled || saved.enabled,
		port: current.port ?? saved.port,
		clients: [
			...current.clients,
			...saved.clients
				.filter((client) => !known.has(client.id))
				.map(({ lastUsedAt, ...client }) => (lastUsedAt ? { ...client, lastUsedAt } : client)),
		],
	};
}

/**
 * Adopts kilo.agent's saved external AI apps (its `external-clients` kv
 * file, moved into kilo.core's storage with the rest of its folder) once,
 * with whether it had already adopted origin's. A missing file counts as
 * adopted; an unreadable one is retried next launch.
 */
export async function importKiloAgentExternalClients(
	store: KvStore<PersistedExternalClients>,
	file: string,
): Promise<void> {
	if (store.get("importedFromKiloAgent")) return;
	const raw = await readSaved(file);
	if (raw === undefined) {
		store.set({ importedFromKiloAgent: true });
		return;
	}
	const saved = kiloAgentSettingsSchema.parse(JSON.parse(raw));
	store.set({
		...merged(store, saved),
		importedFromOrigin: store.get("importedFromOrigin") || saved.importedFromOrigin,
		importedFromKiloAgent: true,
	});
}

/**
 * Adopts the external AI apps origin saved (`external-clients.json` in its
 * kilo-server storage) once: its paired apps are added beside any already
 * here, and its switch and port apply only where they're still the defaults.
 * A missing file counts as imported; an unreadable one is retried next launch.
 */
export async function importOriginExternalClients(
	store: KvStore<PersistedExternalClients>,
	originFile: string,
): Promise<void> {
	if (store.get("importedFromOrigin")) return;
	const raw = await readSaved(originFile);
	if (raw === undefined) {
		store.set({ importedFromOrigin: true });
		return;
	}
	store.set({
		...merged(store, originSettingsSchema.parse(JSON.parse(raw))),
		importedFromOrigin: true,
	});
}
