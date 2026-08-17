import { existsSync } from "node:fs";

import { z } from "zod";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	EMBEDDED_WEB_HOST_CAPABILITY,
	type EmbeddedWebHost,
	type HostMessagePort,
	type MainSdk,
} from "@anaconda-agentic-desktop/feature-sdk/main";

import { notebookContract, NOTEBOOK_HOST, type NotebookService } from "../contracts/schemas.js";
import {
	ElectronNotebookHostService,
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
});

export interface NotebookFeatureOptions {
	readonly socketPath?: string;
	/** Selects the user-owned singleton. Defaults to nightly until the stable release includes the adapter. */
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
	connect(
		port: HostMessagePort,
		args: { readonly notebookId: string; readonly sessionId: string; readonly title: string },
		senderId: number,
	): Promise<void>;
	dispose(): Promise<void>;
}

export async function mainRegister(
	mainSdk: MainSdk,
	options: NotebookFeatureOptions = {},
): Promise<void> {
	const runtimeChannel = options.runtimeChannel ?? "nightly";
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

	mainSdk.ports.handle("host", connectionArgsSchema, (port, args, context) =>
		hostService.connect(port, args, context.senderId),
	);

	const api: NotebookService = {
		status: () => hostService.status(),
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
