import type { CSSProperties, ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	BellIcon,
	HomeIcon,
	ListTodoIcon,
	LogOutIcon,
	PackageIcon,
	PlugIcon,
	SplitIcon,
	UserIcon,
} from "lucide-react";

import { getUserInitials } from "@/features/auth/getUserInitials";
import { useAuthSession } from "@/features/auth/useAuthSession";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

type AppSidebarLayoutProps = {
	children: ReactNode;
};

export function AppSidebarLayout({ children }: AppSidebarLayoutProps) {
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
	const handleLogin = (): void => {
		void sdk.auth.login();
	};

	const handleLogout = (): void => {
		void sdk.auth.logout();
	};

	return (
		<TooltipProvider>
			<SidebarProvider
				defaultOpen={false}
				className="bg-sidebar h-svh min-h-0 overflow-hidden"
				style={{ "--sidebar-width": "3rem" } as CSSProperties}
			>
				<Sidebar collapsible="none" className="h-svh border-none" data-qa-id="app-sidebar">
					<SidebarHeader className="h-14 shrink-0 p-0 [-webkit-app-region:drag]" />
					<SidebarContent>
						<SidebarGroup className="pt-0">
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/"}
										tooltip="Home"
										render={<Link to="/" />}
										className="size-8!"
										data-qa-id="nav-home"
									>
										<HomeIcon />
										<span>Home</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/todos"}
										tooltip="Todo List"
										render={<Link to="/todos" />}
										className="size-8!"
										data-qa-id="nav-todos"
									>
										<ListTodoIcon />
										<span>Todo List</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/sdk-producer"}
										tooltip="SDK Producer"
										render={<Link to="/sdk-producer" />}
										className="size-8!"
										data-qa-id="nav-sdk-producer"
									>
										<PackageIcon />
										<span>SDK Producer</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/sdk-consumer"}
										tooltip="SDK Consumer"
										render={<Link to="/sdk-consumer" />}
										className="size-8!"
										data-qa-id="nav-sdk-consumer"
									>
										<PlugIcon />
										<span>SDK Consumer</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/split"}
										tooltip="Split"
										render={<Link to="/split" />}
										className="size-8!"
										data-qa-id="nav-split"
									>
										<SplitIcon />
										<span>Split</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroup>
					</SidebarContent>
					{session.status === "authenticated" && (
						<SidebarFooter className="px-2 pb-4">
							<SidebarMenu>
								<SidebarMenuItem>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<SidebarMenuButton
													aria-label={`Account menu for ${accountName}`}
													className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground size-8! p-0!"
												/>
											}
										>
											<Avatar className="size-8">
												<AvatarFallback>{initials || <UserIcon />}</AvatarFallback>
											</Avatar>
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
												<DropdownMenuItem onClick={handleLogout}>
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
								onClick={handleLogin}
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
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
