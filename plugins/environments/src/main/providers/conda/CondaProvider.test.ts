import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@anaconda-agentic-desktop/testing";

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

	it("registerHandlers wires conda.envs.list + distributions + create + clone + createFromFile + delete once boot() resolved", async () => {
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
		queue.dispose();
		mainSdk.dispose();
	});

	it("registerTools registers list + create + delete on the renderer SDK", () => {
		const provider = new CondaProvider();
		const sdk = createFakeSdk({ featureId: "environments" });
		provider.registerTools(sdk);
		const names = sdk.services.toolRegistry.all().map((tool) => tool.name);
		expect(names.sort()).toEqual(["conda.envs.create", "conda.envs.delete", "conda.envs.list"]);
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
