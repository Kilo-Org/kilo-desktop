import {
	EMBEDDED_WEB_HOST_CAPABILITY,
	type EmbeddedWebHost,
	type HostMessagePort,
	type MainSdk,
} from "@kilo-desktop/feature-sdk/main";

import { TERMINAL_HOST } from "../contracts/frame.js";
import {
	terminalConnectionArgsSchema,
	terminalContract,
	TERMINAL_SESSION_EXITED,
	type TerminalConnectionArgs,
	type TerminalIdentity,
	type TerminalReadout,
	type TerminalService,
} from "../contracts/session.js";
import { createTerminalCwdResolver } from "./integrations/kilo-workspace-cwd.js";
import { NodePtyAdapter } from "./sessions/NodePtyAdapter.js";
import { TerminalSessionManager } from "./sessions/TerminalSessionManager.js";
import type { PtyAdapter } from "./sessions/pty.js";

export interface TerminalManagerLike {
	attach(port: HostMessagePort, args: TerminalConnectionArgs): Promise<void>;
	close(
		identity: { readonly sessionId: string; readonly terminalId: string },
		deleteHistory: boolean,
	): Promise<void>;
	read(identity: TerminalIdentity, lines: number): Promise<TerminalReadout | null>;
	dispose(): Promise<void>;
}

export interface TerminalFeatureOptions {
	readonly adapter?: PtyAdapter;
	readonly manager?: TerminalManagerLike;
	readonly resolveBundleRoot?: () => string | undefined;
}

export function mainRegister(mainSdk: MainSdk, options: TerminalFeatureOptions = {}): void {
	const manager =
		options.manager ??
		new TerminalSessionManager({
			adapter: options.adapter ?? new NodePtyAdapter(),
			storageDir: mainSdk.storageDir,
			resolveCwd: createTerminalCwdResolver(mainSdk),
			onSessionExited: (identity) => mainSdk.events.emit(TERMINAL_SESSION_EXITED, identity),
			logger: mainSdk.logger,
		});
	mainSdk.onDispose(() => manager.dispose());
	mainSdk.ports.handle("session", terminalConnectionArgsSchema, (port, args) =>
		manager.attach(port, args),
	);
	const api: TerminalService = {
		close: async ({ sessionId, terminalId, deleteHistory }) => {
			await manager.close({ sessionId, terminalId }, deleteHistory ?? false);
			return undefined;
		},
		read: ({ sessionId, terminalId, lines }) => manager.read({ sessionId, terminalId }, lines),
	};
	mainSdk.channels(terminalContract).handleAll(api);

	const embeddedWebHost = {
		host: TERMINAL_HOST,
		root: options.resolveBundleRoot?.() ?? mainSdk.resolvePluginAsset("build/terminal"),
	} satisfies EmbeddedWebHost;
	mainSdk.plugins.expose(EMBEDDED_WEB_HOST_CAPABILITY, embeddedWebHost);
}

export { NodePtyAdapter, TerminalSessionManager };
