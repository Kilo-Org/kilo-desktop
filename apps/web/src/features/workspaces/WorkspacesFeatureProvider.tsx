import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import type {
	Workspace,
	WorkspaceCapabilityService,
	WorkspaceCapabilities,
	WorkspacesService,
} from "@anaconda-agentic-desktop/contracts";
import type { SDK, StoreHandle } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { WorkspaceDialogs, type WorkspaceDialogState } from "./WorkspaceDialogs";

export const workspacesQueryKey = ["workspaces", "list"] as const;
const ACTIVE_WORKSPACE_KEY = "workspaces.active-workspace";

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
	if (!sdk.plugins.get<WorkspaceCapabilities>("workspaces")?.workspaceService) {
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

type WorkspacesContextValue = {
	workspaces: Workspace[];
	activeWorkspaceId: string | null;
	setActiveWorkspaceId(id: string | null): void;
	isLoading: boolean;
	isUnavailable: boolean;
	openCreate(): void;
	openEdit(workspace: Workspace): void;
	openDelete(workspace: Workspace): void;
};

const WorkspacesContext = createContext<WorkspacesContextValue | null>(null);

export function useWorkspacesFeature(): WorkspacesContextValue {
	const value = useContext(WorkspacesContext);
	if (!value)
		throw new Error("useWorkspacesFeature must be used within WorkspacesFeatureProvider.");
	return value;
}

export function WorkspacesFeatureProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk<WorkspacesService>("workspaces");
	const queryClient = useQueryClient();
	const bootstrap = ensureBootstrap(sdk);
	const activeStore = sdk.state.get<string | null>(ACTIVE_WORKSPACE_KEY);
	const activeWorkspaceId = useSyncExternalStore(
		activeStore.subscribe,
		activeStore.peek,
		activeStore.peek,
	);
	const [dialog, setDialog] = useState<WorkspaceDialogState>(null);
	const query = useQuery({
		queryKey: workspacesQueryKey,
		queryFn: () => sdk.client.list(),
	});
	const workspaces = query.data ?? [];

	const setActiveWorkspaceId = (id: string | null) => bootstrap.activeHandle.set(id);

	useEffect(() => {
		if (activeWorkspaceId) localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId);
		else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
	}, [activeWorkspaceId]);

	useEffect(() => {
		if (!query.isSuccess) return;
		if (activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
			return;
		}
		// A newly created id can be selected before the list refetch lands; wait for it.
		if (activeWorkspaceId && query.isFetching) return;
		setActiveWorkspaceId(workspaces[0]?.id ?? null);
	}, [activeWorkspaceId, query.isFetching, query.isSuccess, workspaces]);

	useEffect(() => {
		const invalidate = () => {
			void queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
		};
		const unsubscribers = [
			sdk.events.on("workspaces.workspace-created", invalidate),
			sdk.events.on("workspaces.workspace-updated", invalidate),
			sdk.events.on("workspaces.workspace-deleted", invalidate),
			sdk.events.on("workspaces.open-manager", () =>
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
