import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";

import type { Contribution } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomainObjectState,
	useExclusive,
	useExtensions,
} from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	useSidebar,
} from "@kilo-desktop/ui/components/sidebar";
import { Toaster } from "@kilo-desktop/ui/components/sonner";

import {
	LeftSidebar,
	Main,
	SidebarNotice,
	Theme,
	TopBarAction,
	TopBarTitle,
} from "../../contracts";
// Other areas' UI the frame places: the account entry, onboarding and the settings rail.
import { SidebarAccount } from "../account/SidebarAccount";
import { OnboardingHost } from "../onboarding";
import { SettingsSidebar } from "../settings";
import { CommandPalette } from "./CommandPalette";
import { DialogsHost } from "./DialogsHost";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { NotificationToasts, SidebarNotices } from "./Notifications";
import { RightSidebar, useRightSidebarToggleShown } from "./RightSidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { useShellUi } from "./ui-state";

/** Clears macOS traffic lights (x:16, 14px lights, 8px gaps = 74px) plus a 10px gap. */
const MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT = "84px";
const DEFAULT_SIDEBAR_TOGGLE_LEFT = "0.75rem";
/** Width reserved right of the toggle's left edge for the toggle and its Beta badge. */
const SIDEBAR_TOGGLE_CLEARANCE = "5.25rem";

const selectMode = (state: { mode: "light" | "dark" }) => state.mode;
const NO_ACTIONS: readonly Contribution<typeof TopBarAction>[] = [];

export function isSettingsPath(pathname: string): boolean {
	return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Lets commands (outside React) toggle the sidebar while the frame is mounted. */
function SidebarToggleBridge() {
	const ui = useShellUi();
	const { toggleSidebar } = useSidebar();
	useEffect(() => ui.registerSidebarToggle(toggleSidebar), [ui, toggleSidebar]);
	return null;
}

function SettingsButton({ settings }: { readonly settings: boolean }) {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={settings ? "Close settings" : "Settings"}
			className="text-muted-foreground shrink-0"
			nativeButton={false}
			render={settings ? <Link to="/" /> : <Link to="/settings" />}
			data-qa-id="nav-settings"
		>
			<SettingsIcon />
		</Button>
	);
}

/**
 * The window frame: the left sidebar (navigator or the settings rail, then
 * notices and the account entry), top bar, the main pane, the status bar
 * and the right sidebar, plus the window's dialogs, toasts and onboarding.
 * Everything inside comes from contributions to kilo.shell's points.
 */
export function Frame({ children }: { readonly children: ReactNode }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const settings = isSettingsPath(pathname);
	const navigator = useExclusive(LeftSidebar).winner;
	const notices = useExtensions(SidebarNotice);
	const home = useExclusive(Main).winner;
	const mode = useDomainObjectState(Theme, selectMode) ?? "dark";
	const desktop = useContextKey("kernel/desktop");
	const mac = useContextKey("kernel/mac");
	const desktopMac = desktop && mac;

	const atHome = pathname === "/";
	const title = settings ? "Settings" : atHome ? home?.metadata.title : undefined;
	const titleWinner = useExclusive(TopBarTitle).winner;
	const actionContributions = useExtensions(TopBarAction);
	// The top bar's contributions are about the main area, so they show only at "/".
	const titleContribution = atHome ? titleWinner : undefined;
	const actions = atHome ? actionContributions : NO_ACTIONS;
	const rightSidebarToggle = useRightSidebarToggleShown();
	const topBarEmpty = !titleContribution && !title && actions.length === 0 && !rightSidebarToggle;
	const style = {
		"--shell-sidebar-toggle-left": desktopMac
			? MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT
			: DEFAULT_SIDEBAR_TOGGLE_LEFT,
		"--shell-sidebar-toggle-clearance": SIDEBAR_TOGGLE_CLEARANCE,
	} as CSSProperties;

	return (
		<SidebarProvider
			hoverReveal
			keyboardShortcut={false}
			className="app-shell-glass h-svh min-h-0"
			style={style}
		>
			<SidebarToggleBridge />
			<Sidebar
				collapsible="offcanvas"
				className="group-data-[transient=true]:bg-sidebar! h-svh bg-transparent! group-data-[side=left]:border-r-0 group-data-[transient=true]:shadow-xl [&_[data-sidebar=sidebar]]:bg-transparent"
				data-qa-id="app-sidebar"
			>
				{/* Titlebar plus the pane gutter, so sidebar content starts level with the main pane. */}
				<SidebarHeader
					className="relative h-[calc(var(--shell-titlebar-height)+0.5rem)] shrink-0 p-0"
					data-qa-id="sidebar-titlebar"
				>
					{/* Keep the drag surface clear of the fixed navigation toggle. */}
					<div
						className="drag-region titlebar-row absolute top-0 right-0"
						style={{
							left: "calc(var(--shell-sidebar-toggle-left) + var(--shell-sidebar-toggle-clearance))",
						}}
					/>
				</SidebarHeader>
				<SidebarContent>
					{settings ? <SettingsSidebar /> : null}
					<div
						style={{ display: settings ? "none" : "contents" }}
						aria-hidden={settings}
						inert={settings}
						data-qa-id="app-sidebar-primary"
					>
						{navigator ? (
							<div className="flex min-h-0 flex-1 flex-col gap-2 px-2">
								<RenderContribution contribution={navigator} />
							</div>
						) : null}
					</div>
				</SidebarContent>
				<SidebarFooter
					role="group"
					aria-label="Account and settings"
					className="gap-2 px-2 pt-[7px] pb-2"
				>
					<section aria-label="User controls" className="flex flex-col gap-2">
						<SidebarNotices />
						{notices.map((notice) => (
							<RenderContribution key={notice.key} contribution={notice} />
						))}
						<div className="flex min-w-0 items-center">
							<div className="flex min-w-0 flex-1 items-center">
								<SidebarAccount />
							</div>
							<SettingsButton settings={settings} />
						</div>
					</section>
				</SidebarFooter>
			</Sidebar>
			{/* Keep overflow off the inset: Electron ignores drag regions inside overflow:hidden ancestors. */}
			<SidebarInset className="h-svh min-h-0 min-w-0 bg-transparent">
				<TopBar
					title={title}
					titleContribution={titleContribution}
					actions={actions}
					rightSidebarToggle={rightSidebarToggle}
					empty={topBarEmpty}
				/>
				{/* has-[[data-shell-canvas]] is SHELL_CANVAS_ATTRIBUTE, spelled out for Tailwind. */}
				<div
					data-qa-id="shell-main"
					className="bg-card pane-edge mx-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-lg [--pane-surface:var(--color-card)] has-[[data-shell-canvas]]:m-0 has-[[data-shell-canvas]]:overflow-visible has-[[data-shell-canvas]]:rounded-none has-[[data-shell-canvas]]:bg-transparent has-[[data-shell-canvas]]:ring-0"
				>
					{children}
				</div>
				<StatusBar />
			</SidebarInset>
			<RightSidebar topBarEmpty={topBarEmpty} />
			<CommandPalette />
			<KeyboardShortcutsDialog />
			<Toaster theme={mode} position="bottom-right" offset={{ bottom: 88 }} closeButton />
			<NotificationToasts />
			<DialogsHost />
			<OnboardingHost />
		</SidebarProvider>
	);
}
