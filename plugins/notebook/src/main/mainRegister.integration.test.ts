import { describe, expect, it, vi } from "vitest";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	EMBEDDED_WEB_HOST_CAPABILITY,
	FeatureRouter,
	type HostMessagePort,
} from "@anaconda-agentic-desktop/feature-sdk/main";

import { mainRegister, type ElectronNotebookHostServiceLike } from "./index.js";
import type { ElectronNotebookHostServiceOptions } from "./runtime/ElectronNotebookHostService.js";

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
		start: vi.fn(async () => ({ status: "external" as const })),
		status: vi.fn(async () => ({
			availability: { status: "available" as const },
			process: { status: "external" as const },
			daemon: {
				version: "2.6.3",
				socketPath: "/tmp/runtimed.sock",
				isDevMode: false,
				blobPort: 48637,
			},
		})),
		openFile: vi.fn(async (path: string) => ({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			path,
			title: "analysis.ipynb",
		})),
		save: vi.fn(async () => ({ outcome: "saved" as const })),
		setDefaultSaveDirectory: vi.fn(),
		connect: vi.fn(async () => undefined),
		dispose: vi.fn(async () => undefined),
	} satisfies ElectronNotebookHostServiceLike;
	let hostServiceOptions: ElectronNotebookHostServiceOptions | undefined;
	await mainRegister(mainSdk, {
		resolveBundleRoot: () => "/plugins/notebook/build/notebook",
		createHostService: (options) => {
			hostServiceOptions = options;
			return hostService;
		},
	});
	return { hostService, hostServiceOptions, mainSdk, router };
}

describe("notebook mainRegister", () => {
	it("starts runtimed during app feature registration", async () => {
		const { hostService } = await boot();

		expect(hostService.start).toHaveBeenCalledOnce();
	});

	it("defaults every runtime consumer to the stable singleton", async () => {
		const { hostServiceOptions } = await boot();

		expect(hostServiceOptions?.runtimeChannel).toBe("stable");
	});

	it("reports the external singleton through the typed status channel", async () => {
		const { router } = await boot();

		await expect(router.invoke("notebook", "status")).resolves.toEqual({
			availability: { status: "available" },
			process: { status: "external" },
			daemon: {
				version: "2.6.3",
				socketPath: "/tmp/runtimed.sock",
				isDevMode: false,
				blobPort: 48637,
			},
		});
	});

	it("routes notebook save requests through the host service", async () => {
		const { hostService, router } = await boot();
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";

		await expect(router.invoke("notebook", "save", { notebookId })).resolves.toEqual({
			outcome: "saved",
		});
		expect(hostService.save).toHaveBeenCalledWith(notebookId);
	});

	it("opens a notebook file through the host service", async () => {
		const { hostService, router } = await boot();

		await expect(
			router.invoke("notebook", "openFile", { path: "/projects/analysis.ipynb" }),
		).resolves.toEqual({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			path: "/projects/analysis.ipynb",
			title: "analysis.ipynb",
		});
		expect(hostService.openFile).toHaveBeenCalledWith("/projects/analysis.ipynb");
	});

	it("updates a notebook's default save directory", async () => {
		const { hostService, router } = await boot();
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";

		await expect(
			router.invoke("notebook", "setDefaultSaveDirectory", {
				notebookId,
				directory: "/projects/analysis",
			}),
		).resolves.toBeUndefined();
		expect(hostService.setDefaultSaveDirectory).toHaveBeenCalledWith(
			notebookId,
			"/projects/analysis",
		);
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

	it("contributes the bundle with an exact active-content CSP profile", async () => {
		const { mainSdk } = await boot();
		const capability = mainSdk.plugins.get("notebook")?.[EMBEDDED_WEB_HOST_CAPABILITY];

		expect(capability).toEqual({
			host: "notebook",
			root: "/plugins/notebook/build/notebook",
			securityProfiles: {
				"/output-frame.html": ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
			},
		});
	});

	it("disposes every active native host session with the feature", async () => {
		const { hostService, router } = await boot();

		await router.destroyFeatureAsync("notebook");

		expect(hostService.dispose).toHaveBeenCalledOnce();
	});
});
