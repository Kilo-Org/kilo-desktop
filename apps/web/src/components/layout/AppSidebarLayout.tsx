import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";

import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ShellPageHeader } from "@/components/layout/ShellPageHeader";
import { SidebarUpdatePill } from "@/components/updates/SidebarUpdatePill";
import { ZoneOutlet } from "@/components/zones/ZoneOutlet";
import { HOME_PLUGIN_SPLAT } from "@/features/home-route";
import { resolvePluginNavIcon } from "@/features/plugin-icons";
import { useVisiblePluginNav, type PluginNavEntry } from "@/features/plugin-nav";
import { findPluginPage, type PluginPage } from "@/features/plugin-pages";
import { isSettingsPath, type PluginSettingsSection } from "@/features/plugin-settings";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";
import { SIDEBAR_ACCOUNT_ZONE, SIDEBAR_HEADER_ACTIONS_ZONE } from "@kilo-desktop/feature-sdk";
import { useTelemetry } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@kilo-desktop/ui/components/sidebar";

/** Clears macOS traffic lights (x:16, 14px lights, 8px gaps = 74px) plus a 10px gap. */
const MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT = "84px";
const DEFAULT_SIDEBAR_TOGGLE_LEFT = "0.75rem";

function resolveSidebarToggleLeft(): string {
	if (!isDesktopBridgeAvailable()) return DEFAULT_SIDEBAR_TOGGLE_LEFT;
	const platform = navigator.platform ?? "";
	if (/Mac|iPhone|iPad/i.test(platform)) return MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT;
	return DEFAULT_SIDEBAR_TOGGLE_LEFT;
}

const EMPTY_NAV: readonly PluginNavEntry[] = [];
const EMPTY_PAGES: readonly PluginPage[] = [];
const EMPTY_SETTINGS: readonly PluginSettingsSection[] = [];

type AppSidebarLayoutProps = {
	children: ReactNode;
	/** Injectable for tests; the app shell passes bundled plugin nav entries. */
	navEntries?: readonly PluginNavEntry[];
	/** Injectable for tests; the app shell passes bundled settings sections. */
	settingsSections?: readonly PluginSettingsSection[];
	/** Injectable for tests; the shell passes the discovered plugin routes. */
	pages?: readonly PluginPage[];
};

/**
 * Sidebar nav entry declared by a plugin (`contributes.nav`) — plugins add nav
 * entries by declaring them in the manifest, never by editing this layout.
 * Icons resolve through the plugin's exported component first, then the static
 * bundled-plugin icon map (plugin-icons.ts), then the PuzzleIcon fallback.
 * The link goes through the plugin catch-all route (`/plugins/$`) so plugin
 * paths cannot collide with shell paths by construction.
 */
function PluginNavItem({ entry, pathname }: { entry: PluginNavEntry; pathname: string }) {
	const Icon = resolvePluginNavIcon(entry.icon, entry.iconComponent);
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				isActive={pathname === entry.to}
				tooltip={entry.label}
				render={<Link to="/plugins/$" params={{ _splat: entry.splat }} />}
				data-qa-id={entry.navQaId}
			>
				<Icon />
				<span>{entry.label}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

function SidebarSettingsAction({ settings }: { settings: boolean }) {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={settings ? "Close settings" : "Settings"}
			className="text-muted-foreground shrink-0"
			nativeButton={false}
			render={
				settings ? (
					<Link to="/plugins/$" params={{ _splat: HOME_PLUGIN_SPLAT }} />
				) : (
					<Link to="/settings" />
				)
			}
			data-qa-id="nav-settings"
		>
			<SettingsIcon />
		</Button>
	);
}

function SidebarAccountDock({ settings }: { settings: boolean }) {
	return (
		<div className="flex min-w-0 items-center">
			<ZoneOutlet zone={SIDEBAR_ACCOUNT_ZONE} className="flex min-w-0 flex-1 items-center" />
			<SidebarSettingsAction settings={settings} />
		</div>
	);
}

function ShellInset({ children }: { children: ReactNode }) {
	return (
		// Keep overflow off SidebarInset — Electron ignores drag regions inside
		// overflow:hidden ancestors, which would break titlebar dragging.
		<SidebarInset className="bg-background h-svh min-h-0 min-w-0">{children}</SidebarInset>
	);
}

export function AppSidebarLayout({
	children,
	navEntries = EMPTY_NAV,
	settingsSections = EMPTY_SETTINGS,
	pages = EMPTY_PAGES,
}: AppSidebarLayoutProps) {
	const navigate = useNavigate();
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key === "," &&
				event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				void navigate({ to: "/settings" });
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [navigate]);

	const location = useRouterState({ select: (state) => state.location });
	const pathname = location.pathname;
	// Page Visit is a shell-level, cross-feature concern, so it uses the
	// untagged useTelemetry() hook rather than a feature-scoped sdk instance.
	const { track } = useTelemetry();
	useEffect(() => {
		void track({ event: "Page Visit", data: { path: pathname } });
	}, [pathname, track]);

	// Filter nav entries against the current feature-flag map so a plugin
	// that declares `contributes.nav[].featureFlag` disappears from the
	// sidebar the instant its flag flips off — without unregistering the
	// underlying route.
	const visibleNav = useVisiblePluginNav(navEntries);
	const settings = isSettingsPath(pathname);
	const pluginPage = findPluginPage(pages, pathname);
	const pageTitle = settings
		? "Settings"
		: (pluginPage?.title ?? (pathname.startsWith("/plugins/") ? "Page not found" : undefined));
	const pageProps = {
		path: pathname,
		search: location.search as Record<string, unknown>,
	};
	const sidebarProviderStyle = {
		"--shell-sidebar-toggle-left": resolveSidebarToggleLeft(),
	} as CSSProperties;

	return (
		<SidebarProvider
			hoverReveal
			className="app-shell-glass h-svh min-h-0"
			style={sidebarProviderStyle}
		>
			<Sidebar
				collapsible="offcanvas"
				className="border-border group-data-[transient=true]:bg-sidebar! h-svh border-r bg-transparent! [&_[data-sidebar=sidebar]]:bg-transparent"
				data-qa-id="app-sidebar"
			>
				<SidebarHeader className="relative h-12 shrink-0 p-0" data-qa-id="sidebar-titlebar">
					{/* Keep the drag surface clear of the fixed navigation toggle. Electron
						    otherwise treats the overlapping button pixels as window chrome. */}
					<div
						className="drag-region absolute inset-y-0 right-0 flex items-center justify-end pr-2"
						style={{ left: "calc(var(--shell-sidebar-toggle-left) + 2rem)" }}
					>
						{settings ? null : (
							<ZoneOutlet
								zone={SIDEBAR_HEADER_ACTIONS_ZONE}
								className="flex items-center [-webkit-app-region:no-drag]"
							/>
						)}
					</div>
				</SidebarHeader>
				<SidebarContent>
					{settings ? <SettingsSidebar sections={settingsSections} /> : null}
					<div
						style={{ display: settings ? "none" : "contents" }}
						aria-hidden={settings}
						inert={settings}
						data-qa-id="app-sidebar-primary"
					>
						{visibleNav.length > 0 ? (
							<SidebarGroup className="pt-0">
								<SidebarMenu>
									{visibleNav.map((entry) => (
										<PluginNavItem key={entry.to} entry={entry} pathname={pathname} />
									))}
								</SidebarMenu>
							</SidebarGroup>
						) : null}
						{/* Free-form sidebar contributions registered via sdk.contribute("sidebar", ...) */}
						{settings ? null : (
							<ZoneOutlet zone="sidebar" className="flex min-h-0 flex-1 flex-col gap-2 px-2" />
						)}
					</div>
				</SidebarContent>
				<SidebarFooter
					role="group"
					aria-label="Account and settings"
					className="gap-2 px-2 pt-[7px] pb-2"
				>
					<section aria-label="User controls" className="flex flex-col gap-2">
						<SidebarUpdatePill />
						<SidebarAccountDock settings={settings} />
					</section>
				</SidebarFooter>
			</Sidebar>
			{/* Keep overflow off SidebarInset — Electron ignores drag regions inside
				    overflow:hidden ancestors, which would break titlebar dragging. */}
			<ShellInset>
				<ShellPageHeader
					title={pageTitle}
					leading={pluginPage?.headerLeading}
					actions={pluginPage?.headerActions}
					pageProps={pageProps}
				/>
				<div
					data-qa-id="shell-main"
					className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain"
				>
					{children}
				</div>
				{/* Status-bar contributions registered via sdk.contribute("status-bar", ...) */}
				<ZoneOutlet
					zone="status-bar"
					className="text-muted-foreground flex h-6 shrink-0 items-center justify-end gap-3 px-2 pt-1 text-xs"
				/>
			</ShellInset>
		</SidebarProvider>
	);
}
