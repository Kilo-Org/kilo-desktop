import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { z } from "zod";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	CLIPBOARD_WRITE_EMBEDDED_PERMISSION,
	EMBEDDED_WEB_HOST_CAPABILITY,
	type EmbeddedWebHost,
	type HostMessagePort,
	type MainSdk,
} from "@kilo-desktop/feature-sdk/main";

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
import { reconcileNotebookKiloPlugin } from "./integrations/kilo-plugin-config.js";
import type { BuildChannel } from "./runtime/socket-path.js";
import { findRuntimedArtifact, NTERACT_RELEASE } from "../packaging/artifacts.js";
import { WorkspaceEnvironment } from "./environment/workspace-environment.js";
import { NewNotebookTrust, type TrustSession } from "./runtime/NewNotebookTrust.js";
import { NotebookSettingsStore, NotebookStateStore } from "./settings/NotebookSettingsStore.js";
import {
	NotebookTelemetryPermission,
	type OpenTelemetryRegistration,
} from "./runtime/NotebookTelemetryPermission.js";

type PreferencesCapability = {
	preferences: {
		readonly allowDataCollection: boolean;
		onDidChangeAllowDataCollection(listener: (allowed: boolean) => Promise<void>): () => void;
	};
};

type FeatureFlagCapability = {
	featureFlag: { getFlag(key: string, defaultValue: boolean): unknown };
};

const connectionArgsSchema = z.object({
	notebookId: z.string().uuid(),
	sessionId: z.string().min(1).max(512),
	title: z.string().min(1).max(512),
	workingDirectory: z
		.string()
		.min(1)
		.max(32_768)
		.refine((value) => path.isAbsolute(value), "Working directories must be absolute.")
		.optional(),
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
	/** Selects the user-owned singleton. Defaults to the pinned release channel. */
	readonly runtimeChannel?: BuildChannel;
	readonly resolveBundleRoot?: () => string | undefined;
	readonly resolveKiloPluginEntry?: () => string | undefined;
	readonly resolveRuntimedNodeEntry?: () => string | undefined;
	readonly resolveRuntimedBinary?: () => string | undefined;
	/** Test seam for the native host service. */
	readonly createHostService?: (
		options: ElectronNotebookHostServiceOptions,
	) => ElectronNotebookHostServiceLike;
	/** Test seam for the extra peer "Trust new notebooks" opens per notebook. */
	readonly openTrustSession?: (notebookId: string, socketPath: string) => Promise<TrustSession>;
	/** Test seam for the optional native telemetry registration API. */
	readonly openTelemetryRegistration?: OpenTelemetryRegistration;
	/** Test seam for project-file discovery's home-directory boundary. */
	readonly homeDirectory?: string;
}

async function openNativeTrustSession(notebookId: string, socketPath: string) {
	// Loaded on demand: the native addon is only needed while the setting is on.
	const { openNotebook } = await import("@runtimed/node");
	return openNotebook(notebookId, { socketPath, peerLabel: "kilo-desktop:trust" });
}

const openNativeTelemetryRegistration: OpenTelemetryRegistration = async (options) => {
	// The CJS root spreads native exports, which only appear on import's default.
	// 0.5.6's declarations omit both that default and the optional telemetry API.
	const { default: runtime } = (await import("@runtimed/node")) as unknown as {
		default: {
			openTelemetryRegistration?: OpenTelemetryRegistration;
		};
	};
	if (
		!("openTelemetryRegistration" in runtime) ||
		typeof runtime.openTelemetryRegistration !== "function"
	)
		return null;
	return runtime.openTelemetryRegistration(options);
};

export function translateAsarToUnpackedPath(inputPath: string): string {
	const asarSegment = `${path.sep}app.asar${path.sep}`;
	if (!inputPath.includes(asarSegment)) return inputPath;
	return inputPath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
}

function defaultRuntimedNodeEntry(): string | undefined {
	try {
		return translateAsarToUnpackedPath(createRequire(import.meta.url).resolve("@runtimed/node"));
	} catch {
		return undefined;
	}
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
	const runtimeChannel = options.runtimeChannel ?? NTERACT_RELEASE.channel;
	const socketPath = options.socketPath ?? process.env["RUNTIMED_SOCKET_PATH"]?.trim();
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
	const settings = new NotebookSettingsStore(mainSdk);
	const notebookState = new NotebookStateStore(mainSdk);
	const workspaceEnvironment = new WorkspaceEnvironment({
		settings: () => settings.get(),
		state: notebookState,
		...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
	});
	const openTrustSession = options.openTrustSession ?? openNativeTrustSession;
	const newNotebookTrust = new NewNotebookTrust({
		openNotebook: (notebookId) => openTrustSession(notebookId, hostService.socketPath),
		isEnabled: () => settings.get().trustNewNotebooks,
		logger: mainSdk.logger,
	});
	const hostService = createHostService({
		mainSdk,
		...(socketPath ? { socketPath } : {}),
		runtimeChannel,
		...(runtimedBinaryPath ? { runtimedBinaryPath } : {}),
		onNotebookConnected: ({ notebookId, untitled }) => {
			if (untitled) notebookState.markCreatedHere(notebookId);
			if (notebookState.isCreatedHere(notebookId)) newNotebookTrust.track(notebookId);
			void telemetry.setNotebookActive(notebookId, true).catch(reportTelemetryError);
		},
		onNotebookDisconnected: (notebookId) => {
			newNotebookTrust.untrack(notebookId);
			void telemetry.setNotebookActive(notebookId, false).catch(reportTelemetryError);
		},
	});
	const reportTelemetryError = (_error: unknown) => {
		mainSdk.logger.warn("Notebook telemetry permission reconciliation failed.");
	};
	const telemetry = new NotebookTelemetryPermission({
		socketPath: hostService.socketPath,
		openRegistration: options.openTelemetryRegistration ?? openNativeTelemetryRegistration,
		readFeatureFlag: () =>
			mainSdk.plugins
				.get<FeatureFlagCapability>("feature-flag")
				?.featureFlag.getFlag("notebook-host-telemetry", false),
	});
	const preferences = mainSdk.plugins.get<PreferencesCapability>("preferences")?.preferences;
	const unsubscribeConsent = preferences?.onDidChangeAllowDataCollection((allowed) =>
		telemetry.setAllowed(allowed),
	);
	const unsubscribeFlag = mainSdk.events.on("feature-flag.changed", () => {
		void telemetry.refreshFeatureFlag().catch(reportTelemetryError);
	});
	mainSdk.onDispose(async () => {
		unsubscribeConsent?.();
		unsubscribeFlag();
		try {
			await telemetry.dispose();
		} finally {
			await newNotebookTrust.dispose();
			await hostService.dispose();
		}
	});
	await telemetry.setAllowed(preferences?.allowDataCollection === true);
	await telemetry.refreshFeatureFlag().catch(reportTelemetryError);
	// Eager start hides daemon startup from the first notebook open. Packaged e2e
	// defers it: no spec opens a notebook, and runtimed's environment-pool warm-up
	// otherwise saturates CI runners while every app boots. Every notebook entry
	// point (`status`, `openFile`, `connect`) starts the daemon on demand.
	if (process.env["KILO_NOTEBOOK_DEFER_RUNTIMED"] !== "1") {
		void hostService.start().catch((error: unknown) => {
			mainSdk.logger.warn(
				`Notebook runtime startup failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}
	const resolveBundleRoot =
		options.resolveBundleRoot ??
		(() => resolveNotebookBundleRoot({ candidate: mainSdk.resolvePluginAsset("build/notebook") }));

	const resolveKiloPluginEntry =
		options.resolveKiloPluginEntry ??
		(() => {
			const candidate = mainSdk.resolvePluginAsset("build/kilo-plugin/index.js");
			return existsSync(candidate) ? candidate : undefined;
		});
	const pluginPath = resolveKiloPluginEntry();
	const runtimedNodePath = (options.resolveRuntimedNodeEntry ?? defaultRuntimedNodeEntry)();
	if (pluginPath && runtimedNodePath) {
		try {
			const disposeKiloEnvironment = await reconcileNotebookKiloPlugin(mainSdk, {
				pluginPath,
				runtimedNodePath,
				socketPath: hostService.socketPath,
				logger: mainSdk.logger,
			});
			mainSdk.onDispose(disposeKiloEnvironment);
		} catch (error) {
			mainSdk.logger.warn(
				`Notebook Kilo plugin configuration failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} else {
		mainSdk.logger.warn(
			"Skipping notebook Kilo plugin configuration: the plugin bundle or @runtimed/node entry is unavailable.",
		);
	}

	mainSdk.ports.handle("host", connectionArgsSchema, (port, args, context) => {
		const { notebookPath, workingDirectory, ...requiredArgs } = args;
		return hostService.connect(
			port,
			{
				...requiredArgs,
				...(notebookPath ? { notebookPath } : {}),
				...(workingDirectory ? { workingDirectory } : {}),
			},
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
		getSettings: async () => settings.get(),
		updateSettings: async (patch) => {
			const next = settings.update(patch);
			newNotebookTrust.refresh();
			return next;
		},
		prepareEnvironment: (request) => workspaceEnvironment.prepare(request),
	};
	mainSdk.channels(notebookContract).handleAll(api);
	const embeddedWebHost = {
		host: NOTEBOOK_HOST,
		root: resolveBundleRoot(),
		securityProfiles: {
			"/output-frame.html": ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
		},
		// nteract's copy buttons call navigator.clipboard directly. Outputs render
		// in sandboxed opaque-origin frames, so only the notebook UI gets this.
		permissions: [CLIPBOARD_WRITE_EMBEDDED_PERMISSION],
	} satisfies EmbeddedWebHost;
	mainSdk.plugins.expose(EMBEDDED_WEB_HOST_CAPABILITY, embeddedWebHost);
}
