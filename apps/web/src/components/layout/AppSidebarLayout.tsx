import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BellIcon, LogOutIcon, UserIcon } from "lucide-react";

import { ZoneOutlet } from "@/components/zones/ZoneOutlet";
import { getUserInitials } from "@/features/auth/getUserInitials";
import { useAuthSession } from "@/features/auth/useAuthSession";
import { resolvePluginNavIcon } from "@/features/plugin-icons";
import { PLUGIN_NAV, type PluginNavEntry } from "@/features/plugin-nav";
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
} from "@anaconda-agentic-desktop/ui/components/sidebar";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import { TooltipProvider } from "@anaconda-agentic-desktop/ui/components/tooltip";

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

export function AppSidebarLayout({ children, navEntries = PLUGIN_NAV }: AppSidebarLayoutProps) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const session = useAuthSession();
	const sdk = useSdk("auth");
	const initials = session.status === "authenticated" ? getUserInitials(session.user) : "";
	const accountName =
		session.status === "authenticated"
			? [session.user.firstName?.trim(), session.user.lastName?.trim()].filter(Boolean).join(" ") ||
				session.user.username?.trim() ||
				"Anaconda user"
			: "";
	const accountEmail = session.status === "authenticated" ? session.user.email?.trim() : undefined;

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
			<SidebarProvider className="app-shell-glass h-svh min-h-0 overflow-hidden">
				<Sidebar
					collapsible="none"
					className="h-svh border-none bg-transparent!"
					data-qa-id="app-sidebar"
				>
					<SidebarHeader className="h-14 shrink-0 p-0 [-webkit-app-region:drag]" />
					<SidebarContent>
						<SidebarGroup className="pt-0">
							<SidebarMenu>
								{navEntries.map((entry) => (
									<PluginNavItem key={entry.to} entry={entry} pathname={pathname} />
								))}
							</SidebarMenu>
						</SidebarGroup>
						{/* Free-form sidebar contributions registered via sdk.contribute("sidebar", ...) */}
						<ZoneOutlet zone="sidebar" className="flex flex-col gap-2 px-2" />
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

				<SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent pr-3 pb-3">
					<header className="flex h-14 items-center justify-end gap-2 pr-[env(titlebar-area-width,0px)] [-webkit-app-region:drag]">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Notifications"
							className="[-webkit-app-region:no-drag]"
						>
							<BellIcon />
						</Button>
						{session.status !== "authenticated" && (
							<Button
								onClick={() => {
									void handleLogin();
								}}
								aria-label="Log in"
								className="[-webkit-app-region:no-drag]"
							>
								Log in
							</Button>
						)}
					</header>
					<div className="bg-muted border-border flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-md border">
						{children}
					</div>
					{/* Status-bar contributions registered via sdk.contribute("status-bar", ...) */}
					<ZoneOutlet
						zone="status-bar"
						className="text-muted-foreground flex h-6 shrink-0 items-center justify-end gap-3 px-2 pt-1 text-xs"
					/>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
