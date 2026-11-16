import { describe, expect, it, vi } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";

import { AutoApprove, type ApprovalMode } from "../contracts";
import { TEST_MODELS } from "../test/fake-core";
import { renderInKernel } from "../test/kernel-harness";
import {
	AUTO_APPROVE_HANDED_OVER_KEY,
	handOverLegacyChoices,
	LEGACY_AUTO_APPROVE_KEY,
	LEGACY_MODEL_FAVORITES_KEY,
	MODEL_FAVORITES_HANDED_OVER_KEY,
} from "./legacy-hand-over";

function memoryStorage(
	values: Record<string, string>,
): Storage & { values: Record<string, string> } {
	return {
		values,
		getItem: (key: string) => values[key] ?? null,
		setItem: (key: string, value: string) => {
			values[key] = value;
		},
	} as unknown as Storage & { values: Record<string, string> };
}

/** kilo.chat's `auto-approve` in main, recording `setMode`. */
function autoApproveMain(fail = false) {
	const setMode = vi.fn<(mode: ApprovalMode) => void>();
	const entry = definePlugin({
		activate(sdk) {
			const provider = sdk.domainObjects.provide(AutoApprove, {
				initialState: { mode: "manual", holding: [] },
				methods: {
					setMode: ({ mode }) => {
						setMode(mode);
						if (fail) throw new Error("No.");
						provider.setState({ ...provider.state, mode });
					},
				},
			});
		},
	});
	return { entry, setMode };
}

async function handOver(storage: Storage, options: { fail?: boolean } = {}) {
	const autoApprove = autoApproveMain(options.fail);
	const host = await renderInKernel(null, {
		chatMain: autoApprove.entry,
		chatWeb: definePlugin({ activate: (sdk) => handOverLegacyChoices(sdk, storage) }),
		core: {
			models: {
				...TEST_MODELS,
				preferences: {
					...TEST_MODELS.preferences,
					favorites: [{ aiProviderId: "acme", modelId: "fast-1" }],
				},
			},
		},
	});
	return { host, setMode: autoApprove.setMode };
}

describe("handing origin's choices over", () => {
	it("hands origin's approval mode and favourites over once, adding only new favourites", async () => {
		const storage = memoryStorage({
			[LEGACY_AUTO_APPROVE_KEY]: "true",
			[LEGACY_MODEL_FAVORITES_KEY]: JSON.stringify([
				{ providerID: "acme", modelID: "fast-1" },
				{ providerID: "acme", modelID: "deep-2" },
				{ providerID: "", modelID: "bad" },
				"junk",
			]),
		});
		const { host, setMode } = await handOver(storage);

		await vi.waitFor(() => expect(storage.values[MODEL_FAVORITES_HANDED_OVER_KEY]).toBe("1"));
		await vi.waitFor(() => expect(storage.values[AUTO_APPROVE_HANDED_OVER_KEY]).toBe("1"));
		expect(setMode).toHaveBeenCalledWith("auto");
		expect(host.core.calls.setFavorite).toHaveBeenCalledTimes(1);
		expect(host.core.models().state.preferences.favorites).toEqual([
			{ aiProviderId: "acme", modelId: "fast-1" },
			{ aiProviderId: "acme", modelId: "deep-2" },
		]);

		const again = await handOver(storage);
		await host.main.flush();
		expect(again.setMode).not.toHaveBeenCalled();
		expect(again.host.core.calls.setFavorite).not.toHaveBeenCalled();
	});

	it("hands over Manual, and nothing when origin kept nothing", async () => {
		const manual = memoryStorage({ [LEGACY_AUTO_APPROVE_KEY]: "false" });
		const first = await handOver(manual);
		await vi.waitFor(() => expect(first.setMode).toHaveBeenCalledWith("manual"));
		expect(first.host.core.calls.setFavorite).not.toHaveBeenCalled();

		const none = memoryStorage({ [LEGACY_MODEL_FAVORITES_KEY]: "not json" });
		const second = await handOver(none);
		await second.host.main.flush();
		expect(second.setMode).not.toHaveBeenCalled();
		expect(none.values[AUTO_APPROVE_HANDED_OVER_KEY]).toBeUndefined();

		const denied = {
			getItem: () => {
				throw new Error("denied");
			},
		} as unknown as Storage;
		const third = await handOver(denied);
		await third.host.main.flush();
		expect(third.setMode).not.toHaveBeenCalled();
	});

	it("tries again next launch when the hand-over failed", async () => {
		const storage = memoryStorage({ [LEGACY_AUTO_APPROVE_KEY]: "true" });
		const { setMode, host } = await handOver(storage, { fail: true });
		await vi.waitFor(() => expect(setMode).toHaveBeenCalled());
		await host.main.flush();
		expect(storage.values[AUTO_APPROVE_HANDED_OVER_KEY]).toBeUndefined();
	});
});
