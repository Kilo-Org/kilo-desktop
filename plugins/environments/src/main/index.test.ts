import { afterEach, describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";
import type { FakeMainSdk } from "@anaconda-agentic-desktop/testing";

import type { EnvironmentsCapabilities } from "../contracts/capabilities.js";

import { FEATURE_FLAG_KEY, mainRegister } from "./index.js";
import { CondaProvider } from "./providers/conda/index.js";

vi.mock("./providers/conda/resolveBridgePath.js", () => ({
	resolveBridgeLaunchInfo: vi.fn(() => null),
	resolveBridgeBinaryPath: vi.fn(() => null),
}));

import { resolveBridgeLaunchInfo } from "./providers/conda/resolveBridgePath.js";

const mockedResolveBridge = vi.mocked(resolveBridgeLaunchInfo);

/**
 * Build a linked SDK pair and (optionally) expose the shell-side
 * `feature-flag` capability with a caller-controlled return value. Mirrors
 * the harness in
 * `apps/desktop/src/main/features/anaconda-mcp/AnacondaMcpService.integration.test.ts`
 * so the flag-off path can be exercised.
 */
function createSdkWithFlag(options: { featureFlagEnabled: boolean | null }): {
	mainSdk: FakeMainSdk;
	getFlag: ReturnType<typeof vi.fn>;
} {
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
		featureId: "environments",
	});

	const getFlag = vi.fn(<T>(_key: string, defaultValue: T): T => {
		if (options.featureFlagEnabled === null) return defaultValue;
		return options.featureFlagEnabled as unknown as T;
	});

	if (options.featureFlagEnabled !== null) {
		const flagSdk = createMainSdk("feature-flag");
		flagSdk.plugins.expose("featureFlag", { getFlag });
	}

	return { mainSdk, getFlag };
}

/** Configure `resolveBridgeLaunchInfo` to return a valid bridge payload. */
function setupFakeBridge(): void {
	mockedResolveBridge.mockReturnValue({
		command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
		payloadRoot: "/fake/bridge",
		version: "1.0.0",
	});
}

describe("environments plugin main entry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		// Reset the module-level vi.fn mock so a previous test's
		// `mockReturnValue` does not leak into the next test.
		mockedResolveBridge.mockReset();
	});

	it("returns a Promise (async mainRegister for provider boot)", async () => {
		setupFakeBridge();
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });
		const result = mainRegister(mainSdk);
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it("boots the conda provider via the bridge sidecar", async () => {
		setupFakeBridge();
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });

		await mainRegister(mainSdk);

		expect(mockedResolveBridge).toHaveBeenCalled();
	});

	it("propagates boot failures (bridge payload not found)", async () => {
		// resolveBridgeLaunchInfo returns null by default (mock above)
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });

		await expect(mainRegister(mainSdk)).rejects.toThrow(
			/anaconda-bridge-sidecar payload not found/,
		);
	});

	describe("feature-flag gate (environments-feature)", () => {
		it("exposes conda runtime capability even when the UI feature is off", async () => {
			const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: false });

			await mainRegister(mainSdk);

			const capabilities = mainSdk.plugins.get<EnvironmentsCapabilities>("environments");
			expect(capabilities?.condaRuntime).toBeDefined();
			expect(typeof capabilities?.condaRuntime.ensureEnvironment).toBe("function");
			expect(typeof capabilities?.condaRuntime.executable).toBe("function");
			// Bridge should NOT be resolved yet — lazy initialization
			expect(mockedResolveBridge).not.toHaveBeenCalled();
		});

		it("skips provider boot when the flag is off", async () => {
			setupFakeBridge();
			const { mainSdk, getFlag } = createSdkWithFlag({ featureFlagEnabled: false });

			await mainRegister(mainSdk);

			expect(mockedResolveBridge).not.toHaveBeenCalled();
			expect(getFlag).toHaveBeenCalledWith(FEATURE_FLAG_KEY, false);
		});

		it("defaults to OFF when the feature-flag capability is unavailable", async () => {
			setupFakeBridge();
			const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: null });

			await mainRegister(mainSdk);

			expect(mockedResolveBridge).not.toHaveBeenCalled();
		});
	});

	it("wires provider teardown into app shutdown (mainSdk.onDispose)", async () => {
		setupFakeBridge();
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });
		const onDispose = vi.spyOn(CondaProvider.prototype, "onDispose");

		await mainRegister(mainSdk);
		expect(onDispose).not.toHaveBeenCalled();

		mainSdk.dispose();
		expect(onDispose).toHaveBeenCalledTimes(1);
	});
});
