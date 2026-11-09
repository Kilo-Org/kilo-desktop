import { ExternalLinkIcon, Minimize2Icon, PanelLeftCloseIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";

import { KernelWindows, type Contribution, type WindowViewProps } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomain,
	useDomainState,
	useExtensions,
	useKernel,
	useSdk,
} from "@kilo-desktop/kernel/web";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-workspaces/contracts";
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
	Workbench,
	OPEN_SESSION_COMMAND,
	SessionsView,
	SHOW_SESSIONS_VIEW_COMMAND,
	type WorkbenchState,
	type SessionsViewImplementation,
	type SessionsViewProps,
} from "../../contracts";
import { SessionLocationBreadcrumb } from "../home/SessionLocationBreadcrumb";
import { reportFailure } from "../list/session-row-actions";
import { resolveWorkspaceFocus, UNSCOPED_WORKSPACE_FOCUS } from "../list/session-list-view";
import { SESSION_RENDERERS } from "../list/session-renderers";
import { workbenchStorageKey, readSavedWorkbench } from "../workbench";
import { mainWindowId, popOutView } from "./view-windows";

/*
 * Hosting kilo.workbench/sessions-view: a view shows in the main area in
 * place of the open session, and a detachable one in its own window. The view
 * gets the main window's workspace focus and a way to open sessions there.
 */

type ViewContribution = Contribution<typeof SessionsView>;

const NO_WORKSPACES: readonly Workspace[] = [];
const selectWorkspaces = (state: { workspaces: readonly Workspace[] }) => state.workspaces;
const selectView = (state: WorkbenchState) => state.view;
const selectDetached = (state: WorkbenchState) => state.detachedViews;
const selectFocus = (state: WorkbenchState) => state.focus;

/** The sessions view with this key, while it is contributed. */
export function useSessionsView(key: string | null | undefined): ViewContribution | null {
	const views = useExtensions(SessionsView);
	return key ? (views.find((view) => view.key === key) ?? null) : null;
}

/** The sessions view this window shows in place of the open session, if any. */
export function useShownSessionsView(): ViewContribution | null {
	return useSessionsView(useDomainState(Workbench, selectView));
}

/**
 * The main window's focus. A pop-out has no navigator of its own, so it
 * follows the main window's saved one.
 */
function useMainWindowFocus(): string | null {
	const navigator = useDomain(Workbench);
	const ownFocus = useDomainState(Workbench, selectFocus);
	const mainId = useDomainState(KernelWindows, (state) => mainWindowId(state)) ?? "main";
	const [savedFocus, setSavedFocus] = useState(() => readSavedWorkbench(mainId, false).focus);
	useEffect(() => {
		if (navigator) return;
		setSavedFocus(readSavedWorkbench(mainId, false).focus);
		const onStorage = (event: StorageEvent) => {
			if (event.key === workbenchStorageKey(mainId)) {
				setSavedFocus(readSavedWorkbench(mainId, false).focus);
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [mainId, navigator]);
	return navigator ? (ownFocus ?? null) : savedFocus;
}

function useViewProps(detached: boolean): SessionsViewProps {
	const kernel = useKernel();
	const windows = useDomain(KernelWindows);
	const navigator = useDomain(Workbench);
	const workspaces = useDomainState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	const focus = resolveWorkspaceFocus(useMainWindowFocus(), workspaces);
	const openSession = useCallback(
		(sessionId: string) => {
			if (!detached && navigator) {
				void navigator.methods.openSession({ sessionId }).catch(() => undefined);
				return;
			}
			void kernel.commands
				.execute(OPEN_SESSION_COMMAND, { sessionId })
				.catch(reportFailure("Could not open the session", "Please try again."));
			void windows?.methods.focusMain(undefined).catch(() => undefined);
		},
		[detached, kernel, navigator, windows],
	);
	return useMemo(
		() => ({ focus, openSession, detached, renderers: SESSION_RENDERERS }),
		[detached, focus, openSession],
	);
}

const selectComponent = (implementation: SessionsViewImplementation) => implementation.component;
const selectHeaderActions = (implementation: SessionsViewImplementation) =>
	implementation.headerActions;

/** The view in the main area, or a placeholder while it is in its own window. */
export function SessionsViewInPlace({ view }: { readonly view: ViewContribution }) {
	const props = useViewProps(false);
	const detached = useDomainState(Workbench, selectDetached) ?? [];
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
	const windows = useDomain(KernelWindows);
	const windowId = useDomainState(
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

/** The window header's title while a view shows: the focused workspace › the view. */
export function SessionsViewHeaderLeading({ view }: { readonly view: ViewContribution }) {
	const workspaces = useDomainState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	return <ViewTitle view={view} workspaces={workspaces} focus={useMainWindowFocus()} />;
}

const ViewTitle: FC<{
	view: ViewContribution;
	workspaces: readonly Workspace[];
	focus: string | null;
}> = ({ view, workspaces, focus }) => {
	const resolved = resolveWorkspaceFocus(focus, workspaces);
	const workspace = workspaces.find((candidate) => candidate.id === resolved);
	const locationLabel =
		resolved === UNSCOPED_WORKSPACE_FOCUS ? "No workspace" : (workspace?.name ?? null);
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
export function SessionsViewHeaderActions({ view }: { readonly view: ViewContribution }) {
	const props = useViewProps(false);
	const windows = useDomain(KernelWindows);
	const navigator = useDomain(Workbench);
	const desktop = useContextKey("kernel/desktop");
	const detached = useDomainState(Workbench, selectDetached) ?? [];
	if (detached.includes(view.key)) return null;
	const canPopOut = view.metadata.detachable && desktop && windows !== null;
	const popOut = () => {
		if (!windows) return;
		const width = (
			view.implementation as SessionsViewImplementation | undefined
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
 * A popped-out sessions view's window (kernel/window-view). Docking shows the
 * view in the main window again and closes this one.
 */
export function SessionsViewWindow({ params }: WindowViewProps) {
	const view = useSessionsView(params.view);
	if (!view) return <ViewGone />;
	return <SessionsViewWindowContent view={view} />;
}

function SessionsViewWindowContent({ view }: { readonly view: ViewContribution }) {
	const sdk = useSdk();
	const kernel = useKernel();
	const windows = useDomain(KernelWindows);
	const props = useViewProps(true);
	const workspaces = useDomainState(Workspaces, selectWorkspaces) ?? NO_WORKSPACES;
	const dock = () => {
		void kernel.commands
			.execute(SHOW_SESSIONS_VIEW_COMMAND, { view: view.key })
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
