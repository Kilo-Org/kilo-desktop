import { describe, expect, it, vi } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import { withAnacondaSessionListFilter } from "./with-anaconda-session-list-filter.js";

describe("withAnacondaSessionListFilter", () => {
	it("keeps only sessions stamped with anaconda metadata", async () => {
		const list = vi.fn(async () => ({
			data: [
				{ id: "owned", metadata: { anaconda: {} } },
				{ id: "workspace", metadata: { anaconda: { workspaceId: "ws-1" } } },
				{ id: "legacy", metadata: { "anaconda.workspaceId": "ws-legacy" } },
				{ id: "cli", metadata: { other: true } },
				{ id: "bare" },
			],
			meta: { ok: true },
		}));
		const client = {
			experimental: { session: { list } },
			session: { get: vi.fn() },
		} as unknown as KiloClient;

		const filtered = withAnacondaSessionListFilter(client);
		const response = await filtered.experimental.session.list({ roots: true });

		expect(list).toHaveBeenCalledWith({ roots: true });
		expect(response).toEqual({
			data: [
				{ id: "owned", metadata: { anaconda: {} } },
				{ id: "workspace", metadata: { anaconda: { workspaceId: "ws-1" } } },
				{ id: "legacy", metadata: { "anaconda.workspaceId": "ws-legacy" } },
			],
			meta: { ok: true },
		});
		expect(filtered.session.get).toBe(client.session.get);
	});
});
