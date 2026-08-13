import { motion, useTransform } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";

import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ZoneOutlet } from "@/components/zones/ZoneOutlet";
import { getUserInitials } from "@/features/auth/getUserInitials";
import { useAuthSession } from "@/features/auth/useAuthSession";
import { resolvePluginNavIcon } from "@/features/plugin-icons";
import { PLUGIN_NAV, useVisiblePluginNav, type PluginNavEntry } from "@/features/plugin-nav";
import { isSettingsPath } from "@/features/plugin-settings";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
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
	SidebarTrigger,
	useSidebar,
} from "@anaconda-agentic-desktop/ui/components/sidebar";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

/** Clears macOS traffic lights (x:16 + three lights) so the toggle sits just to their right. */
const MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT = "90px";
const DEFAULT_SIDEBAR_TOGGLE_LEFT = "0.75rem";

function resolveSidebarToggleLeft(): string {
	if (!isDesktopBridgeAvailable()) return DEFAULT_SIDEBAR_TOGGLE_LEFT;
	const platform = navigator.platform ?? "";
	if (/Mac|iPhone|iPad/i.test(platform)) return MAC_DESKTOP_SIDEBAR_TOGGLE_LEFT;
	return DEFAULT_SIDEBAR_TOGGLE_LEFT;
}

type AppSidebarLayoutProps = {
	children: ReactNode;
	/** Injectable for tests; defaults to the bundled plugin nav entries. */
	navEntries?: readonly PluginNavEntry[];
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

/**
 * Fixed shell titlebar. The nav toggle is absolutely pinned after the traffic
 * lights so it never moves when the sidebar opens/closes. Header contributions
 * shift to track the inset; the toggle does not. Must be a `.drag-region` so
 * Electron `no-drag` on the toggle punches a clickable hole.
 */
function ShellTitlebar({
	session,
	onLogin,
}: {
	session: ReturnType<typeof useAuthSession>;
	onLogin: () => void;
}) {
	const { open, progress } = useSidebar();
	const label = open ? "Hide navigation" : "Show navigation";
	const paddingLeft = useTransform(
		progress,
		(value) =>
			`calc((var(--shell-sidebar-toggle-left) + 2.5rem) * ${1 - value} + var(--sidebar-width) * ${value})`,
	);

	return (
		<header className="drag-region fixed inset-x-0 top-0 z-50 flex h-12 items-center pr-[calc(0.75rem+env(titlebar-area-width,0px))]">
			<div
				className="absolute top-0 flex h-12 items-center"
				style={{ left: "var(--shell-sidebar-toggle-left)" }}
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<SidebarTrigger
								aria-label="Toggle navigation"
								aria-pressed={open}
								data-qa-id="sidebar-nav-toggle"
								className="[-webkit-app-region:no-drag]"
							/>
						}
					/>
					<TooltipContent side="bottom">{label}</TooltipContent>
				</Tooltip>
			</div>

			<motion.div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft }}>
				{/* Persistent flex-1 so empty ZoneOutlet (null) cannot collapse this slot. */}
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<ZoneOutlet zone="header-leading" className="flex min-w-0 items-center gap-1" />
				</div>
				<div className="ml-auto flex shrink-0 items-center justify-end gap-2">
					{/* Trailing header contributions (e.g. chat right-panel toggle) */}
					<ZoneOutlet zone="header-trailing" className="flex items-center gap-1" />
					{session.status !== "authenticated" && (
						<>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Settings"
								className="[-webkit-app-region:no-drag]"
								nativeButton={false}
								render={<Link to="/settings" />}
								data-qa-id="nav-settings"
							>
								<SettingsIcon />
							</Button>
							<Button
								onClick={onLogin}
								aria-label="Sign In"
								className="[-webkit-app-region:no-drag]"
							>
								Sign In
							</Button>
						</>
					)}
				</div>
			</motion.div>
		</header>
	);
}

function ShellInset({ children }: { children: ReactNode }) {
	return (
		// Keep overflow off SidebarInset — Electron ignores drag regions inside
		// overflow:hidden ancestors, which would break titlebar dragging.
		<SidebarInset className="min-h-0 min-w-0 bg-transparent pr-3 pb-3">{children}</SidebarInset>
	);
}

export function AppSidebarLayout({ children, navEntries = PLUGIN_NAV }: AppSidebarLayoutProps) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const navigate = useNavigate();
	const session = useAuthSession();
	const sdk = useSdk("auth");
	// Filter nav entries against the current feature-flag map so a plugin
	// that declares `contributes.nav[].featureFlag` disappears from the
	// sidebar the instant its flag flips off — without unregistering the
	// underlying route.
	const visibleNav = useVisiblePluginNav(navEntries);
	const settings = isSettingsPath(pathname);
	const initials = session.status === "authenticated" ? getUserInitials(session.user) : "";
	const accountName =
		session.status === "authenticated"
			? [session.user.firstName?.trim(), session.user.lastName?.trim()].filter(Boolean).join(" ") ||
				session.user.username?.trim() ||
				"Anaconda user"
			: "";
	const accountEmail = session.status === "authenticated" ? session.user.email?.trim() : undefined;
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
		}
	};

	const handleLogout = async (): Promise<void> => {
		const next = await sdk.auth.logout();
		if (next.status === "error") {
			toast.error("Sign-out failed", { description: next.reason });
		}
	};

	return (
		<TooltipProvider>
			<SidebarProvider className="app-shell-glass h-svh min-h-0" style={sidebarProviderStyle}>
				<Sidebar
					collapsible="offcanvas"
					className="h-svh border-none bg-transparent! group-data-[side=left]:border-none [&_[data-sidebar=sidebar]]:bg-transparent"
					data-qa-id="app-sidebar"
				>
					{/* Flow spacer under the fixed ShellTitlebar. No drag/hit target — a
					    drag region here intercepts app-bar clicks on Windows Electron. */}
					<SidebarHeader className="pointer-events-none h-12 shrink-0 p-0" />
					<SidebarContent>
						{settings ? (
							<SettingsSidebar />
						) : (
							<>
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
								<ZoneOutlet zone="sidebar" className="flex flex-col gap-2 px-2" />
							</>
						)}
					</SidebarContent>
					{session.status === "authenticated" && (
						<SidebarFooter className="px-2 pb-3">
							<SidebarMenu>
								<SidebarMenuItem>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<SidebarMenuButton
													aria-label={`Account menu for ${accountName}`}
													size="lg"
													className="data-open:bg-foreground/5 data-open:text-sidebar-accent-foreground"
												/>
											}
										>
											<Avatar className="size-8">
												<AvatarFallback>{initials || <UserIcon />}</AvatarFallback>
											</Avatar>
											<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
												<span className="truncate font-medium">{accountName}</span>
												{accountEmail && (
													<span className="text-muted-foreground truncate text-xs">
														{accountEmail}
													</span>
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
																<span className="text-muted-foreground truncate text-xs">
																	{accountEmail}
																</span>
															)}
														</div>
													</div>
												</DropdownMenuLabel>
											</DropdownMenuGroup>
											<DropdownMenuSeparator />
											<DropdownMenuGroup>
												<DropdownMenuItem
													data-qa-id="nav-settings"
													onClick={() => {
														void navigate({ to: "/settings" });
													}}
												>
													<SettingsIcon />
													Settings
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => {
														void handleLogout();
													}}
												>
													<LogOutIcon />
													Log out
												</DropdownMenuItem>
											</DropdownMenuGroup>
										</DropdownMenuContent>
									</DropdownMenu>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarFooter>
					)}
				</Sidebar>

				<ShellTitlebar
					session={session}
					onLogin={() => {
						void handleLogin();
					}}
				/>

				{/* Keep overflow off SidebarInset — Electron ignores drag regions inside
				    overflow:hidden ancestors, which would break titlebar dragging. */}
				<ShellInset>
					{/* Flow spacer under the fixed ShellTitlebar */}
					<div className="h-12 shrink-0" aria-hidden />
					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-transparent">
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
