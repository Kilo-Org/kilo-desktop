import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";

import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ShellPageHeader } from "@/components/layout/ShellPageHeader";
import { SidebarUpdatePill } from "@/components/updates/SidebarUpdatePill";
import { ZoneOutlet } from "@/components/zones/ZoneOutlet";
import { getUserInitials } from "@/features/auth/getUserInitials";
import { useAuthSession } from "@/features/auth/useAuthSession";
import { resolvePluginNavIcon } from "@/features/plugin-icons";
import { useVisiblePluginNav, type PluginNavEntry } from "@/features/plugin-nav";
import { findPluginPage, type PluginPage } from "@/features/plugin-pages";
import { isSettingsPath, type PluginSettingsSection } from "@/features/plugin-settings";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";
import { SIDEBAR_HEADER_ACTIONS_ZONE } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdk, useTelemetry } from "@anaconda-agentic-desktop/sdk-react";
import { Avatar, AvatarFallback } from "@anaconda-agentic-desktop/ui/components/avatar";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
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
} from "@anaconda-agentic-desktop/ui/components/sidebar";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import { TooltipProvider } from "@anaconda-agentic-desktop/ui/components/tooltip";

/** Clears macOS traffic lights (x:16 + three lights) so the toggle sits just to their right. */
const MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT = "90px";
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

function SidebarSettingsAction({ inline = false }: { inline?: boolean }) {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label="Settings"
			className={
				inline
					? "text-muted-foreground shrink-0 active:not-aria-[haspopup]:translate-y-0"
					: "text-muted-foreground absolute top-1/2 right-1 z-10 -translate-y-1/2 active:not-aria-[haspopup]:-translate-y-1/2"
			}
			nativeButton={false}
			render={<Link to="/settings" />}
			data-qa-id="nav-settings"
		>
			<SettingsIcon />
		</Button>
	);
}

function SidebarAccountDock({
	session,
	onLogin,
	onLogout,
}: {
	session: ReturnType<typeof useAuthSession>;
	onLogin: () => void;
	onLogout: () => void;
}) {
	if (session.status !== "authenticated") {
		return (
			<div className="flex items-center gap-1" data-qa-id="anonymous-account-dock">
				<Button
					type="button"
					aria-label="Sign In"
					className="min-w-0 flex-1"
					onClick={onLogin}
					data-qa-id="account-login"
				>
					<LogInIcon data-icon="inline-start" />
					Sign In
				</Button>
				<SidebarSettingsAction inline />
			</div>
		);
	}

	const initials = getUserInitials(session.user);
	const accountName =
		[session.user.firstName?.trim(), session.user.lastName?.trim()].filter(Boolean).join(" ") ||
		session.user.username?.trim() ||
		"Anaconda user";
	const accountEmail = session.user.email?.trim();

	return (
		<SidebarMenu>
			<SidebarMenuItem className="has-data-open:bg-foreground/5 hover:bg-foreground/5 rounded-md transition-colors">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								aria-label={`Account menu for ${accountName}`}
								size="lg"
								className="data-open:text-sidebar-accent-foreground w-full min-w-0 pr-12 hover:bg-transparent data-open:bg-transparent data-open:hover:bg-transparent"
								data-qa-id="account-menu"
							/>
						}
					>
						<Avatar className="size-8">
							<AvatarFallback>{initials || <UserIcon />}</AvatarFallback>
						</Avatar>
						<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium">{accountName}</span>
							{accountEmail && (
								<span className="text-muted-foreground truncate text-xs">{accountEmail}</span>
							)}
						</div>
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-64" side="right" align="end" sideOffset={4}>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<Avatar>
										<AvatarFallback>{initials || <UserIcon />}</AvatarFallback>
									</Avatar>
									<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{accountName}</span>
										{accountEmail && (
											<span className="text-muted-foreground truncate text-xs">{accountEmail}</span>
										)}
									</div>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem onClick={onLogout}>
								<LogOutIcon />
								Log out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<SidebarSettingsAction />
			</SidebarMenuItem>
		</SidebarMenu>
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
	// PAGE_VISIT is a shell-level, cross-feature concern, so it uses the
	// untagged useTelemetry() hook rather than the "auth" sdk instance below.
	const { track } = useTelemetry();
	useEffect(() => {
		void track({ event: "PAGE_VISIT", data: { path: pathname } });
	}, [pathname, track]);

	const session = useAuthSession();
	const sdk = useSdk("auth");
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

	// The OAuth flow leaves the app (system browser), so there is no useful
	// in-app pending state to show; the button simply unmounts once the session
	// becomes authenticated (and stays put on failure so the user can retry).
	const handleLogin = async (): Promise<void> => {
		const next = await sdk.auth.login();
		if (next.status === "error") {
			toast.error("Sign-in failed", { description: next.reason });
			return;
		}
		void sdk.telemetry.track({ event: "LOGGED_IN" });
	};

	const handleLogout = async (): Promise<void> => {
		const next = await sdk.auth.logout();
		if (next.status === "error") {
			toast.error("Sign-out failed", { description: next.reason });
			return;
		}
		void sdk.telemetry.track({ event: "LOGGED_OUT" });
	};

	return (
		<TooltipProvider>
			<SidebarProvider
				hoverReveal
				className="app-shell-glass h-svh min-h-0"
				style={sidebarProviderStyle}
			>
				<Sidebar
					collapsible="offcanvas"
					className="border-border dark:border-muted-foreground/15 group-data-[transient=true]:bg-sidebar! h-svh border-r bg-transparent! [&_[data-sidebar=sidebar]]:bg-transparent"
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
					<SidebarFooter className="gap-2 px-2 pb-3">
						<SidebarUpdatePill />
						<SidebarAccountDock
							session={session}
							onLogin={() => {
								void handleLogin();
							}}
							onLogout={() => {
								void handleLogout();
							}}
						/>
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
		</TooltipProvider>
	);
}
