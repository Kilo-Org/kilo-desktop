import {
	TOOL_CATALOG_PORT_CHANNEL,
	toolCatalogPortArgsSchema,
	type MainSdkPorts,
	type MainSdkStorage,
} from "@kilo-desktop/feature-sdk";

import type { AgentToolSignInState, ExternalClientsState } from "../../contracts/schemas.js";
import { AgentToolSignIn } from "./agent-tool-sign-in.js";
import {
	DEFAULT_EXTERNAL_CLIENTS_SETTINGS,
	ExternalClients,
	type ExternalClientsSettings,
} from "./external-clients.js";
import { KiloToolEndpoint, type KiloToolEndpointConnection } from "./kilo-tool-endpoint.js";
import { ToolCatalog } from "./tool-catalog.js";

/**
 * Desktop's agent-tool gateway: the main-process catalog of the app's tools,
 * fed by the app renderer over a MessagePort, and the MCP endpoints that serve
 * it — one for the bundled Kilo CLI, one for paired external AI apps. This is
 * the module's only public entry; the rest of kilo-server must not import
 * gateway internals.
 */

export type { KiloToolEndpointConnection } from "./kilo-tool-endpoint.js";

export type ToolGatewayChannel = "development" | "preview" | "stable";

/** Fixed per channel so client configs keep working; editable in Settings. */
const EXTERNAL_CLIENTS_DEFAULT_PORT: Record<ToolGatewayChannel, number> = {
	stable: 9350,
	preview: 9351,
	development: 9352,
};

export function externalClientsDefaultPort(channel: ToolGatewayChannel): number {
	return EXTERNAL_CLIENTS_DEFAULT_PORT[channel];
}

export interface ToolGatewayLogger {
	info(message: string): void;
	warn(message: string): void;
}

/** Settings operations for paired external AI apps. */
export interface ExternalClientsControl {
	getState(): ExternalClientsState;
	setEnabled(enabled: boolean): Promise<ExternalClientsState>;
	setPort(port: number | null): Promise<ExternalClientsState>;
	createClient(name: string): ReturnType<ExternalClients["createClient"]>;
	revokeClient(id: string): Promise<ExternalClientsState>;
}

/** Sign-in gating for tools that require sign-in, shared by every agent. */
export interface AgentToolSignInControl {
	getState(): AgentToolSignInState;
	/**
	 * The user chose not to sign in for a feature (`scope`, its feature id):
	 * withdraw that feature's sign-in tools from agents until they do.
	 */
	decline(scope: string): AgentToolSignInState;
	/** The user signed in: forget a decline. */
	signedIn(): void;
}

export interface ToolGateway {
	/**
	 * Start the endpoint the bundled Kilo CLI connects to. Resolves undefined
	 * (after logging) when it cannot start; Kilo then runs without app tools.
	 */
	startKiloEndpoint(): Promise<KiloToolEndpointConnection | undefined>;
	/** Start the external AI apps endpoint if the user enabled it. */
	startExternalClients(): Promise<void>;
	readonly externalClients: ExternalClientsControl;
	readonly signIn: AgentToolSignInControl;
	dispose(): Promise<void>;
}

export interface CreateToolGatewayOptions {
	readonly ports: MainSdkPorts;
	readonly storage: MainSdkStorage;
	readonly logger: ToolGatewayLogger;
	readonly channel: ToolGatewayChannel;
	readonly onExternalClientsChange?: (state: ExternalClientsState) => void;
	/** Whether External AI apps is available (feature flag); defaults to always. */
	readonly isExternalClientsAvailable?: () => boolean;
	/**
	 * Whether the user is signed in, asked on every call to a tool that requires
	 * sign-in. Without it such calls are refused (fail closed).
	 */
	readonly isSignedIn?: () => Promise<boolean>;
	readonly onSignInChange?: (state: AgentToolSignInState) => void;
}

export function createToolGateway({
	ports,
	storage,
	logger,
	channel,
	onExternalClientsChange,
	isExternalClientsAvailable,
	isSignedIn = async () => false,
	onSignInChange,
}: CreateToolGatewayOptions): ToolGateway {
	const catalog = new ToolCatalog({ logger });
	const signIn = new AgentToolSignIn(isSignedIn);
	if (onSignInChange) signIn.subscribe(() => onSignInChange(signIn.state));
	const kiloEndpoint = new KiloToolEndpoint({ catalog, signIn });
	const externalClients = new ExternalClients({
		catalog,
		signIn,
		store: storage.kv<ExternalClientsSettings>({
			defaults: DEFAULT_EXTERNAL_CLIENTS_SETTINGS,
			namespace: "external-clients",
		}),
		defaultPort: externalClientsDefaultPort(channel),
		logger,
		...(onExternalClientsChange ? { onChange: onExternalClientsChange } : {}),
		...(isExternalClientsAvailable ? { isAvailable: isExternalClientsAvailable } : {}),
	});
	let disposed = false;

	// The shell only transfers ports from trusted app frames, and only the
	// main window publishes tools; a reloaded window replaces its old port.
	ports.handle(TOOL_CATALOG_PORT_CHANNEL, toolCatalogPortArgsSchema, (port) => {
		catalog.attach(port);
	});

	return {
		async startKiloEndpoint() {
			if (disposed) return undefined;
			try {
				const connection = await kiloEndpoint.start();
				if (disposed) {
					await kiloEndpoint.stop();
					return undefined;
				}
				logger.info(`Agent tool endpoint for Kilo listening on ${connection.url}.`);
				return connection;
			} catch (error) {
				await kiloEndpoint.stop().catch(() => undefined);
				logger.warn(
					`Agent tool endpoint for Kilo not started: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
		},
		async startExternalClients() {
			if (disposed) return;
			await externalClients.init();
		},
		externalClients: {
			getState: () => externalClients.getState(),
			setEnabled: (enabled) => externalClients.setEnabled(enabled),
			setPort: (port) => externalClients.setPort(port),
			createClient: (name) => externalClients.createClient(name),
			revokeClient: (id) => externalClients.revokeClient(id),
		},
		signIn: {
			getState: () => signIn.state,
			decline: (scope) => signIn.decline(scope),
			signedIn: () => signIn.signedIn(),
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			catalog.dispose();
			await Promise.all([
				kiloEndpoint.stop().catch(() => undefined),
				externalClients.dispose().catch(() => undefined),
			]);
		},
	};
}
