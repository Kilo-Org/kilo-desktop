import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";
import type { FakeMainSdk } from "@anaconda-agentic-desktop/testing";

import type { EnvironmentsCapabilities } from "../contracts/capabilities.js";

import { FEATURE_FLAG_KEY, mainRegister } from "./index.js";
import { CondaProvider } from "./providers/conda/index.js";
import { SidecarCondaBackend } from "./providers/conda/SidecarCondaBackend.js";

vi.mock("./providers/conda/resolveBridgePath.js", () => ({
	resolveBridge: vi.fn(() => ({ kind: "not-found", searchedPaths: ["/fake/path"] })),
	resolveBridgeLaunchInfo: vi.fn(() => null),
	resolveBridgeBinaryPath: vi.fn(() => null),
}));

import { resolveBridge, resolveBridgeLaunchInfo } from "./providers/conda/resolveBridgePath.js";

const mockedResolveBridge = vi.mocked(resolveBridge);
const mockedResolveBridgeLaunchInfo = vi.mocked(resolveBridgeLaunchInfo);

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
	exposePreferences: (prefs: { allowDataCollection: boolean; telemetryEnv: string }) => void;
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

	const exposePreferences = (prefs: { allowDataCollection: boolean; telemetryEnv: string }) => {
		const prefsSdk = createMainSdk("preferences");
		prefsSdk.plugins.expose("preferences", prefs);
	};

	return { mainSdk, getFlag, exposePreferences };
}

const FAKE_LAUNCH_INFO = {
	command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
	payloadRoot: "/fake/bridge",
	version: "1.0.0",
} as const;

/** Configure bridge resolution mocks to return a valid bridge payload. */
function setupFakeBridge(): void {
	mockedResolveBridge.mockReturnValue({ kind: "found", info: FAKE_LAUNCH_INFO });
	mockedResolveBridgeLaunchInfo.mockReturnValue(FAKE_LAUNCH_INFO);
}

describe("environments plugin main entry", () => {
	beforeEach(() => {
		// Provider boot kicks off a fire-and-forget bridge warm-up; stub it
		// at the prototype seam so these tests never spawn a real sidecar.
		vi.spyOn(SidecarCondaBackend.prototype, "warmUp").mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Reset module-level vi.fn mocks so a previous test's
		// `mockReturnValue` does not leak into the next test.
		mockedResolveBridge.mockReset();
		mockedResolveBridgeLaunchInfo.mockReset();
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

	it("kicks off bridge warm-up during provider boot (fire-and-forget)", async () => {
		setupFakeBridge();
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });

		await mainRegister(mainSdk);

		expect(SidecarCondaBackend.prototype.warmUp).toHaveBeenCalledTimes(1);
	});

	it("degrades gracefully when provider boot fails (bridge payload not found)", async () => {
		// resolveBridge returns not-found by default (mock above)
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });
		const errorSpy = vi.spyOn(mainSdk.logger, "error");

		// mainRegister no longer throws — it catches per-provider and degrades
		await expect(mainRegister(mainSdk)).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('provider "conda" failed to boot'),
			expect.objectContaining({ error: expect.any(Error) }),
		);
	});

	it("exposes condaRuntime capability even when provider boot fails", async () => {
		// resolveBridgeLaunchInfo returns null → provider.boot() throws
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });

		await mainRegister(mainSdk);

		const capabilities = mainSdk.plugins.get<EnvironmentsCapabilities>("environments");
		expect(capabilities?.condaRuntime).toBeDefined();
		expect(typeof capabilities?.condaRuntime.ensureEnvironment).toBe("function");
	});

	it("sets providersAvailable to false when all providers fail", async () => {
		// resolveBridgeLaunchInfo returns null → CondaProvider.boot() throws
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });

		await mainRegister(mainSdk);

		const status = await mainSdk.invoke("environments.status");
		expect(status).toEqual({ providersAvailable: false });
	});

	it("sets providersAvailable to true when providers boot successfully", async () => {
		setupFakeBridge();
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true });

		await mainRegister(mainSdk);

		const status = await mainSdk.invoke("environments.status");
		expect(status).toEqual({ providersAvailable: true });
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

		it("reports providersAvailable false when the flag is off", async () => {
			const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: false });

			await mainRegister(mainSdk);

			const status = await mainSdk.invoke("environments.status");
			expect(status).toEqual({ providersAvailable: false });
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

	it("forwards preferences capability as bridge telemetry config when available", async () => {
		setupFakeBridge();
		const { mainSdk, exposePreferences } = createSdkWithFlag({ featureFlagEnabled: true });
		exposePreferences({ allowDataCollection: false, telemetryEnv: "test" });

		await mainRegister(mainSdk);

		// The bridge warm-up fired — the telemetry config was threaded
		// through CondaProvider.boot() to SidecarCondaBackend.
		expect(SidecarCondaBackend.prototype.warmUp).toHaveBeenCalledTimes(1);
	});
});
