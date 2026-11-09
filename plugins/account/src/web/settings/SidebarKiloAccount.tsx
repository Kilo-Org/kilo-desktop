import { CircleAlertIcon, LogInIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";

import { useDomain } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Avatar, AvatarFallback } from "@kilo-desktop/ui/components/avatar";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@kilo-desktop/ui/components/sidebar";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";

import { useKiloAuth } from "../use-kilo-auth";
import {
	initialsFor,
	KILO_ACCOUNT_PATH,
	startKiloDeviceAuth,
	type DeviceAuthStatus,
} from "../kilo-auth";

/** Device-auth statuses where the panel on the Account settings page owns the UI. */
const ACTIVE_DEVICE_AUTH: readonly DeviceAuthStatus[] = ["initiating", "waiting", "finishing"];

function AccountSkeleton() {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<div
					className="flex h-8 min-w-0 items-center gap-2 px-2"
					data-qa-id="sidebar-kilo-account-loading"
					role="status"
					aria-label="Loading account"
					aria-busy="true"
				>
					<Skeleton className="size-[22px] shrink-0 rounded-full" />
					<Skeleton className="h-3.5 w-24 max-w-full" />
				</div>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

/**
 * The sidebar account entry, contributed to `kilo.shell/left-sidebar-account`.
 * Signed out: one-click Kilo device sign-in (device code shows on the Account
 * settings page; a failed attempt falls back to the Sign in button so retry
 * stays reachable). Signed in: compact avatar/name header with a Sign out item. A
 * failed profile load links to the Account settings page, which owns retry and
 * logout for that state. Shows a stable account-row skeleton while auth or
 * profile state is pending, and renders nothing when Kilo is unavailable.
 */
export function SidebarKiloAccount() {
	const navigation = useDomain(Navigation);
	const auth = useKiloAuth();
	const navigate = (path: string) =>
		void navigation?.methods.navigate({ path }).catch(() => undefined);

	if (auth.connectionUnavailable) return null;
	if (auth.isLoading || auth.authenticated === null) return <AccountSkeleton />;

	if (ACTIVE_DEVICE_AUTH.includes(auth.deviceAuth.status)) {
		return (
			<Button
				type="button"
				variant="outline"
				className="min-w-0 flex-1"
				onClick={() => navigate(KILO_ACCOUNT_PATH)}
				data-qa-id="sidebar-kilo-signing-in"
			>
				<Spinner data-icon="inline-start" aria-hidden="true" />
				Signing in…
			</Button>
		);
	}

	if (auth.authenticated === false) {
		return (
			<Button
				type="button"
				className="min-w-0 flex-1"
				onClick={() => {
					startKiloDeviceAuth(auth.login, navigate);
				}}
				data-qa-id="sidebar-kilo-login"
			>
				<LogInIcon data-icon="inline-start" />
				Sign in
			</Button>
		);
	}

	const profile = auth.profile?.profile;
	if (auth.authenticated !== true) return null;

	// Profile failed to load: the Account settings page renders the retry/logout
	// UI for this state, so route the user there instead of hiding the dock.
	if (!profile) {
		if (!auth.profileError) return <AccountSkeleton />;
		return (
			<Button
				type="button"
				variant="outline"
				className="min-w-0 flex-1"
				onClick={() => navigate(KILO_ACCOUNT_PATH)}
				data-qa-id="sidebar-kilo-profile-error"
			>
				<CircleAlertIcon data-icon="inline-start" />
				Account unavailable
			</Button>
		);
	}

	const accountName = profile.name?.trim() || profile.email;
	const initials = initialsFor(profile.name, profile.email);

	return (
		<SidebarMenu>
			<SidebarMenuItem className="has-data-open:bg-sidebar-accent hover:bg-sidebar-accent rounded-md transition-colors">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								aria-label={`Account menu for ${accountName}`}
								className="data-open:text-sidebar-accent-foreground h-8 w-full min-w-0 gap-2! px-2 hover:bg-transparent data-open:bg-transparent data-open:hover:bg-transparent"
								data-qa-id="sidebar-kilo-account"
							/>
						}
					>
						<Avatar className="size-[22px]">
							<AvatarFallback className="text-2xs">{initials || <UserIcon />}</AvatarFallback>
						</Avatar>
						<div className="grid min-w-0 flex-1 text-left text-sm">
							<span className="truncate font-medium">{accountName}</span>
						</div>
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-64" side="top" align="start" sideOffset={4}>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2.5 px-1 py-1.5 text-left text-sm">
									<Avatar>
										<AvatarFallback>{initials || <UserIcon />}</AvatarFallback>
									</Avatar>
									<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{accountName}</span>
										<span className="text-muted-foreground truncate text-xs">{profile.email}</span>
									</div>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem
								onClick={() => navigate("/settings")}
								data-qa-id="sidebar-kilo-settings"
							>
								<SettingsIcon />
								Settings
							</DropdownMenuItem>
							<DropdownMenuItem onClick={auth.logout} data-qa-id="sidebar-kilo-logout">
								<LogOutIcon />
								Sign out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
