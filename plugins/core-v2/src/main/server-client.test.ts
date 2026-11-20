import { describe, expect, it, vi } from "vitest";

import { toKiloProfile } from "./account/kilo-client";
import { callRpc, createServerClient, KiloRpcError } from "./server-client";

const CONNECTION = {
	baseUrl: "http://127.0.0.1:4321",
	username: "opencode",
	password: "secret",
	version: "0.0.0-v2-239",
	globalDirectory: "/home",
};

function pluginsAnswer(listed: boolean): Response {
	return Response.json({ location: { directory: "/home" }, data: listed ? [{ id: "kilo" }] : [] });
}

describe("callRpc", () => {
	it("waits for the location's plugins after rpc.unavailable and calls once more", async () => {
		const listings = [false, true];
		const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
			pluginsAnswer(String(input).includes("/api/plugin") ? (listings.shift() ?? true) : true),
		);
		const client = createServerClient(CONNECTION, fetch);
		const call = vi
			.fn()
			.mockRejectedValueOnce({
				type: "rpc.unavailable",
				message: "RPC is unavailable: kilocode.gateway",
			})
			.mockResolvedValueOnce("answer");

		await expect(callRpc(client, "/home", call)).resolves.toBe("answer");
		expect(call).toHaveBeenCalledTimes(2);
		expect(call).toHaveBeenLastCalledWith({ location: { directory: "/home" } });
		expect(
			fetch.mock.calls.filter(([input]) => String(input).includes("/api/plugin")),
		).toHaveLength(2);
	});

	it("turns RPC failures into errors that carry the server's message", async () => {
		const client = createServerClient(CONNECTION, vi.fn());
		const failure = { type: "unauthorized", message: "Not signed in to Kilo Gateway" };

		const error = await callRpc(client, "/home", () => Promise.reject(failure)).catch((e) => e);
		expect(error).toBeInstanceOf(KiloRpcError);
		expect(error).toMatchObject({ type: "unauthorized", message: "Not signed in to Kilo Gateway" });
	});

	it("passes other errors through unchanged", async () => {
		const client = createServerClient(CONNECTION, vi.fn());
		const failure = new TypeError("network down");
		await expect(callRpc(client, "/home", () => Promise.reject(failure))).rejects.toBe(failure);
	});
});

describe("toKiloProfile", () => {
	const profile = {
		email: "person@example.test",
		organizations: [{ id: "team", name: "Team" }],
		hasPersonalAccount: false,
		organizationID: "team",
	};

	it("fills today's profile shape from v2's profile, without balance or Kilo Pass", () => {
		expect(toKiloProfile(profile, null, null)).toEqual({
			profile: {
				email: "person@example.test",
				organizations: [{ id: "team", name: "Team", role: "" }],
				selectedOrganizationId: "team",
				hasPersonalAccount: false,
			},
			balance: null,
			kiloPass: null,
			currentOrgId: "team",
		});
	});

	it("keeps a known balance and Kilo Pass, and drops an unknown balance", () => {
		const kiloPass = {
			currentPeriodBaseCreditsUsd: 50,
			currentPeriodUsageUsd: 12.25,
			currentPeriodBonusCreditsUsd: 5,
			nextBillingAt: null,
		};
		expect(toKiloProfile(profile, { balance: 3 }, kiloPass)).toMatchObject({
			balance: { balance: 3 },
			kiloPass,
		});
		expect(toKiloProfile(profile, { balance: null }, null).balance).toBeNull();
	});
});
