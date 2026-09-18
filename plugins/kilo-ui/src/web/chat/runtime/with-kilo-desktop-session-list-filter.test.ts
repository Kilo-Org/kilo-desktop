import { describe, expect, it, vi } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import { withKiloDesktopSessionListFilter } from "./with-kilo-desktop-session-list-filter.js";

describe("withKiloDesktopSessionListFilter", () => {
	it("keeps sessions stamped with current or pre-rename Desktop metadata", async () => {
		const list = vi.fn(async () => ({
			data: [
				{ id: "owned", metadata: { "kilo-desktop": {} } },
				{ id: "workspace", metadata: { "kilo-desktop": { workspaceId: "ws-1" } } },
				{ id: "pre-rename", metadata: { anaconda: {} } },
				{ id: "cli", metadata: { other: true } },
				{ id: "bare" },
			],
			meta: { ok: true },
		}));
		const client = {
			experimental: { session: { list } },
			session: { get: vi.fn() },
		} as unknown as KiloClient;

		const filtered = withKiloDesktopSessionListFilter(client);
		const response = await filtered.experimental.session.list({ roots: true });

		expect(list).toHaveBeenCalledWith({ roots: true });
		expect(response).toEqual({
			data: [
				{ id: "owned", metadata: { "kilo-desktop": {} } },
				{ id: "workspace", metadata: { "kilo-desktop": { workspaceId: "ws-1" } } },
				{ id: "pre-rename", metadata: { anaconda: {} } },
			],
			meta: { ok: true },
		});
		expect(filtered.session.get).toBe(client.session.get);
	});
});
