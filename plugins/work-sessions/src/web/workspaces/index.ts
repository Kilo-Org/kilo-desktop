import { KernelCommand, KernelDialogs, type PluginSdk } from "@kilo-desktop/kernel";
import { Dialog, Navigation, OnboardingStep } from "@kilo-desktop/plugin-shell/contracts";

import {
	WORKSPACE_DIALOGS_KEY,
	Workspaces,
	type Workspace,
	type WorkspaceDialogInput,
} from "../../contracts";
import { reportFailure } from "../shared/report-failure";
import { workspaceStep } from "./onboarding/workspace-step";
import { WorkspaceDialogsDialog } from "./WorkspaceDialogs";

/**
 * The workspaces area: the workspace dialogs (a `kilo.shell/dialog`, opened
 * by the add / manage / edit / delete commands through kilo.shell's
 * navigation), Open folder, and the onboarding step that creates the first
 * workspace.
 */
export function activateWorkspaces(sdk: PluginSdk): void {
	sdk.extensions.implement(Dialog, "workspace-dialogs", WorkspaceDialogsDialog);
	const command = (id: string, input: (args: unknown) => WorkspaceDialogInput | null) =>
		sdk.extensions.implement(KernelCommand, id, async (args) => {
			const dialogInput = input(args);
			if (!dialogInput) return;
			await sdk.domainObjects
				.get(Navigation)
				?.methods.openDialog({ dialog: WORKSPACE_DIALOGS_KEY, input: dialogInput });
		});
	command("add-workspace", () => ({ mode: "create" }));
	command("manage-workspaces", () => ({ mode: "manage" }));
	sdk.extensions.implement(KernelCommand, "open-folder", () =>
		openFolder(sdk).catch(reportFailure("Could not open folder", "No workspace was opened.")),
	);
	command("edit-workspace", (args) => {
		const workspace = workspaceFromArgs(sdk, args);
		return workspace ? { mode: "edit", workspaceId: workspace.id } : null;
	});
	command("delete-workspace", (args) => {
		const workspace = workspaceFromArgs(sdk, args);
		return workspace ? { mode: "delete", workspaceId: workspace.id } : null;
	});
	sdk.extensions.implement(OnboardingStep, "workspace", workspaceStep);
	if (!sdk.context.get("kernel/secondaryWindow")) handOverLegacyActive(sdk);
}

/** Where origin kept the active workspace id, in the main window's localStorage. */
const LEGACY_ACTIVE_KEY = "kilo-ui.active-workspace";
/** Kept from kilo.workspaces, so a window that handed it over then doesn't again. */
const LEGACY_ACTIVE_HANDED_OVER = "kilo.workspaces.legacy-active-handed-over";

/**
 * Main can't read the renderer's localStorage, so the main window makes
 * origin's active workspace active once it exists here (origin's workspaces
 * are adopted in the background) and nothing else is active yet. Origin's
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
		void sdk.domainObjects
			.get(Workspaces)
			?.methods.setActive({ id: legacyId })
			.catch(() => undefined);
	};
	const finish = () => {
		localStorage.setItem(LEGACY_ACTIVE_HANDED_OVER, "1");
		stop?.();
		stop = undefined;
	};
	sdk.domainObjects.track(Workspaces, {
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

/**
 * The one-step way in: the folder's workspace becomes active. A workspace
 * whose primary folder it already is is reused rather than duplicated;
 * otherwise a new one takes the folder's name (made unique by `create`).
 */
async function openFolder(sdk: PluginSdk): Promise<void> {
	const dialogs = sdk.domainObjects.get(KernelDialogs);
	const workspaces = sdk.domainObjects.get(Workspaces);
	if (!dialogs || !workspaces) return;
	const {
		paths: [path],
	} = await dialogs.methods.open({ title: "Open folder", directory: true });
	if (!path) return;
	const existing = workspaces
		.getState()
		.workspaces.find((workspace) =>
			workspace.folders.some((folder) => folder.isPrimary && folder.path === path),
		);
	const id =
		existing?.id ??
		(
			await workspaces.methods.create({
				folders: [{ path, isPrimary: true }],
				source: "open-folder",
			})
		).id;
	await workspaces.methods.setActive({ id });
}

/** The workspace named by `{ workspaceId }` in a command's arguments. */
function workspaceFromArgs(sdk: PluginSdk, args: unknown): Workspace | undefined {
	const workspaceId = (args as { workspaceId?: unknown } | undefined)?.workspaceId;
	if (typeof workspaceId !== "string") return undefined;
	return sdk.domainObjects
		.get(Workspaces)
		?.getState()
		.workspaces.find((workspace) => workspace.id === workspaceId);
}
