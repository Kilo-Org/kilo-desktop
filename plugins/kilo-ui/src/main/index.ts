import path from "node:path";

import type { KiloGlobalConnection, KiloUiChatService } from "../contracts/chat/schemas.js";
import type { OnboardingService } from "../contracts/onboarding/schemas.js";
import type { ModelPreferencesService } from "../contracts/model-preferences/schemas.js";
import type { KiloUiProvidersService } from "../contracts/providers/schemas.js";
import type {
	WorkspaceCapabilityService,
	WorkspacesService,
} from "../contracts/workspaces/schemas.js";
import {
	EMBEDDED_WEB_HOST_CAPABILITY,
	FeatureError,
	type MainSdk,
} from "@kilo-desktop/feature-sdk/main";

import { kiloUiChatContract } from "../contracts/chat/schemas.js";
import { mcpAppsContract } from "../contracts/mcp-apps/schemas.js";
import { onboardingContract } from "../contracts/onboarding/schemas.js";
import { modelPreferencesContract } from "../contracts/model-preferences/schemas.js";
import { kiloUiProvidersContract } from "../contracts/providers/schemas.js";
import { workspacesContract } from "../contracts/workspaces/schemas.js";
import { workspaceStatusContract } from "../contracts/workspaces/status.js";
import { createSaveHtmlPageHandler } from "./html-render/save-html-page.js";
import { createMcpAppEmbeddedHost } from "./mcp-apps/mcp-app-host.js";
import {
	createMcpAppsHandlers,
	registerLocalMcpAppResource,
	unregisterLocalMcpAppResource,
} from "./mcp-apps/mcp-apps-handlers.js";
import { OnboardingStore } from "./onboarding/OnboardingStore.js";
import { TermsAcceptanceStore } from "./onboarding/TermsAcceptanceStore.js";
import { ModelPreferenceStore } from "./model-preferences/ModelPreferenceStore.js";
import { presentEnvNames } from "./providers/present-env.js";
import { readStoredApiKey } from "./providers/stored-api-key.js";
import { createWorkspacesDatabase } from "./workspaces/db.js";
import { WorkspaceService } from "./workspaces/WorkspaceService.js";
import { WorkspaceFolderStatusService } from "./workspaces/WorkspaceFolderStatusService.js";
import { startAgentManagerLinkBackfill } from "./chat/agent-manager-session-links.js";
import { createChatWorktreeHandlers } from "./chat/chat-worktree-handlers.js";
import { fetchGatewayModelDetails } from "./chat/gateway-model-details.js";
import { createWorkspaceSessionUnscoper } from "./chat/unscope-workspace-sessions.js";
import { WorkspaceSessionCleanupQueue } from "./chat/workspace-session-cleanup-queue.js";
import { registerLayoutPresets } from "./layout-presets/register.js";
import { registerSessions } from "./sessions/register.js";
import { registerWorkspaceBoard } from "./workspace-board/register.js";

type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloGlobalConnection>;
	};
};

export function mainRegister(
	mainSdk: MainSdk,
	options: { unscopeWorkspaceSessions?: (workspaceId: string) => Promise<void> } = {},
): void {
	const db = createWorkspacesDatabase(
		path.join(mainSdk.storageDir, "data.db"),
		mainSdk.resolvePluginAsset("drizzle"),
	);
	const service = new WorkspaceService(db);
	const workspaceStatus = new WorkspaceFolderStatusService();
	const unscopeWorkspaceSessions =
		options.unscopeWorkspaceSessions ?? createWorkspaceSessionUnscoper(mainSdk);
	const cleanup = new WorkspaceSessionCleanupQueue(mainSdk, unscopeWorkspaceSessions);
	cleanup.retryPending();

	const api: WorkspacesService = {
		list: async () => service.list(),
		get: async ({ id }) => service.get(id),
		create: async (input) => {
			const after = service.create(input);
			mainSdk.events.emit("workspace-created", { before: null, after });
			return after;
		},
		update: async ({ id, ...input }) => {
			const before = service.getRequired(id);
			const after = service.update(id, input);
			mainSdk.events.emit("workspace-updated", { before, after });
			return after;
		},
		remove: async ({ id }) => {
			const before = service.remove(id);
			mainSdk.events.emit("workspace-deleted", { before, after: null });
			cleanup.enqueue(id);
			return { deleted: true };
		},
	};

	const workspaceService = {
		list: () => api.list(),
		get: (id) => api.get({ id }),
		create: (input) => api.create(input),
		update: (input) => api.update(input),
		remove: (id) => api.remove({ id }),
	} satisfies WorkspaceCapabilityService;

	// Single source for resolving the Kilo Server connection — shared by the
	// chat contract and the MCP Apps handlers so the error semantics stay in sync.
	const getConnection = async (): Promise<KiloGlobalConnection> => {
		const connectionService =
			mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
		if (!connectionService) {
			throw new FeatureError("Kilo Server is unavailable.", "BUSINESS");
		}
		return connectionService.getConnection();
	};

	const chatApi: KiloUiChatService = {
		"chat.getConnection": async () => getConnection(),
		"chat.getGatewayModelDetails": async () => fetchGatewayModelDetails(mainSdk.net.fetch),
		...createChatWorktreeHandlers(mainSdk, service),
		"chat.saveHtmlPage": createSaveHtmlPageHandler(() =>
			service.list().flatMap(({ folders }) => folders.map(({ path }) => path)),
		),
	};

	const onboarding = new OnboardingStore(mainSdk);
	const terms = new TermsAcceptanceStore(mainSdk, { env: process.env });
	const onboardingApi: OnboardingService = {
		"onboarding.get": async () => onboarding.get(),
		"onboarding.complete": async () => onboarding.complete(),
		"onboarding.skip": async () => onboarding.skip(),
		"onboarding.terms.get": async () => terms.get(),
		"onboarding.terms.accept": async ({ version, accountKey }) => terms.accept(version, accountKey),
		"onboarding.terms.markLinked": async ({ accountKey }) => terms.markLinked(accountKey),
	};
	const modelPreferences = new ModelPreferenceStore(mainSdk);
	const modelPreferencesApi: ModelPreferencesService = {
		"modelPreferences.get": async () => modelPreferences.get(),
		"modelPreferences.remember": async ({ agent, model, effort }) =>
			modelPreferences.remember({
				agent,
				model,
				...(effort === undefined ? {} : { effort }),
			}),
		"modelPreferences.recordRecent": async (model) => modelPreferences.recordRecent(model),
		"modelPreferences.setAutoFreeEnabled": async (enabled) =>
			modelPreferences.setAutoFreeEnabled(enabled),
	};

	const providersApi: KiloUiProvidersService = {
		"providers.getApiKey": async ({ providerID }) => ({
			key: await readStoredApiKey(providerID),
		}),
		"providers.presentEnv": async ({ names }) => ({
			names: presentEnvNames(names),
		}),
	};

	mainSdk.plugins.expose("workspaceService", workspaceService);
	mainSdk.plugins.expose("localMcpApps", {
		register: registerLocalMcpAppResource,
		unregister: unregisterLocalMcpAppResource,
	});
	// Dedicated isolated origin for untrusted MCP App widget HTML (EoP 7): keeps
	// the trusted app origin free of `script-src 'unsafe-inline'`.
	mainSdk.plugins.expose(EMBEDDED_WEB_HOST_CAPABILITY, createMcpAppEmbeddedHost());
	mainSdk.channels(workspacesContract).handleAll(api);
	mainSdk.channels(workspaceStatusContract).handleAll({
		"workspaceStatus.list": () => workspaceStatus.list(service.list()),
	});
	mainSdk.channels(kiloUiChatContract).handleAll(chatApi);
	mainSdk.channels(onboardingContract).handleAll(onboardingApi);
	mainSdk.channels(modelPreferencesContract).handleAll(modelPreferencesApi);
	mainSdk.channels(kiloUiProvidersContract).handleAll(providersApi);
	registerLayoutPresets(mainSdk);
	const board = registerWorkspaceBoard(mainSdk);
	registerSessions(mainSdk, db, board);

	const mcpAppsApi = createMcpAppsHandlers(getConnection, mainSdk.net.fetch);
	mainSdk.channels(mcpAppsContract).handleAll(mcpAppsApi);

	const stopLinkBackfill = startAgentManagerLinkBackfill(mainSdk);

	mainSdk.onDispose(() => {
		stopLinkBackfill();
		db.$client.close();
	});
}
