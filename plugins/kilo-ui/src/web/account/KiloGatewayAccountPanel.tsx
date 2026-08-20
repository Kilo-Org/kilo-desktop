import { useMemo } from "react";
import { ArrowUpRightIcon, CircleAlertIcon, RefreshCwIcon, ZapIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { DeviceAuthPanel } from "./DeviceAuthPanel.js";
import { useKiloAuth, type KiloAuthContextValue } from "./KiloAuthContext.js";
import { KiloSignInCard } from "./KiloSignInCard.js";
import {
	buildOrgOptions,
	formatBalance,
	formatPassShort,
	formatRenewalDate,
	isPersonalAccount,
	KILO_CREDITS_URL,
	KILO_PASS_URL,
	KILO_PROFILE_URL,
	organizationIdFromValue,
	passUsagePercent,
	PERSONAL_ORG_VALUE,
	resolveCurrentOrgValue,
	type KiloProfileData,
	type OrgOption,
} from "./kilo-auth.js";

/**
 * Kilo Gateway account body: device OAuth, profile, org, balance / Kilo Pass,
 * and logout. Composed into the Providers expandable card (and kept free of a
 * settings PageShell so onboarding can keep using the shared sign-in pieces).
 */
export function KiloGatewayAccountPanel({
	showSignOut = true,
}: {
	/** When false, the host (e.g. Providers card header) owns the sign-out control. */
	showSignOut?: boolean;
} = {}) {
	const sdk = useSdk("kilo-ui");
	const auth = useKiloAuth();

	const orgOptions = useMemo(
		() => (auth.profile ? buildOrgOptions(auth.profile.profile) : []),
		[auth.profile],
	);
	const currentOrgValue = useMemo(
		() => (auth.profile ? resolveCurrentOrgValue(auth.profile, orgOptions) : undefined),
		[auth.profile, orgOptions],
	);

	const copyText = (text: string) => {
		void sdk.shell.copyText(text);
	};

	if (auth.connectionUnavailable) {
		return (
			<div
				className="flex flex-col gap-3"
				data-qa-id="kilo-account-settings"
				data-state="unavailable"
			>
				<p className="text-muted-foreground text-sm" data-qa-id="kilo-account-unavailable">
					Kilo Gateway connection requires the desktop app. Run Anaconda Agentic Desktop to
					authenticate with Kilo Gateway.
				</p>
			</div>
		);
	}

	// During device login the panel is the loading UI — it already shows
	// activity ("initiating" / "waiting" / "finishing"), so skeletons must not
	// take over while the profile refetch is still in flight.
	const showDeviceAuth = auth.deviceAuth.status !== "idle";

	if (auth.isLoading && !showDeviceAuth) {
		return (
			<div className="flex flex-col gap-4" data-qa-id="kilo-account-settings" data-state="loading">
				<Skeleton className="h-20 w-full rounded-xl" />
				<Skeleton className="h-40 w-full rounded-xl" />
			</div>
		);
	}

	const signedIn = auth.authenticated === true && auth.profile;
	const profileFailed = auth.authenticated === true && !auth.profile && Boolean(auth.profileError);
	const state = signedIn ? "signed-in" : profileFailed ? "profile-error" : "signed-out";

	return (
		<div className="flex flex-col gap-4" data-qa-id="kilo-account-settings" data-state={state}>
			{showDeviceAuth ? (
				<DeviceAuthPanel
					embedded
					deviceAuth={auth.deviceAuth}
					onCancel={auth.cancelLogin}
					onRetry={auth.login}
					onOpenBrowser={auth.openExternal}
					onCopy={copyText}
				/>
			) : null}

			{!showDeviceAuth && profileFailed ? (
				<ProfileLoadError
					message={auth.profileError ?? "Couldn't load your Kilo account"}
					retrying={auth.isRefreshing}
					onRetry={auth.refreshProfile}
					{...(showSignOut ? { onLogout: auth.logout } : {})}
				/>
			) : null}

			{!showDeviceAuth && !signedIn && !profileFailed ? (
				<KiloSignInCard embedded onLogin={auth.login} />
			) : null}

			{signedIn && auth.profile ? (
				<SignedInView
					auth={auth}
					profile={auth.profile}
					orgOptions={orgOptions}
					currentOrgValue={currentOrgValue}
					showSignOut={showSignOut}
				/>
			) : null}
		</div>
	);
}

function SignedInView({
	auth,
	profile,
	orgOptions,
	currentOrgValue,
	showSignOut,
}: {
	auth: KiloAuthContextValue;
	profile: KiloProfileData;
	orgOptions: OrgOption[];
	currentOrgValue: string | undefined;
	showSignOut: boolean;
}) {
	const orgError = auth.orgError;

	return (
		<div className="flex flex-col gap-5">
			{orgError ? (
				<AccountError
					qa="kilo-account-org-error"
					title="Couldn't switch organization"
					message={orgError.message}
					retrying={auth.isSwitchingOrg}
					onRetry={() => auth.setOrganization(orgError.organizationId)}
					retryQa="kilo-account-org-retry"
					onDismiss={auth.dismissOrgError}
					dismissQa="kilo-account-org-dismiss"
				/>
			) : null}

			{orgOptions.length > 0 ? (
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0">
						<p className="text-sm font-medium">Organization</p>
						<p className="text-muted-foreground mt-0.5 text-xs">
							Models and credits are billed to this account.
						</p>
					</div>
					<Select
						items={orgOptions.map((o) => ({ value: o.value, label: o.label }))}
						value={currentOrgValue}
						disabled={auth.isSwitchingOrg}
						onValueChange={(next) => {
							if (next == null) return;
							const id = organizationIdFromValue(next);
							const current =
								currentOrgValue === PERSONAL_ORG_VALUE ? null : (currentOrgValue ?? null);
							if (id === current) return;
							auth.setOrganization(id);
						}}
					>
						<SelectTrigger aria-label="Organization" data-qa-id="kilo-account-org" className="w-44">
							<SelectValue>
								{(value) => orgOptions.find((o) => o.value === value)?.label ?? "Personal"}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{orgOptions.map((option) => (
									<SelectItem
										key={option.value}
										value={option.value}
										className="[&>div]:flex-col [&>div]:items-start [&>div]:gap-0.5"
									>
										<span className="max-w-full truncate">{option.label}</span>
										{option.description ? (
											<span className="text-muted-foreground text-xs">{option.description}</span>
										) : null}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			) : null}

			{profile.balance ? (
				<section className="flex flex-col gap-4" data-qa-id="kilo-account-balance">
					<div>
						<p className="text-sm font-medium">Balance</p>
						<div className="mt-2 flex items-center justify-between gap-4">
							<p
								className="font-heading text-3xl font-semibold tracking-tight tabular-nums"
								data-qa-id="kilo-account-balance-value"
							>
								{formatBalance(profile.balance.balance)}
							</p>
							<div className="flex shrink-0 items-center gap-2">
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Refresh balance"
									disabled={auth.isRefreshing}
									onClick={auth.refreshProfile}
									data-qa-id="kilo-account-refresh"
								>
									<RefreshCwIcon className={cn(auth.isRefreshing && "animate-spin")} />
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => auth.openExternal(KILO_CREDITS_URL)}
									data-qa-id="kilo-account-top-up"
								>
									Top up
									<ArrowUpRightIcon data-icon="inline-end" />
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => auth.openExternal(KILO_PROFILE_URL)}
									data-qa-id="kilo-account-dashboard"
								>
									Kilo Dashboard
									<ArrowUpRightIcon data-icon="inline-end" />
								</Button>
							</div>
						</div>
					</div>

					{isPersonalAccount(profile) && profile.kiloPass ? (
						<KiloPassUsage pass={profile.kiloPass} />
					) : null}

					{isPersonalAccount(profile) && !profile.kiloPass ? (
						<div className="flex items-center justify-between gap-4">
							<div className="min-w-0">
								<p className="text-sm font-medium">Kilo Pass</p>
								<p className="text-muted-foreground mt-0.5 text-xs">
									Monthly credits at a flat rate for heavy usage.
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => auth.openExternal(KILO_PASS_URL)}
								data-qa-id="kilo-account-get-pass"
							>
								Get Kilo Pass
								<ArrowUpRightIcon data-icon="inline-end" />
							</Button>
						</div>
					) : null}
				</section>
			) : null}

			{showSignOut ? <SignOutButton onLogout={auth.logout} /> : null}
		</div>
	);
}

function ProfileLoadError({
	message,
	retrying,
	onRetry,
	onLogout,
}: {
	message: string;
	retrying: boolean;
	onRetry: () => void;
	onLogout?: () => void;
}) {
	return (
		<>
			<AccountError
				qa="kilo-account-profile-error"
				title="Couldn't load your Kilo account"
				message={message}
				retrying={retrying}
				onRetry={onRetry}
				retryQa="kilo-account-profile-retry"
			/>
			{onLogout ? <SignOutButton onLogout={onLogout} /> : null}
		</>
	);
}

function AccountError({
	qa,
	title,
	message,
	retrying,
	onRetry,
	retryQa,
	onDismiss,
	dismissQa,
}: {
	qa: string;
	title: string;
	message: string;
	retrying: boolean;
	onRetry: () => void;
	retryQa: string;
	onDismiss?: () => void;
	dismissQa?: string;
}) {
	return (
		<div
			className="border-destructive/40 bg-destructive/5 overflow-hidden rounded-xl border"
			data-qa-id={qa}
		>
			<div className="flex items-start gap-3 p-4">
				<CircleAlertIcon className="text-destructive-foreground mt-0.5 size-4 shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">{title}</p>
					<p className="text-muted-foreground mt-1 text-sm break-words">{message}</p>
				</div>
			</div>
			<div className="bg-muted/50 border-border flex items-center justify-start gap-2 border-t px-4 py-2.5">
				<Button type="button" size="sm" onClick={onRetry} disabled={retrying} data-qa-id={retryQa}>
					{retrying ? <RefreshCwIcon className="animate-spin" data-icon="inline-start" /> : null}
					Try again
				</Button>
				{onDismiss && dismissQa ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onDismiss}
						data-qa-id={dismissQa}
					>
						Dismiss
					</Button>
				) : null}
			</div>
		</div>
	);
}

function SignOutButton({ onLogout }: { onLogout: () => void }) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="self-end"
			onClick={onLogout}
			data-qa-id="kilo-account-logout"
		>
			Disconnect
		</Button>
	);
}

function KiloPassUsage({ pass }: { pass: NonNullable<KiloProfileData["kiloPass"]> }) {
	const percent = passUsagePercent(pass.currentPeriodUsageUsd, pass.currentPeriodBaseCreditsUsd);
	const renewal = pass.nextBillingAt ? formatRenewalDate(pass.nextBillingAt) : "";

	return (
		<div className="flex flex-col gap-2.5">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<ZapIcon className="text-primary size-4" />
					<span className="text-sm font-medium">Kilo Pass</span>
				</div>
				<span
					className="text-muted-foreground text-sm tabular-nums"
					data-qa-id="kilo-account-pass-usage"
				>
					{formatPassShort(pass.currentPeriodUsageUsd)} /{" "}
					{formatPassShort(pass.currentPeriodBaseCreditsUsd)}
				</span>
			</div>
			<div className="bg-muted h-2 overflow-hidden rounded-full">
				<div
					className="bg-primary h-full rounded-full transition-[width]"
					style={{ width: `${percent}%` }}
					data-qa-id="kilo-account-pass-bar"
				/>
			</div>
			<div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
				<span className="tabular-nums">
					{Math.round(percent)}% used
					{pass.currentPeriodBonusCreditsUsd > 0
						? ` · +${formatBalance(pass.currentPeriodBonusCreditsUsd)} bonus`
						: ""}
				</span>
				{renewal ? <span>Renews {renewal}</span> : null}
			</div>
		</div>
	);
}
