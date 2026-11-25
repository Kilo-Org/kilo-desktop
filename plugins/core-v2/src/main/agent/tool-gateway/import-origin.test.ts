import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { DEFAULT_EXTERNAL_CLIENTS_SETTINGS } from "./external-clients";
import { importOriginExternalClients, type PersistedExternalClients } from "./import-origin";

const HASH = "a".repeat(64);
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function originFile(contents?: string): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "kilo-server-origin-"));
	directories.push(dir);
	const file = path.join(dir, "external-clients.json");
	if (contents !== undefined) await writeFile(file, contents);
	return file;
}

function store(initial: Partial<PersistedExternalClients> = {}) {
	const kv = createMemoryStorage().kv<PersistedExternalClients>({
		namespace: "external-clients",
		defaults: {
			...DEFAULT_EXTERNAL_CLIENTS_SETTINGS,
			importedFromOrigin: false,
		},
	});
	kv.set(initial);
	return kv;
}

const originClient = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	name: `App ${id}`,
	tokenHash: HASH,
	createdAt: "2026-10-01T00:00:00.000Z",
	...extra,
});

describe("importOriginExternalClients", () => {
	it("adopts origin's switch, port and paired apps once", async () => {
		const file = await originFile(
			JSON.stringify({
				enabled: true,
				port: 9400,
				clients: [originClient("a", { lastUsedAt: "2026-10-02T00:00:00.000Z" })],
			}),
		);
		const kv = store();

		await importOriginExternalClients(kv, file);

		expect(kv.snapshot()).toEqual({
			enabled: true,
			port: 9400,
			clients: [originClient("a", { lastUsedAt: "2026-10-02T00:00:00.000Z" })],
			importedFromOrigin: true,
		});

		await writeFile(file, JSON.stringify({ enabled: false, clients: [originClient("b")] }));
		await importOriginExternalClients(kv, file);
		expect(kv.get("clients").map((client) => client.id)).toEqual(["a"]);
	});

	it("keeps what is already here, adding only origin's other apps", async () => {
		const file = await originFile(
			JSON.stringify({
				enabled: false,
				port: 9400,
				clients: [originClient("a"), originClient("b")],
			}),
		);
		const kv = store({ enabled: true, port: 9500, clients: [originClient("a", { name: "Mine" })] });

		await importOriginExternalClients(kv, file);

		expect(kv.snapshot()).toMatchObject({
			enabled: true,
			port: 9500,
			clients: [{ id: "a", name: "Mine" }, { id: "b" }],
		});
	});

	it("counts a missing file as imported", async () => {
		const kv = store();

		await importOriginExternalClients(kv, await originFile());

		expect(kv.snapshot()).toEqual({
			...DEFAULT_EXTERNAL_CLIENTS_SETTINGS,
			importedFromOrigin: true,
		});
	});

	it("leaves an unreadable file for the next attempt", async () => {
		const kv = store();

		await expect(importOriginExternalClients(kv, await originFile("{ not json"))).rejects.toThrow();
		await expect(
			importOriginExternalClients(kv, await originFile(JSON.stringify({ clients: [{ id: "x" }] }))),
		).rejects.toThrow();

		expect(kv.get("importedFromOrigin")).toBe(false);
	});
});
