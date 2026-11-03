import { definePlugin, KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { OnboardingStep, Overlay } from "@kilo-desktop/plugin-shell/contracts";

import { Workspaces, type Workspace } from "../contracts";
import { workspaceStep } from "./onboarding/workspace-step";
import { workspaceDialog, WorkspacesOverlay } from "./workspace-dialog-store";

/** kilo.workspaces' renderer entry: the workspace dialogs, their commands and the onboarding step. */
export const workspacesWebEntry = definePlugin({
	activate(sdk) {
		// A window starts with no workspace dialog open.
		workspaceDialog.close();
		sdk.extensions.implement(Overlay, "dialogs", WorkspacesOverlay);
		sdk.extensions.implement(KernelCommand, "add", () => workspaceDialog.open({ mode: "create" }));
		sdk.extensions.implement(KernelCommand, "manage", () =>
			workspaceDialog.open({ mode: "manage" }),
		);
		sdk.extensions.implement(KernelCommand, "edit", (args) => {
			const workspace = workspaceFromArgs(sdk, args);
			if (workspace) workspaceDialog.open({ mode: "edit", workspace });
		});
		sdk.extensions.implement(KernelCommand, "delete", (args) => {
			const workspace = workspaceFromArgs(sdk, args);
			if (workspace) workspaceDialog.open({ mode: "delete", workspace });
		});
		sdk.extensions.implement(OnboardingStep, "workspace", workspaceStep);
		if (!sdk.context.get("kernel/secondaryWindow")) handOverLegacyActive(sdk);
	},
});

/** Where origin kept the active workspace id, in the main window's localStorage. */
const LEGACY_ACTIVE_KEY = "kilo-ui.active-workspace";
const LEGACY_ACTIVE_HANDED_OVER = "kilo.workspaces.legacy-active-handed-over";

/**
 * Main can't read the renderer's localStorage, so the main window makes
 * origin's active workspace active once it exists here (origin's workspaces
 * are imported in the background) and nothing else is active yet. Origin's
 * key is left alone so a downgrade still finds it.
 */
function handOverLegacyActive(sdk: PluginSdk): void {
	const legacyId = localStorage.getItem(LEGACY_ACTIVE_KEY);
	if (!legacyId || localStorage.getItem(LEGACY_ACTIVE_HANDED_OVER)) return;
	let stop: (() => void) | undefined;
	const tryHandOver = (state: { workspaces: readonly Workspace[]; activeId: string | null }) => {
		if (state.activeId !== null) return finish();
		if (!state.workspaces.some((workspace) => workspace.id === legacyId)) return;
		finish();
		void sdk.domains
			.get(Workspaces)
			?.methods.setActive({ id: legacyId })
			.catch(() => undefined);
	};
	const finish = () => {
		localStorage.setItem(LEGACY_ACTIVE_HANDED_OVER, "1");
		stop?.();
		stop = undefined;
	};
	sdk.domains.track(Workspaces, {
		added: (workspaces) => {
			stop = workspaces.subscribe(tryHandOver);
			tryHandOver(workspaces.getState());
		},
		removed: () => {
			stop?.();
			stop = undefined;
		},
	});
	sdk.onDispose(() => stop?.());
}

/** The workspace named by `{ workspaceId }` in a command's arguments. */
function workspaceFromArgs(sdk: PluginSdk, args: unknown): Workspace | undefined {
	const workspaceId = (args as { workspaceId?: unknown } | undefined)?.workspaceId;
	if (typeof workspaceId !== "string") return undefined;
	return sdk.domains
		.get(Workspaces)
		?.getState()
		.workspaces.find((workspace) => workspace.id === workspaceId);
}
