import { ExternalLinkIcon, Minimize2Icon, PanelLeftCloseIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";

import { KernelWindows, type Contribution, type WindowViewProps } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomainObject,
	useDomainObjectState,
	useExtensions,
	useKernel,
	useSdk,
} from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import {
	OPEN_WORK_SESSION_COMMAND,
	SHOW_WORK_SESSIONS_VIEW_COMMAND,
	UNSCOPED_WORKSPACE_FOCUS,
	WorkSessionsView,
	WorkSessionsWindow,
	Workspaces,
	type WorkSessionsViewImplementation,
	type WorkSessionsViewProps,
	type WorkSessionsWindowState,
	type Workspace,
	type WorkspacesState,
} from "../../contracts";
import { SessionLocationBreadcrumb } from "../canvas/SessionLocationBreadcrumb";
import { reportFailure } from "../shared/report-failure";
import { useWorkSessionRenderers } from "../shared/work-session-renderers";
import { resolveWorkspaceFocus } from "../shared/workspace-focus";
import { readSavedWindow, savedWindowKey } from "../window/saved-window";
import { mainWindowId, popOutView } from "./view-windows";

/*
 * Hosting kilo.work-sessions/work-sessions-view: a view shows in the main
 * area in place of the open work session, and a detachable one in its own
 * window. The view gets the main window's workspace focus, a way to open work
 * sessions there, and the session list's renderers.
 */

type ViewContribution = Contribution<typeof WorkSessionsView>;

const NO_WORKSPACES: readonly Workspace[] = [];
const NO_VIEWS: readonly string[] = [];
const selectWorkspaces = (state: WorkspacesState) => state.workspaces;
const selectView = (state: WorkSessionsWindowState) => state.view;
const selectDetached = (state: WorkSessionsWindowState) => state.detachedViews;
const selectFocus = (state: WorkSessionsWindowState) => state.focus;

/** The work sessions view with this key, while it is contributed. */
export function useWorkSessionsView(key: string | null | undefined): ViewContribution | null {
	const views = useExtensions(WorkSessionsView);
	return key ? (views.find((view) => view.key === key) ?? null) : null;
}

/** The work sessions view this window shows in place of the open work session, if any. */
export function useShownWorkSessionsView(): ViewContribution | null {
	return useWorkSessionsView(useDomainObjectState(WorkSessionsWindow, selectView));
}

/**
 * The main window's focus. A pop-out has no window object of its own, so it
 * follows the main window's saved one.
 */
function useMainWindowFocus(): string | null {
	const navigator = useDomainObject(WorkSessionsWindow);
	const ownFocus = useDomainObjectState(WorkSessionsWindow, selectFocus);
	const mainId = useDomainObjectState(KernelWindows, mainWindowId) ?? "main";
	const [savedFocus, setSavedFocus] = useState(() => readSavedWindow(mainId, false).focus);
	useEffect(() => {
		if (navigator) return;
		setSavedFocus(readSavedWindow(mainId, false).focus);
		const onStorage = (event: StorageEvent) => {
			if (event.key === savedWindowKey(mainId)) {
				setSavedFocus(readSavedWindow(mainId, false).focus);
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [mainId, navigator]);
	return navigator ? (ownFocus ?? null) : savedFocus;
}

function useViewProps(detached: boolean): WorkSessionsViewProps {
	const kernel = useKernel();
	const windows = useDomainObject(KernelWindows);
	const navigator = useDomainObject(WorkSessionsWindow);
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	const focus = resolveWorkspaceFocus(useMainWindowFocus(), workspaces);
	const renderers = useWorkSessionRenderers();
	const openWorkSession = useCallback(
		(workSessionId: string) => {
			if (!detached && navigator) {
				void navigator.methods.openWorkSession({ workSessionId }).catch(() => undefined);
				return;
			}
			void kernel.commands
				.execute(OPEN_WORK_SESSION_COMMAND, { workSessionId })
				.catch(reportFailure("Could not open the session", "Please try again."));
			void windows?.methods.focusMain(undefined).catch(() => undefined);
		},
		[detached, kernel, navigator, windows],
	);
	return useMemo(
		() => ({ focus, openWorkSession, detached, renderers }),
		[detached, focus, openWorkSession, renderers],
	);
}

const selectComponent = (implementation: WorkSessionsViewImplementation) =>
	implementation.component;
const selectHeaderActions = (implementation: WorkSessionsViewImplementation) =>
	implementation.headerActions;

/** The view in the main area, or a placeholder while it is in its own window. */
export function WorkSessionsViewInPlace({ view }: { readonly view: ViewContribution }) {
	const props = useViewProps(false);
	const detached = useDomainObjectState(WorkSessionsWindow, selectDetached) ?? NO_VIEWS;
	return (
		<div
			data-qa-id="sessions-view"
			data-view={view.key}
			className="flex min-h-0 min-w-0 flex-1 flex-col"
		>
			{detached.includes(view.key) ? (
				<DetachedPlaceholder view={view} />
			) : (
				<RenderContribution contribution={view} select={selectComponent} props={props} />
			)}
		</div>
	);
}

function DetachedPlaceholder({ view }: { readonly view: ViewContribution }) {
	const windows = useDomainObject(KernelWindows);
	const windowId = useDomainObjectState(
		KernelWindows,
		(state) =>
			Object.entries(state.windows).find(
				([, window]) => window.params.view === view.key && window.role === "secondary",
			)?.[0],
	);
	const act = (action: "focus" | "close") => {
		if (windowId) void windows?.methods[action]({ windowId }).catch(() => undefined);
	};
	return (
		<Empty data-qa-id="sessions-view-popped-out" className="h-full">
			<EmptyHeader>
				<EmptyTitle>{view.metadata.title}</EmptyTitle>
				<EmptyDescription>This view is open in a separate window.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row flex-wrap justify-center">
				<Button type="button" variant="outline" size="sm" onClick={() => act("focus")}>
					<ExternalLinkIcon />
					Bring to front
				</Button>
				<Button type="button" variant="outline" size="sm" onClick={() => act("close")}>
					<Minimize2Icon />
					Dock
				</Button>
			</EmptyContent>
		</Empty>
	);
}

/**
 * The window header's title while a view shows: the focused workspace › the
 * view, or the view alone when it covers every workspace.
 */
export function WorkSessionsViewHeaderLeading({ view }: { readonly view: ViewContribution }) {
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	return <ViewTitle view={view} workspaces={workspaces} focus={useMainWindowFocus()} />;
}

const ViewTitle: FC<{
	view: ViewContribution;
	workspaces: readonly Workspace[];
	focus: string | null;
}> = ({ view, workspaces, focus }) => {
	const resolved = resolveWorkspaceFocus(focus, workspaces);
	const allWorkspaces = view.metadata.scope === "all-workspaces";
	const workspace = allWorkspaces
		? undefined
		: workspaces.find((candidate) => candidate.id === resolved);
	const locationLabel = allWorkspaces
		? null
		: resolved === UNSCOPED_WORKSPACE_FOCUS
			? "No workspace"
			: (workspace?.name ?? null);
	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<SessionLocationBreadcrumb
				locationLabel={locationLabel}
				locationColor={workspace?.color}
				title={view.metadata.title}
				qaId="sessions-view-title"
			/>
		</div>
	);
};

/** The window header's actions while a view shows: the view's own, then pop out. */
export function WorkSessionsViewHeaderActions({ view }: { readonly view: ViewContribution }) {
	const props = useViewProps(false);
	const windows = useDomainObject(KernelWindows);
	const navigator = useDomainObject(WorkSessionsWindow);
	const desktop = useContextKey("kernel/desktop");
	const detached = useDomainObjectState(WorkSessionsWindow, selectDetached) ?? NO_VIEWS;
	if (detached.includes(view.key)) return null;
	const canPopOut = view.metadata.detachable && desktop && windows !== null;
	const popOut = () => {
		if (!windows) return;
		const width = (
			view.implementation as WorkSessionsViewImplementation | undefined
		)?.preferredWidth?.();
		void popOutView(windows, { key: view.key, title: view.metadata.title, width })
			.then(() => navigator?.methods.showView({ view: null }))
			.catch(reportFailure("Could not pop out the view", "Please try again."));
	};
	return (
		<div
			data-qa-id="sessions-view-header-actions"
			className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]"
		>
			<RenderContribution contribution={view} select={selectHeaderActions} props={props} />
			{canPopOut ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Pop out"
								data-qa-id="sessions-view-pop-out"
								onClick={popOut}
							/>
						}
					>
						<ExternalLinkIcon className="size-3.5" aria-hidden />
					</TooltipTrigger>
					<TooltipContent side="bottom">Pop out</TooltipContent>
				</Tooltip>
			) : null}
		</div>
	);
}

/**
 * A popped-out work sessions view's window (kernel/window-view
 * `work-sessions-view`). Docking shows the view in the main window again and
 * closes this one.
 */
export function WorkSessionsViewWindow({ params }: WindowViewProps) {
	const view = useWorkSessionsView(params.view);
	if (!view) return <ViewGone />;
	return <WorkSessionsViewWindowContent view={view} />;
}

function WorkSessionsViewWindowContent({ view }: { readonly view: ViewContribution }) {
	const sdk = useSdk();
	const kernel = useKernel();
	const windows = useDomainObject(KernelWindows);
	const props = useViewProps(true);
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	const dock = () => {
		void kernel.commands
			.execute(SHOW_WORK_SESSIONS_VIEW_COMMAND, { view: view.key })
			.catch(() => undefined)
			.finally(() => {
				void windows?.methods.focusMain(undefined).catch(() => undefined);
				if (sdk.windowId) void windows?.methods.close({ windowId: sdk.windowId });
			});
	};
	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col" data-qa-id="sessions-view-window">
			<header
				data-qa-id="sessions-view-window-header"
				className="drag-region border-border bg-card flex h-12 shrink-0 items-center gap-3 border-b pr-[calc(0.75rem+var(--window-controls-width))] pl-20"
			>
				<ViewTitle view={view} workspaces={workspaces} focus={props.focus} />
				<div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
					<RenderContribution contribution={view} select={selectHeaderActions} props={props} />
					<Button variant="ghost" size="sm" data-qa-id="sessions-view-dock" onClick={dock}>
						<PanelLeftCloseIcon data-icon="inline-start" />
						Dock
					</Button>
				</div>
			</header>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<RenderContribution contribution={view} select={selectComponent} props={props} />
			</main>
		</div>
	);
}

function ViewGone() {
	return (
		<div className="flex h-full items-center justify-center p-6" data-qa-id="sessions-view-gone">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>This view is no longer available</EmptyTitle>
					<EmptyDescription>You can close this window.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
