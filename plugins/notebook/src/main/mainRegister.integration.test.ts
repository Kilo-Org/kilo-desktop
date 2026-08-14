import { describe, expect, it, vi } from "vitest";

import { FeatureRouter, type HostMessagePort } from "@anaconda-agentic-desktop/feature-sdk/main";

import { mainRegister, type ElectronNotebookHostServiceLike } from "./index.js";

function fakePort(): HostMessagePort {
	return {
		postMessage: vi.fn(),
		on: vi.fn().mockReturnThis(),
		off: vi.fn().mockReturnThis(),
		start: vi.fn(),
		close: vi.fn(),
	};
}

async function boot() {
	const router = new FeatureRouter();
	const mainSdk = router.createMainSdk("notebook", {
		resolvePluginAsset: (subpath) => `/plugins/notebook/${subpath}`,
	});
	const hostService = {
		socketPath: "/tmp/runtimed.sock",
		status: vi.fn(async () => ({
			availability: { status: "available" as const },
			daemon: {
				version: "2.6.3",
				socketPath: "/tmp/runtimed.sock",
				isDevMode: false,
				blobPort: 48637,
			},
		})),
		connect: vi.fn(async () => undefined),
		dispose: vi.fn(async () => undefined),
	} satisfies ElectronNotebookHostServiceLike;
	await mainRegister(mainSdk, {
		resolveBundleRoot: () => "/plugins/notebook/build/notebook",
		createHostService: () => hostService,
	});
	return { hostService, mainSdk, router };
}

describe("notebook mainRegister", () => {
	it("reports the external singleton through the typed status channel", async () => {
		const { router } = await boot();

		await expect(router.invoke("notebook", "status")).resolves.toEqual({
			availability: { status: "available" },
			daemon: {
				version: "2.6.3",
				socketPath: "/tmp/runtimed.sock",
				isDevMode: false,
				blobPort: 48637,
			},
		});
	});

	it("routes a validated feature port with its trusted sender id", async () => {
		const { hostService, router } = await boot();
		const port = fakePort();
		const args = {
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			sessionId: "session-1",
			title: "Analysis",
		};

		await router.connectPort("notebook", "host", port, args, { senderId: 42 });

		expect(hostService.connect).toHaveBeenCalledWith(port, args, 42);
		await expect(
			router.connectPort("notebook", "host", fakePort(), { ...args, notebookId: "not-a-uuid" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("contributes the bundle with an exact isolated-output CSP profile", async () => {
		const { mainSdk } = await boot();
		const capability = mainSdk.plugins.get("notebook")?.["embeddedWebHost"];

		expect(capability).toEqual({
			host: "notebook",
			root: "/plugins/notebook/build/notebook",
			securityProfiles: { "/output-frame.html": "isolated-output" },
		});
	});

	it("disposes every active native host session with the feature", async () => {
		const { hostService, router } = await boot();

		await router.destroyFeatureAsync("notebook");

		expect(hostService.dispose).toHaveBeenCalledOnce();
	});
});
