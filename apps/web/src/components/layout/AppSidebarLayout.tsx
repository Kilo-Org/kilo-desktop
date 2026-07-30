import type { CSSProperties, ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BellIcon, HomeIcon, LibraryBigIcon, PackageIcon, PlugIcon, SplitIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

	return (
		<TooltipProvider>
			<SidebarProvider
				defaultOpen={false}
				className="bg-sidebar h-svh min-h-0 overflow-hidden"
				style={{ "--sidebar-width": "3rem" } as CSSProperties}
			>
				<Sidebar collapsible="none" className="h-svh border-none">
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
									>
										<HomeIcon />
										<span>Home</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton tooltip="Library" className="size-8!">
										<LibraryBigIcon />
										<span>Library</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton
										isActive={pathname === "/sdk-producer"}
										tooltip="SDK Producer"
										render={<Link to="/sdk-producer" />}
										className="size-8!"
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
									>
										<SplitIcon />
										<span>Split</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroup>
					</SidebarContent>
					<SidebarFooter className="px-2 pb-4">
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton tooltip="Account" className="size-8! p-0!">
									<Avatar className="size-8">
										<AvatarFallback className="bg-accent text-accent-foreground text-xs font-medium tracking-[0.12px]">
											CN
										</AvatarFallback>
									</Avatar>
									<span>Account</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarFooter>
				</Sidebar>

				<SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent pr-3 pb-3">
					<header className="flex h-14 items-center justify-end pr-[env(titlebar-area-width,0px)] [-webkit-app-region:drag]">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Notifications"
							className="[-webkit-app-region:no-drag]"
						>
							<BellIcon />
						</Button>
					</header>
					<div className="bg-muted border-border flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-md border">
						{children}
					</div>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
