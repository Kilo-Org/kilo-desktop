import {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	normalizeWorkspaceIdentityColor,
	type Workspace,
	type WorkspaceCapabilityService,
	type WorkspaceFolderInput,
	type WorkspacesService,
} from "../contracts/workspaces/schemas.js";
import type { KiloUiChatService } from "../contracts/chat/schemas.js";
import type { OnboardingService, OnboardingState } from "../contracts/onboarding/schemas.js";
import type {
	ModelPreferencesService,
	PersistedModelPreferences,
} from "../contracts/model-preferences/schemas.js";
import type { KiloUiProvidersService } from "../contracts/providers/schemas.js";
import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk";

import { kiloUiChatContract } from "../contracts/chat/schemas.js";
import {
	KILO_TERMS_VERSION,
	ONBOARDING_VERSION,
	onboardingContract,
} from "../contracts/onboarding/schemas.js";
import { modelPreferencesContract } from "../contracts/model-preferences/schemas.js";
import { kiloUiProvidersContract } from "../contracts/providers/schemas.js";
import { workspacesContract } from "../contracts/workspaces/schemas.js";
import { workspaceStatusContract } from "../contracts/workspaces/status.js";
import { registerLayoutPresets } from "../main/layout-presets/register.js";
import {
	registerWorkspaceBoard,
	type WorkspaceBoardStore,
} from "../main/workspace-board/register.js";
import { DEFAULT_WORKSPACE_BOARD } from "../contracts/workspace-board/board-model.js";
import {
	createInMemoryTermsStorage,
	TermsAcceptanceStore,
} from "../main/onboarding/TermsAcceptanceStore.js";
import type { LayoutPresetsState } from "../contracts/layout-presets/schemas.js";

const basename = (folderPath: string) =>
	folderPath
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.at(-1) || "Workspace";

function registerWorkspacesBrowser(mainSdk: MainSdk): void {
	let workspaces: Workspace[] = [];

	const validate = (folders: WorkspaceFolderInput[]) => {
		if (folders.length === 0 || folders.filter((folder) => folder.isPrimary).length !== 1) {
			throw new FeatureError("A workspace needs exactly one primary folder.", "VALIDATION");
		}
		const paths = folders.map((folder) => folder.path);
		if (new Set(paths).size !== paths.length) {
			throw new FeatureError("Workspace folders must be unique.", "VALIDATION");
		}
		const primary = folders.find((folder) => folder.isPrimary)!;
		return [primary, ...folders.filter((folder) => !folder.isPrimary)];
	};

	const resolveName = (rawName: string | undefined, primaryPath: string, excludeId?: string) => {
		const supplied = rawName?.trim();
		if (supplied) return supplied;
		const base = basename(primaryPath);
		const occupied = new Set(
			workspaces
				.filter((workspace) => workspace.id !== excludeId)
				.map((workspace) => workspace.name.toLocaleLowerCase()),
		);
		if (!occupied.has(base.toLocaleLowerCase())) return base;
		for (let suffix = 2; ; suffix += 1) {
			const candidate = `${base} (${suffix})`;
			if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
		}
	};

	const find = (id: string) => workspaces.find((candidate) => candidate.id === id) ?? null;
	const findRequired = (id: string) => {
		const workspace = find(id);
		if (!workspace) throw new FeatureError("Workspace not found.", "NOT_FOUND");
		return workspace;
	};

	const service: WorkspacesService = {
		list: async () =>
			[...workspaces].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			),
		get: async ({ id }) => find(id),
		create: async (input) => {
			const folders = validate(input.folders);
			const timestamp = Date.now();
			const after: Workspace = {
				id: crypto.randomUUID(),
				name: resolveName(input.name, folders[0]!.path),
				color: normalizeWorkspaceIdentityColor(input.color) ?? DEFAULT_WORKSPACE_IDENTITY_COLOR,
				folders: folders.map((folder, position) => ({
					id: crypto.randomUUID(),
					path: folder.path,
					isPrimary: position === 0,
					position,
				})),
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			workspaces.push(after);
			mainSdk.events.emit("workspace-created", { before: null, after });
			return after;
		},
		update: async ({ id, ...input }) => {
			const before = findRequired(id);
			const folders = validate(input.folders);
			const ids = new Map(before.folders.map((folder) => [folder.path, folder.id]));
			const after: Workspace = {
				...before,
				name:
					input.name === undefined ? before.name : resolveName(input.name, folders[0]!.path, id),
				color:
					input.color === undefined
						? before.color
						: (normalizeWorkspaceIdentityColor(input.color) ?? before.color),
				folders: folders.map((folder, position) => ({
					id: ids.get(folder.path) ?? crypto.randomUUID(),
					path: folder.path,
					isPrimary: position === 0,
					position,
				})),
				updatedAt: Date.now(),
			};
			workspaces = workspaces.map((workspace) => (workspace.id === id ? after : workspace));
			mainSdk.events.emit("workspace-updated", { before, after });
			return after;
		},
		remove: async ({ id }) => {
			const before = findRequired(id);
			workspaces = workspaces.filter((workspace) => workspace.id !== id);
			mainSdk.events.emit("workspace-deleted", { before, after: null });
			return { deleted: true };
		},
	};

	const workspaceService = {
		list: () => service.list(),
		get: (id) => service.get({ id }),
		create: (input) => service.create(input),
		update: (input) => service.update(input),
		remove: (id) => service.remove({ id }),
	} satisfies WorkspaceCapabilityService;

	mainSdk.plugins.expose("workspaceService", workspaceService);
	mainSdk.channels(workspacesContract).handleAll(service);
	mainSdk.channels(workspaceStatusContract).handleAll({
		"workspaceStatus.list": async () =>
			workspaces.map((workspace) => ({ workspaceId: workspace.id, unavailableFolders: [] })),
	});
}

function registerChatBrowser(mainSdk: MainSdk): void {
	const chatApi: KiloUiChatService = {
		"chat.getConnection": async () => {
			throw new FeatureError("Kilo Server requires the desktop app.", "BUSINESS");
		},
		"chat.getGatewayModelDetails": async () => [],
		"chat.prepareSession": async () => {
			throw new FeatureError("Kilo Server requires the desktop app.", "BUSINESS");
		},
		"chat.renameWorktreeBranch": async () => {
			// Best-effort rename degrades to a decline in browser mode.
			return null;
		},
		"chat.removeWorktree": async () => {
			throw new FeatureError("Git worktrees require the desktop app.", "BUSINESS");
		},
		// Best-effort: browser mode has no git capability, so no work is possible.
		"chat.hasWorktreeWork": async () => false,
		"chat.linkWorktreeSession": async () => undefined,
		"chat.saveHtmlPage": async () => {
			throw new FeatureError("Saving to the workspace requires the desktop app.", "BUSINESS");
		},
	};
	mainSdk.channels(kiloUiChatContract).handleAll(chatApi);
}

function registerProvidersBrowser(mainSdk: MainSdk): void {
	const providersApi: KiloUiProvidersService = {
		"providers.getApiKey": async () => ({ key: null }),
		"providers.presentEnv": async () => ({ names: [] }),
	};
	mainSdk.channels(kiloUiProvidersContract).handleAll(providersApi);
}

function registerOnboardingBrowser(mainSdk: MainSdk): void {
	let state: OnboardingState = { outcome: null, closedAt: null, version: null };
	// Browser mode is the unshipped dev/test harness (no Kilo CLI), where
	// onboarding never showed; keep the terms gate out of its way too.
	const terms = new TermsAcceptanceStore(mainSdk, {
		storage: createInMemoryTermsStorage({
			version: KILO_TERMS_VERSION,
			acceptedAt: Date.now(),
			linkedAccounts: [],
		}),
	});
	const onboardingApi: OnboardingService = {
		"onboarding.terms.get": async () => terms.get(),
		"onboarding.terms.accept": async ({ version, accountKey }) => terms.accept(version, accountKey),
		"onboarding.terms.markLinked": async ({ accountKey }) => terms.markLinked(accountKey),
		"onboarding.get": async () => state,
		"onboarding.complete": async () => {
			state = { outcome: "completed", closedAt: Date.now(), version: ONBOARDING_VERSION };
			return state;
		},
		"onboarding.skip": async () => {
			state = { outcome: "skipped", closedAt: Date.now(), version: ONBOARDING_VERSION };
			return state;
		},
	};
	mainSdk.channels(onboardingContract).handleAll(onboardingApi);
}

function registerModelPreferencesBrowser(mainSdk: MainSdk): void {
	let preferences: PersistedModelPreferences = {
		modelSelections: {},
		variantSelections: {},
		recentModels: [],
		autoFreeModelsEnabled: true,
	};
	const recordRecent = (model: { providerID: string; modelID: string }) => {
		const key = `${model.providerID}/${model.modelID}`;
		return [
			model,
			...preferences.recentModels.filter(
				(candidate) => `${candidate.providerID}/${candidate.modelID}` !== key,
			),
		].slice(0, 5);
	};
	const service: ModelPreferencesService = {
		"modelPreferences.get": async () => preferences,
		"modelPreferences.remember": async ({ agent, model, effort }) => {
			const variant = effort ?? "";
			preferences = {
				modelSelections: { ...preferences.modelSelections, [agent]: model },
				preferred: { ...model, variant },
				variantSelections: {
					...preferences.variantSelections,
					[`${agent}/${model.providerID}/${model.modelID}`]: variant,
				},
				recentModels: recordRecent(model),
				autoFreeModelsEnabled: preferences.autoFreeModelsEnabled,
			};
			return preferences;
		},
		"modelPreferences.recordRecent": async (model) => {
			preferences = { ...preferences, recentModels: recordRecent(model) };
			return preferences;
		},
		"modelPreferences.setAutoFreeEnabled": async (enabled) => {
			preferences = { ...preferences, autoFreeModelsEnabled: enabled };
			return preferences;
		},
	};
	mainSdk.channels(modelPreferencesContract).handleAll(service);
}

export function kiloUiBrowserRegister(mainSdk: MainSdk): void {
	registerWorkspacesBrowser(mainSdk);
	registerChatBrowser(mainSdk);
	registerProvidersBrowser(mainSdk);
	registerOnboardingBrowser(mainSdk);
	registerModelPreferencesBrowser(mainSdk);
	let layouts = { version: 1, state: { presets: [], defaultPresetId: null } as LayoutPresetsState };
	registerLayoutPresets(mainSdk, {
		snapshot: () => layouts,
		set: (value) => {
			layouts = value;
		},
	});
	let board: unknown = { version: 1, state: DEFAULT_WORKSPACE_BOARD };
	const boardStore: WorkspaceBoardStore = {
		snapshot: () => board,
		set: (value) => {
			board = value;
		},
	};
	registerWorkspaceBoard(mainSdk, boardStore);
}
