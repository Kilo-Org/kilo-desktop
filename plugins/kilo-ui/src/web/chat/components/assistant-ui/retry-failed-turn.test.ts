import { describe, expect, it, vi } from "vitest";

import { retryFailedTurn } from "./retry-failed-turn.js";

const promptAsync = vi.hoisted(() => vi.fn(async () => ({ data: undefined })));

vi.mock("../../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: () => ({ session: { promptAsync } }),
}));

describe("retryFailedTurn", () => {
	it("re-prompts the original message in place and waits for slow snapshots", async () => {
		await retryFailedTurn({
			connection: {
				baseUrl: "http://kilo",
				username: "u",
				password: "p",
				version: "7.7.6",
				globalDirectory: "/global",
			},
			sessionID: "s1",
			directory: "/repo",
			messageID: "m1",
			model: { providerID: "kilo", modelID: "auto" },
		});

		expect(promptAsync).toHaveBeenCalledWith(
			{
				sessionID: "s1",
				messageID: "m1",
				parts: [],
				model: { providerID: "kilo", modelID: "auto" },
				snapshotInitialization: "wait",
			},
			{ throwOnError: true },
		);
	});
});
