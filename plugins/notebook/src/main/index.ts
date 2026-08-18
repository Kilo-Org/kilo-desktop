import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	EMBEDDED_WEB_HOST_CAPABILITY,
	type EmbeddedWebHost,
	type HostMessagePort,
	type MainSdk,
} from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	notebookContract,
	NOTEBOOK_HOST,
	type NotebookOpenFileResult,
	type NotebookSaveResult,
	type NotebookService,
} from "../contracts/schemas.js";
import {
	ElectronNotebookHostService,
	type ElectronNotebookConnectionArgs,
	type ElectronNotebookHostServiceOptions,
} from "./runtime/ElectronNotebookHostService.js";
import { resolveNotebookBundleRoot } from "./embedding/notebook-bundle-path.js";
import { reconcileRuntMcpConfig } from "./integrations/kilo-mcp-config.js";
import type { BuildChannel } from "./runtime/socket-path.js";
import { findRuntimedArtifact } from "../packaging/artifacts.js";

const connectionArgsSchema = z.object({
	notebookId: z.string().uuid(),
	sessionId: z.string().min(1).max(512),
	title: z.string().min(1).max(512),
	notebookPath: z
		.string()
		.min(1)
		.max(32_768)
		.refine((value) => path.isAbsolute(value), "Notebook paths must be absolute.")
		.refine(
			(value) => path.extname(value).toLowerCase() === ".ipynb",
			"Notebook files must use the .ipynb extension.",
		)
		.optional(),
});

export interface NotebookFeatureOptions {
	readonly socketPath?: string;
	/** Selects the user-owned singleton. Defaults to the stable channel. */
	readonly runtimeChannel?: BuildChannel;
	readonly resolveBundleRoot?: () => string | undefined;
	readonly resolveNteractMcpBinary?: () => string | undefined;
	readonly resolveRuntBinary?: () => string | undefined;
	readonly resolveRuntimedBinary?: () => string | undefined;
	/** Test seam for the native host service. */
	readonly createHostService?: (
		options: ElectronNotebookHostServiceOptions,
	) => ElectronNotebookHostServiceLike;
}

export interface ElectronNotebookHostServiceLike {
	readonly socketPath: string;
	start(): ReturnType<ElectronNotebookHostService["start"]>;
	status(): ReturnType<ElectronNotebookHostService["status"]>;
	openFile(path: string): Promise<NotebookOpenFileResult>;
	save(notebookId: string): Promise<NotebookSaveResult>;
	setDefaultSaveDirectory(notebookId: string, directory: string | null): void;
	connect(
		port: HostMessagePort,
		args: ElectronNotebookConnectionArgs,
		senderId: number,
	): Promise<void>;
	dispose(): Promise<void>;
}

export async function mainRegister(
	mainSdk: MainSdk,
	options: NotebookFeatureOptions = {},
): Promise<void> {
	const runtimeChannel = options.runtimeChannel ?? "stable";
	const createHostService =
		options.createHostService ??
		((serviceOptions) => new ElectronNotebookHostService(serviceOptions));
	const resolveRuntimedBinary =
		options.resolveRuntimedBinary ??
		(() => {
			const artifact = findRuntimedArtifact();
			if (!artifact) return undefined;
			const candidate = mainSdk.resolvePluginAsset(
				`resources/runtimed/${artifact.target}/${artifact.executable}`,
			);
			return existsSync(candidate) ? candidate : undefined;
		});
	const runtimedBinaryPath = resolveRuntimedBinary();
	const hostService = createHostService({
		mainSdk,
		...(options.socketPath ? { socketPath: options.socketPath } : {}),
		runtimeChannel,
		...(runtimedBinaryPath ? { runtimedBinaryPath } : {}),
	});
	mainSdk.onDispose(() => hostService.dispose());
	void hostService.start().catch((error: unknown) => {
		mainSdk.logger.warn(
			`Notebook runtime startup failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	const resolveBundleRoot =
		options.resolveBundleRoot ??
		(() => resolveNotebookBundleRoot({ candidate: mainSdk.resolvePluginAsset("build/notebook") }));

	await reconcileRuntMcpConfig(mainSdk, {
		runtimeChannel,
		logger: mainSdk.logger,
		...(options.socketPath ? { customSocketPath: hostService.socketPath } : {}),
		...(options.resolveNteractMcpBinary
			? { resolveNteractMcpBinary: options.resolveNteractMcpBinary }
			: {}),
		...(options.resolveRuntBinary ? { resolveRuntBinary: options.resolveRuntBinary } : {}),
	});

	mainSdk.ports.handle("host", connectionArgsSchema, (port, args, context) => {
		const { notebookPath, ...requiredArgs } = args;
		return hostService.connect(
			port,
			{ ...requiredArgs, ...(notebookPath ? { notebookPath } : {}) },
			context.senderId,
		);
	});

	const api: NotebookService = {
		status: () => hostService.status(),
		openFile: ({ path: notebookPath }) => hostService.openFile(notebookPath),
		save: ({ notebookId }) => hostService.save(notebookId),
		setDefaultSaveDirectory: async ({ notebookId, directory }) => {
			hostService.setDefaultSaveDirectory(notebookId, directory);
		},
	};
	mainSdk.channels(notebookContract).handleAll(api);
	const embeddedWebHost = {
		host: NOTEBOOK_HOST,
		root: resolveBundleRoot(),
		securityProfiles: {
			"/output-frame.html": ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
		},
	} satisfies EmbeddedWebHost;
	mainSdk.plugins.expose(EMBEDDED_WEB_HOST_CAPABILITY, embeddedWebHost);
}
