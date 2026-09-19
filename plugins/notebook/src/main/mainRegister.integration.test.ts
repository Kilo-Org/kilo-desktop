import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	EMBEDDED_WEB_HOST_CAPABILITY,
	FeatureRouter,
	type HostMessagePort,
} from "@kilo-desktop/feature-sdk/main";

import {
	mainRegister,
	type ElectronNotebookHostServiceLike,
	type NotebookFeatureOptions,
} from "./index.js";
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

async function boot(options: NotebookFeatureOptions = {}) {
	const router = new FeatureRouter();
	const disposeKiloEnv = vi.fn();
	const kiloService = {
		configuration: { set: vi.fn(async () => undefined) },
		serverEnv: { contribute: vi.fn(() => disposeKiloEnv) },
	};
	router.createMainSdk("kilo-server").plugins.expose("kiloService", kiloService);
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
		...options,
		resolveBundleRoot: () => "/plugins/notebook/build/notebook",
		resolveKiloPluginEntry: () => "/plugins/notebook/build/kilo-plugin/index.js",
		resolveRuntimedNodeEntry: () => "/node_modules/@runtimed/node/src/index.cjs",
		createHostService: (options) => {
			hostServiceOptions = options;
			return hostService;
		},
	});
	return { hostService, hostServiceOptions, kiloService, mainSdk, router };
}

describe("notebook mainRegister", () => {
	afterEach(() => vi.unstubAllEnvs());

	it.each(["option", "environment"])(
		"uses the explicit %s endpoint for the host",
		async (selection) => {
			const socketPath = "/tmp/runtimed.sock";
			if (selection === "environment") vi.stubEnv("RUNTIMED_SOCKET_PATH", socketPath);
			const { hostServiceOptions } = await boot(selection === "option" ? { socketPath } : {});
			expect(hostServiceOptions?.socketPath).toBe(socketPath);
		},
	);

	it("starts runtimed during app feature registration", async () => {
		const { hostService } = await boot();

		expect(hostService.start).toHaveBeenCalledOnce();
	});

	it("defaults every runtime consumer to the pinned release channel", async () => {
		const { hostServiceOptions } = await boot();

		expect(hostServiceOptions?.runtimeChannel).toBe("nightly");
	});

	it("installs the direct Kilo plugin with the host daemon socket", async () => {
		const { kiloService } = await boot();

		expect(kiloService.configuration.set).toHaveBeenCalledWith("notebook", {
			plugins: { notebooks: "/plugins/notebook/build/kilo-plugin/index.js" },
			mcpEntries: {},
		});
		expect(kiloService.serverEnv.contribute).toHaveBeenCalledWith("notebook", {
			NTERACT_RUNTIMED_NODE_PATH: "/node_modules/@runtimed/node/src/index.cjs",
			RUNTIMED_SOCKET_PATH: "/tmp/runtimed.sock",
		});
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
			workingDirectory: "/projects/analysis",
		};

		await router.connectPort("notebook", "host", port, args, { senderId: 42 });

		expect(hostService.connect).toHaveBeenCalledWith(port, args, 42);
		await expect(
			router.connectPort("notebook", "host", fakePort(), { ...args, notebookId: "not-a-uuid" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			router.connectPort("notebook", "host", fakePort(), {
				...args,
				workingDirectory: "relative/path",
			}),
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
