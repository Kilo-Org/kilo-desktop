import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { CondaProvider } from "./index.js";
import * as staging from "./staging/index.js";

/**
 * `CondaProvider` unit tests. `main/index.test.ts` covers the boot-path
 * integration (calling `stageConda` for real fixtures); this file targets
 * the class-level contract:
 *
 * - `registerHandlers` refuses to bind before `boot()` resolved.
 * - `registerTools` delegates to the shared helper without needing the
 *   backend at construction time.
 * - `webComponents` exposes the placeholder shape the interface requires.
 */
describe("CondaProvider", () => {
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
		expect(() => provider.registerHandlers({ mainSdk })).toThrow(
			/registerHandlers called before boot/,
		);
		mainSdk.dispose();
	});

	it("registerHandlers wires conda.envs.list once boot() resolved", async () => {
		const provider = new CondaProvider();
		const mainSdk = createFakeMainSdk({ featureId: "environments" });
		vi.spyOn(staging, "stageConda").mockResolvedValue({
			condaBinPath: "/opt/conda/bin/conda",
			strategy: "system",
			condaFilesRoot: "/tmp/conda-root",
		});

		await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });
		provider.registerHandlers({ mainSdk });

		expect(mainSdk.has("conda.envs.list")).toBe(true);
		mainSdk.dispose();
	});

	it("registerTools registers conda.envs.list on the renderer SDK", () => {
		const provider = new CondaProvider();
		const sdk = createFakeSdk({ featureId: "environments" });
		provider.registerTools(sdk);
		expect(sdk.services.toolRegistry.all().map((tool) => tool.name)).toEqual(["conda.envs.list"]);
	});
});
