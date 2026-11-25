import { CircleAlertIcon, LogInIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
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

import { Navigation } from "../../contracts";
import { ACCOUNT_SETTINGS_SECTION, initialsFor, type DeviceSignInStatus } from "./kilo-account";
import { useKiloAccount } from "./use-kilo-account";

/** Device sign-in statuses where the panel on the Account settings page owns the UI. */
const ACTIVE_DEVICE_SIGN_IN: readonly DeviceSignInStatus[] = ["initiating", "waiting", "finishing"];

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
 * The account entry at the foot of the left sidebar, drawn by the frame.
 * Signed out: one-click Kilo device sign-in (device code shows on the Account
 * settings page; a failed attempt falls back to the Sign in button so retry
 * stays reachable). Signed in: compact avatar/name header with a Sign out item. A
 * failed profile load links to the Account settings page, which owns retry and
 * logout for that state. Shows a stable account-row skeleton while auth or
 * profile state is pending, and renders nothing when Kilo is unavailable.
 */
export function SidebarAccount() {
	const navigation = useDomainObject(Navigation);
	const auth = useKiloAccount();
	const openSettings = (section?: string) =>
		void navigation?.methods.openSettings(section ? { section } : {}).catch(() => undefined);
	const openAccountSettings = () => openSettings(ACCOUNT_SETTINGS_SECTION);

	if (auth.connectionUnavailable) return null;
	if (auth.isLoading || auth.signedIn === null) return <AccountSkeleton />;

	if (ACTIVE_DEVICE_SIGN_IN.includes(auth.deviceSignIn.status)) {
		return (
			<Button
				type="button"
				variant="outline"
				className="min-w-0 flex-1"
				onClick={openAccountSettings}
				data-qa-id="sidebar-kilo-signing-in"
			>
				<Spinner data-icon="inline-start" aria-hidden="true" />
				Signing in…
			</Button>
		);
	}

	if (auth.signedIn === false) {
		return (
			<Button
				type="button"
				className="min-w-0 flex-1"
				onClick={() => {
					auth.signIn();
					openAccountSettings();
				}}
				data-qa-id="sidebar-kilo-login"
			>
				<LogInIcon data-icon="inline-start" />
				Sign in
			</Button>
		);
	}

	const profile = auth.profile;
	if (auth.signedIn !== true) return null;

	// Profile failed to load: the Account settings page renders the retry/logout
	// UI for this state, so route the user there instead of hiding the dock.
	if (!profile) {
		if (!auth.profileError) return <AccountSkeleton />;
		return (
			<Button
				type="button"
				variant="outline"
				className="min-w-0 flex-1"
				onClick={openAccountSettings}
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
						<Avatar className="size-[22px] after:hidden">
							<AvatarFallback className="text-2xs">{initials || <UserIcon />}</AvatarFallback>
						</Avatar>
						<div className="grid min-w-0 flex-1 text-left text-sm">
							<span className="truncate font-medium">{accountName}</span>
						</div>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="top" align="start">
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
							<DropdownMenuItem onClick={() => openSettings()} data-qa-id="sidebar-kilo-settings">
								<SettingsIcon />
								Settings
							</DropdownMenuItem>
							<DropdownMenuItem onClick={auth.signOut} data-qa-id="sidebar-kilo-logout">
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
