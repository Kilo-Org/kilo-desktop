import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import type {
	WorkspaceCapabilityService,
	WorkspaceCapabilities,
	WorkspacesService,
} from "../../contracts/workspaces/schemas.js";
import { type SDK, type StoreHandle } from "@kilo-desktop/feature-sdk";
import { sdkQueryKey, useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";

import { WorkspaceDialogs, type WorkspaceDialogState } from "./WorkspaceDialogs";
import { WorkspacesContext, type WorkspacesContextValue } from "./WorkspacesFeatureContext";

const ACTIVE_WORKSPACE_KEY = "kilo-ui.active-workspace";

type WorkspacesSdk = SDK<WorkspacesService>;

type Bootstrap = {
	activeHandle: StoreHandle<string | null>;
};

const bootstraps = new WeakMap<WorkspacesSdk, Bootstrap>();

function ensureBootstrap(sdk: WorkspacesSdk): Bootstrap {
	const existing = bootstraps.get(sdk);
	if (existing) return existing;
	const saved = globalThis.localStorage?.getItem(ACTIVE_WORKSPACE_KEY) ?? null;
	const activeHandle = sdk.state.register<string | null>("active-workspace", saved);
	if (!sdk.plugins.get<WorkspaceCapabilities>("kilo-ui")?.workspaceService) {
		const workspaceService = {
			list: () => sdk.client.list(),
			get: (id) => sdk.client.get({ id }),
			create: (input) => sdk.client.create(input),
			update: (input) => sdk.client.update(input),
			remove: (id) => sdk.client.remove({ id }),
		} satisfies WorkspaceCapabilityService;
		sdk.plugins.expose("workspaceService", workspaceService);
	}
	const created = { activeHandle };
	bootstraps.set(sdk, created);
	return created;
}

export function WorkspacesFeatureProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk<WorkspacesService>("kilo-ui");
	const queryClient = useQueryClient();
	const bootstrap = ensureBootstrap(sdk);
	const activeStore = sdk.state.get<string | null>(ACTIVE_WORKSPACE_KEY);
	const activeWorkspaceId = useSyncExternalStore(
		activeStore.subscribe,
		activeStore.peek,
		activeStore.peek,
	);
	const [dialog, setDialog] = useState<WorkspaceDialogState>(null);
	const query = useSdkQuery(sdk, "list");
	const workspaces = query.data ?? [];

	const setActiveWorkspaceId = (id: string | null) => bootstrap.activeHandle.set(id);

	useEffect(() => {
		if (activeWorkspaceId) localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId);
		else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
	}, [activeWorkspaceId]);

	useEffect(() => {
		if (!query.isSuccess) return;
		// null means unscoped — do not auto-pick a workspace.
		if (!activeWorkspaceId) return;
		if (workspaces.some((workspace) => workspace.id === activeWorkspaceId)) return;
		// Avoid clearing from stale data while a create/delete refetch is pending.
		if (query.isFetching) return;
		setActiveWorkspaceId(null);
	}, [activeWorkspaceId, query.isFetching, query.isSuccess, workspaces]);

	useEffect(() => {
		const invalidate = () => {
			void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "list") });
		};
		const unsubscribers = [
			sdk.events.on("kilo-ui.workspace-created", invalidate),
			sdk.events.on("kilo-ui.workspace-updated", invalidate),
			sdk.events.on("kilo-ui.workspace-deleted", invalidate),
			sdk.events.on("kilo-ui.open-manager", () =>
				setDialog(workspaces.length === 0 ? { mode: "create" } : { mode: "manage" }),
			),
		];
		return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
	}, [queryClient, sdk, workspaces.length]);

	const context = useMemo<WorkspacesContextValue>(
		() => ({
			workspaces,
			activeWorkspaceId,
			setActiveWorkspaceId,
			isLoading: query.isLoading,
			isUnavailable: query.isError,
			openCreate: () => setDialog({ mode: "create" }),
			openEdit: (workspace) => setDialog({ mode: "edit", workspace }),
			openDelete: (workspace) => setDialog({ mode: "delete", workspace }),
		}),
		[activeWorkspaceId, query.isError, query.isLoading, workspaces],
	);

	return (
		<WorkspacesContext.Provider value={context}>
			{children}
			<WorkspaceDialogs
				dialog={dialog}
				onClose={() => setDialog(null)}
				onDialogChange={setDialog}
				sdk={sdk}
				queryClient={queryClient}
				workspaces={workspaces}
				activeWorkspaceId={activeWorkspaceId}
				setActiveWorkspaceId={setActiveWorkspaceId}
			/>
		</WorkspacesContext.Provider>
	);
}
