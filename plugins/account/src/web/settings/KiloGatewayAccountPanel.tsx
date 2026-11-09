import { useMemo } from "react";
import { ArrowUpRightIcon, CircleAlertIcon, RefreshCwIcon, ZapIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button, buttonVariants } from "@kilo-desktop/ui/components/button";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Progress } from "@kilo-desktop/ui/components/progress";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { ButtonSkeleton } from "@kilo-desktop/ui/components/button-skeleton";
import { DeviceAuthPanel } from "./DeviceAuthPanel";
import { useKiloAuth, type KiloAuthContextValue } from "../use-kilo-auth";
import { KiloSignInCard } from "./KiloSignInCard";
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
} from "../kilo-auth";

/**
 * Kilo Gateway account body: device OAuth, profile, org, balance / Kilo Pass,
 * and logout. Kept free of a settings PageShell so the Providers page can
 * reuse its authorization and recovery states without duplicating the flow.
 */
export function KiloGatewayAccountPanel({
	showSignOut = true,
}: {
	/** When false, the host owns the sign-out control. */
	showSignOut?: boolean;
} = {}) {
	const auth = useKiloAuth();

	const orgOptions = useMemo(
		() => (auth.profile ? buildOrgOptions(auth.profile.profile) : []),
		[auth.profile],
	);
	const currentOrgValue = useMemo(
		() => (auth.profile ? resolveCurrentOrgValue(auth.profile, orgOptions) : undefined),
		[auth.profile, orgOptions],
	);

	const copyText = auth.copyText;

	if (auth.connectionUnavailable) {
		return (
			<div
				className="flex flex-col gap-3"
				data-qa-id="kilo-account-settings"
				data-state="unavailable"
			>
				<p className="text-muted-foreground text-sm" data-qa-id="kilo-account-unavailable">
					{auth.unavailableMessage}
				</p>
			</div>
		);
	}

	// During device login the panel is the loading UI — it already shows
	// activity ("initiating" / "waiting" / "finishing"), so skeletons must not
	// take over while the profile refetch is still in flight.
	const showDeviceAuth = auth.deviceAuth.status !== "idle";

	if (auth.isLoading && !showDeviceAuth) {
		return <KiloGatewayAccountLoadingState showSignOut={showSignOut} />;
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
					message={auth.profileError ?? "Could not load your Kilo account"}
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

/**
 * Placeholder for `SignedInView` while a known signed-in profile loads. The
 * profile decides which sections exist, so this reserves only the balance and
 * its actions. The Kilo Pass section is left out: it is absent for
 * organization accounts and differs in height between "Get Kilo Pass" and the
 * usage meter, so guessing it would leave the card taller than what loads.
 * Text lines sit inside the real text elements so they reserve the same line
 * heights.
 */
export function KiloGatewayAccountLoadingState({
	showSignOut = true,
}: { showSignOut?: boolean } = {}) {
	return (
		<div
			className="flex flex-col gap-4"
			role="status"
			aria-label="Loading your Kilo account"
			data-qa-id="kilo-account-settings"
			data-state="loading"
		>
			<div className="flex flex-col gap-2">
				<div className="grid items-start gap-5 sm:grid-cols-2">
					<section className="min-w-0">
						<p className="text-muted-foreground text-xs font-medium">
							<SkeletonText className="w-24" />
						</p>
						<div className="mt-1 flex items-center gap-1.5">
							<p className="text-lg font-semibold tabular-nums">
								<SkeletonText className="w-16" />
							</p>
							<ButtonSkeleton size="icon-xs">
								<RefreshCwIcon />
							</ButtonSkeleton>
						</div>
					</section>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<ButtonSkeleton>
						Top up
						<ArrowUpRightIcon data-icon="inline-end" />
					</ButtonSkeleton>
					<ButtonSkeleton>
						Kilo Dashboard
						<ArrowUpRightIcon data-icon="inline-end" />
					</ButtonSkeleton>
					{showSignOut ? <ButtonSkeleton className="ml-auto">Sign out</ButtonSkeleton> : null}
				</div>
			</div>
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
		<div className="flex flex-col gap-4">
			{orgError ? (
				<AccountError
					qa="kilo-account-org-error"
					title="Could not switch organization"
					message={orgError.message}
					retrying={auth.isSwitchingOrg}
					onRetry={() => auth.setOrganization(orgError.organizationId)}
					retryQa="kilo-account-org-retry"
					onDismiss={auth.dismissOrgError}
					dismissQa="kilo-account-org-dismiss"
				/>
			) : null}

			<div className="flex flex-col gap-2">
				<div className="grid items-start gap-5 sm:grid-cols-2">
					{profile.balance ? (
						<section className="min-w-0" data-qa-id="kilo-account-balance">
							<p className="text-muted-foreground text-xs font-medium">Available balance</p>
							<div className="mt-1 flex items-center gap-1.5">
								<p
									className="text-lg font-semibold tabular-nums"
									data-qa-id="kilo-account-balance-value"
								>
									{formatBalance(profile.balance.balance)}
								</p>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label="Refresh balance"
									disabled={auth.isRefreshing}
									onClick={auth.refreshProfile}
									data-qa-id="kilo-account-refresh"
								>
									<RefreshCwIcon className={cn(auth.isRefreshing && "animate-spin")} />
								</Button>
							</div>
						</section>
					) : null}

					{orgOptions.length > 0 ? (
						<div className="min-w-0">
							<p className="text-muted-foreground text-xs font-medium">Organization</p>
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
								<SelectTrigger
									aria-label="Organization"
									data-qa-id="kilo-account-org"
									className="mt-1 w-full"
								>
									<SelectValue>
										{(value) => orgOptions.find((o) => o.value === value)?.label ?? "Personal"}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{orgOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												<span className="flex min-w-0 flex-col">
													<span className="truncate">{option.label}</span>
													{option.description ? (
														<span className="text-muted-foreground truncate text-xs">
															{option.description}
														</span>
													) : null}
												</span>
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</div>
					) : null}
				</div>

				{profile.balance || showSignOut ? (
					<div className="flex flex-wrap items-center gap-2" data-qa-id="kilo-account-actions">
						{profile.balance ? (
							<>
								<ExternalLink
									href={KILO_CREDITS_URL}
									onOpen={auth.openExternal}
									className={buttonVariants({ variant: "outline", size: "sm" })}
									data-qa-id="kilo-account-top-up"
								>
									Top up
									<ArrowUpRightIcon data-icon="inline-end" />
								</ExternalLink>
								<ExternalLink
									href={KILO_PROFILE_URL}
									onOpen={auth.openExternal}
									className={buttonVariants({ variant: "ghost", size: "sm" })}
									data-qa-id="kilo-account-dashboard"
								>
									Kilo Dashboard
									<ArrowUpRightIcon data-icon="inline-end" />
								</ExternalLink>
							</>
						) : null}
						{showSignOut ? <SignOutButton onLogout={auth.logout} /> : null}
					</div>
				) : null}
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
					<ExternalLink
						href={KILO_PASS_URL}
						onOpen={auth.openExternal}
						className={buttonVariants({ variant: "outline", size: "sm" })}
						data-qa-id="kilo-account-get-pass"
					>
						Get Kilo Pass
						<ArrowUpRightIcon data-icon="inline-end" />
					</ExternalLink>
				</div>
			) : null}
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
				title="Could not load your Kilo account"
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
		<Alert variant="destructive" data-qa-id={qa}>
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				<p className="break-words">{message}</p>
				<div className="mt-2 flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onRetry}
						disabled={retrying}
						data-qa-id={retryQa}
					>
						<RefreshCwIcon
							data-icon="inline-start"
							className={retrying ? "animate-spin" : undefined}
						/>
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
			</AlertDescription>
		</Alert>
	);
}

function SignOutButton({ onLogout }: { onLogout: () => void }) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="ml-auto"
			onClick={onLogout}
			data-qa-id="kilo-account-logout"
		>
			Sign out
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
					<ZapIcon className="text-primary-ink size-4" />
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
			<Progress value={percent} aria-label="Kilo Pass usage" data-qa-id="kilo-account-pass-bar" />
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
