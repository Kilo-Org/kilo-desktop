import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerClient } from "../server-client";
import { bundledKiloExecutable, startRealKilo2, type RealKilo2 } from "../../test/real-kilo2";
import { applyWorkStyle, findConflictingPermissionKeys } from "./apply-work-style";
import type { KiloWorkStyleClient } from "./apply-work-style";
import { createKiloWorkStyleClient } from "./production";
import { REVIEW_FIRST_RULES } from "./work-style-presets";

const kiloExecutable = bundledKiloExecutable();

describe.skipIf(!kiloExecutable)("the work style on the bundled kilo2", () => {
	let server: RealKilo2;
	let client: KiloWorkStyleClient;

	beforeEach(async () => {
		server = await startRealKilo2(kiloExecutable!);
		client = createKiloWorkStyleClient(server.connection);
	});

	afterEach(async () => {
		await server.stop();
	});

	it("writes Review first as v2 permission rules the server loads, and restores them", async () => {
		await client.writeGlobalPermissions([{ action: "shell", resource: "*", effect: "allow" }]);
		await expect(findConflictingPermissionKeys(client)).resolves.toEqual(["shell"]);

		const { applied } = await applyWorkStyle(client, "human-in-the-loop", null);
		await expect(client.readGlobalPermissions()).resolves.toEqual(REVIEW_FIRST_RULES);

		// v2's config watcher picks the write up shortly after it lands.
		const api = createServerClient(server.connection);
		await vi.waitFor(async () => {
			const entries = await api.config.get({
				location: { directory: server.connection.globalDirectory },
			});
			const global = entries.find(
				(entry) => entry.type === "document" && entry.path?.startsWith(server.configDirectory),
			);
			expect(global?.type === "document" && global.info.permissions).toEqual(REVIEW_FIRST_RULES);
		});

		await applyWorkStyle(client, "autonomous", applied);
		await expect(client.readGlobalPermissions()).resolves.toEqual([
			{ action: "shell", resource: "*", effect: "allow" },
		]);
	});
});
