import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk, createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import { JobQueue } from "../../JobQueue.js";
import { CondaProvider } from "./index.js";
import * as resolveBridge from "./resolveBridgePath.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";

/**
 * `CondaProvider` unit tests. `main/index.test.ts` covers the boot-path
 * integration; this file targets the class-level contract:
 *
 * - `boot()` constructs `SidecarCondaBackend` unconditionally.
 * - `boot()` throws when the bridge payload is missing.
 * - `registerHandlers` refuses to bind before `boot()` resolved.
 * - `registerTools` delegates to the shared helper without needing the
 *   backend at construction time.
 * - `webComponents` exposes the placeholder shape the interface requires.
 */
describe("CondaProvider", () => {
	beforeEach(() => {
		// boot() kicks off a fire-and-forget bridge warm-up; stub it at the
		// prototype seam so these unit tests never spawn a real sidecar.
		vi.spyOn(SidecarCondaBackend.prototype, "warmUp").mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("exposes id/displayName + webComponents required by the interface", () => {
		const provider = new CondaProvider();
		expect(provider.id).toBe("conda");
		expect(provider.displayName).toBe("Conda");
		// EnvironmentsPanel + PackagesPanel placeholders exist so the
		// interface's required-webComponents shape is satisfied without
		// shipping renderer UI in this slice.
		expect(typeof provider.webComponents.EnvironmentsPanel).toBe("function");
		expect(typeof provider.webComponents.PackagesPanel).toBe("function");
		// `ComponentType` widens to `ComponentClass | FunctionComponent`;
		// the placeholders are function components so calling them
		// directly is safe here.
		const environmentsPanel = provider.webComponents.EnvironmentsPanel as () => null;
		const packagesPanel = provider.webComponents.PackagesPanel as () => null;
		expect(environmentsPanel()).toBeNull();
		expect(packagesPanel()).toBeNull();
	});

	it("registerHandlers throws when called before boot()", () => {
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		expect(() => provider.registerHandlers({ mainSdk, queue })).toThrow(
			/registerHandlers called before boot/,
		);
		queue.dispose();
		mainSdk.dispose();
	});

	it("registerHandlers wires all conda env handlers once boot() resolved", async () => {
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "found",
			info: {
				command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
				payloadRoot: "/fake/bridge",
				version: "9.9.9",
			},
		});

		await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });
		provider.registerHandlers({ mainSdk, queue });

		expect(mainSdk.has("conda.envs.list")).toBe(true);
		expect(mainSdk.has("conda.envs.distributions")).toBe(true);
		expect(mainSdk.has("conda.envs.create")).toBe(true);
		expect(mainSdk.has("conda.envs.clone")).toBe(true);
		expect(mainSdk.has("conda.envs.createFromFile")).toBe(true);
		expect(mainSdk.has("conda.envs.delete")).toBe(true);
		expect(mainSdk.has("conda.envs.pickFile")).toBe(true);
		expect(mainSdk.has("conda.envs.readFile")).toBe(true);
		expect(mainSdk.has("conda.envs.prefixOptions")).toBe(true);
		expect(mainSdk.has("conda.channels.list")).toBe(true);
		expect(mainSdk.has("conda.repodata.find")).toBe(true);
		expect(mainSdk.has("conda.packages.install")).toBe(true);
		expect(mainSdk.has("conda.packages.list")).toBe(true);
		expect(mainSdk.has("conda.packages.remove")).toBe(true);
		expect(mainSdk.has("conda.packages.update")).toBe(true);
		queue.dispose();
		mainSdk.dispose();
	});

	it("registerTools registers the conda tool surface on the renderer SDK", () => {
		const provider = new CondaProvider();
		const sdk = createFakeSdk({ featureId: "environments" });
		provider.registerTools(sdk);
		const names = sdk.services.toolRegistry.all().map((tool) => tool.name);
		expect(names.sort()).toEqual([
			"conda.channels.list",
			"conda.envs.clone",
			"conda.envs.create",
			"conda.envs.createFromFile",
			"conda.envs.delete",
			"conda.envs.list",
			"conda.packages.install",
			"conda.packages.list",
			"conda.packages.remove",
			"conda.packages.update",
			"conda.repodata.find",
		]);
	});

	it("boot() kicks off the bridge warm-up during the boot window", async () => {
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "found",
			info: {
				command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
				payloadRoot: "/fake/bridge",
				version: "9.9.9",
			},
		});
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });

		await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });

		expect(SidecarCondaBackend.prototype.warmUp).toHaveBeenCalledTimes(1);
		mainSdk.dispose();
	});

	it("boot() resolves even when the bridge warm-up fails (first real call retries)", async () => {
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "found",
			info: {
				command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
				payloadRoot: "/fake/bridge",
				version: "9.9.9",
			},
		});
		// Fire-and-forget: a failed warm-up is logged and swallowed inside
		// boot() — it must not fail the provider boot (which would skip the
		// provider's handlers entirely) nor surface as an unhandled rejection.
		vi.mocked(SidecarCondaBackend.prototype.warmUp).mockRejectedValue(new Error("spawn failed"));
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });

		await expect(
			provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger }),
		).resolves.toBeUndefined();

		mainSdk.dispose();
	});

	it("boot() throws with searched paths when the bridge payload is missing", async () => {
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "not-found",
			searchedPaths: ["/fake/resources/bridge", "/fake/plugin/resources/bridge"],
		});
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });

		const error = await provider
			.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger })
			.catch((e: Error) => e);

		expect(error).toBeInstanceOf(Error);
		expect(error!.message).toMatch(/anaconda-bridge-sidecar payload not found/);
		expect(error!.message).toContain("/fake/resources/bridge");
		expect(error!.message).toContain("/fake/plugin/resources/bridge");

		mainSdk.dispose();
	});

	it("boot() passes bridge telemetry config from the preferences capability", async () => {
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "found",
			info: {
				command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
				payloadRoot: "/fake/bridge",
				version: "9.9.9",
			},
		});
		const provider = new CondaProvider();
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "environments",
		});
		const prefsSdk = createMainSdk("preferences");
		prefsSdk.plugins.expose("preferences", {
			allowDataCollection: false,
			telemetryEnv: "test",
		});

		await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });

		expect(SidecarCondaBackend.prototype.warmUp).toHaveBeenCalledTimes(1);
		mainSdk.dispose();
	});

	it("boot() without preferences capability still constructs the backend (telemetry omitted)", async () => {
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "found",
			info: {
				command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
				payloadRoot: "/fake/bridge",
				version: "9.9.9",
			},
		});
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });

		await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });

		expect(SidecarCondaBackend.prototype.warmUp).toHaveBeenCalledTimes(1);
		mainSdk.dispose();
	});

	it("onDispose() tears down the sidecar backend (kills the bridge process)", async () => {
		const dispose = vi.spyOn(SidecarCondaBackend.prototype, "dispose").mockImplementation(() => {});
		vi.spyOn(resolveBridge, "resolveBridge").mockReturnValue({
			kind: "found",
			info: {
				command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
				payloadRoot: "/fake/bridge",
				version: "9.9.9",
			},
		});

		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });

		await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });

		provider.onDispose();
		expect(dispose).toHaveBeenCalledTimes(1);

		mainSdk.dispose();
	});
});
