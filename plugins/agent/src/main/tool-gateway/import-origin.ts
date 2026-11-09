import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { KvStore } from "@kilo-desktop/kernel";

import type { ExternalClientsSettings } from "./external-clients.js";

export type PersistedExternalClients = ExternalClientsSettings & { importedFromOrigin: boolean };

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
	let raw: string;
	try {
		raw = await readFile(originFile, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		store.set({ importedFromOrigin: true });
		return;
	}
	const origin = originSettingsSchema.parse(JSON.parse(raw));
	const current = store.snapshot();
	const known = new Set(current.clients.map((client) => client.id));
	store.set({
		enabled: current.enabled || origin.enabled,
		port: current.port ?? origin.port,
		clients: [
			...current.clients,
			...origin.clients
				.filter((client) => !known.has(client.id))
				.map(({ lastUsedAt, ...client }) => (lastUsedAt ? { ...client, lastUsedAt } : client)),
		],
		importedFromOrigin: true,
	});
}
