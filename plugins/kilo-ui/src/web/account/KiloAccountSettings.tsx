import { useMemo, type ReactNode } from "react";
import {
	ArrowUpRightIcon,
	Building2Icon,
	LogOutIcon,
	RefreshCwIcon,
	SparklesIcon,
	ZapIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@anaconda-agentic-desktop/ui/components/avatar";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { DeviceAuthPanel } from "./DeviceAuthPanel.js";
import { useKiloAuth, type KiloAuthContextValue } from "./KiloAuthContext.js";
import { KiloMark } from "./KiloMark.js";
import {
	buildOrgOptions,
	formatBalance,
	formatPassShort,
	formatRenewalDate,
	initialsFor,
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
 * Settings section: Kilo Gateway account — device OAuth login, profile, org,
 * balance / Kilo Pass, and logout. Contributed at `/settings/kilo-account`.
 */
export function KiloAccountSettings() {
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
			<PageShell state="unavailable">
				<p className="text-muted-foreground mt-1 text-sm" data-qa-id="kilo-account-unavailable">
					Kilo account sign-in requires the desktop app. Run Anaconda Agentic Desktop to
					authenticate with Kilo Gateway.
				</p>
			</PageShell>
		);
	}

	// During device login the panel is the loading UI — it already shows
	// activity ("initiating" / "waiting" / "finishing"), so skeletons must not
	// take over while the profile refetch is still in flight.
	const showDeviceAuth = auth.deviceAuth.status !== "idle";

	if (auth.isLoading && !showDeviceAuth) {
		return (
			<PageShell state="loading">
				<div className="mt-6 flex flex-col gap-4">
					<Skeleton className="h-20 w-full rounded-xl" />
					<Skeleton className="h-40 w-full rounded-xl" />
				</div>
			</PageShell>
		);
	}
	const signedIn = auth.authenticated === true && auth.profile;

	return (
		<PageShell
			state={signedIn ? "signed-in" : "signed-out"}
			subtitle={
				signedIn
					? "Your Kilo Gateway account, credits, and organization."
					: "Sign in to Kilo Gateway for models, credits, and organization settings."
			}
		>
			{showDeviceAuth ? (
				<DeviceAuthPanel
					deviceAuth={auth.deviceAuth}
					onCancel={auth.cancelLogin}
					onRetry={auth.login}
					onOpenBrowser={auth.openExternal}
					onCopy={copyText}
				/>
			) : null}

			{!showDeviceAuth && !signedIn ? <SignedOutHero onLogin={auth.login} /> : null}

			{signedIn && auth.profile ? (
				<SignedInView
					auth={auth}
					profile={auth.profile}
					orgOptions={orgOptions}
					currentOrgValue={currentOrgValue}
				/>
			) : null}
		</PageShell>
	);
}

function PageShell({
	state,
	subtitle,
	children,
}: {
	state: string;
	subtitle?: string;
	children: ReactNode;
}) {
	return (
		<div className="mx-auto w-full max-w-2xl" data-qa-id="kilo-account-settings" data-state={state}>
			<h1
				className="font-heading text-xl font-semibold tracking-tight"
				data-qa-id="settings-section-heading"
			>
				Kilo
			</h1>
			{subtitle ? <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p> : null}
			<div className="mt-6 flex flex-col gap-4">{children}</div>
		</div>
	);
}

const SIGN_IN_BENEFITS = [
	{ Icon: SparklesIcon, label: "500+ models" },
	{ Icon: ZapIcon, label: "Credits & Kilo Pass" },
	{ Icon: Building2Icon, label: "Team workspaces" },
] as const;

function SignedOutHero({ onLogin }: { onLogin: () => void }) {
	return (
		<div
			className="border-border bg-card overflow-hidden rounded-xl border"
			data-qa-id="kilo-account-signed-out"
		>
			<div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
				<KiloMark size="lg" />
				<h2 className="font-heading mt-5 text-lg font-semibold tracking-tight">
					Connect your Kilo account
				</h2>
				<p className="text-muted-foreground mt-1.5 max-w-sm text-sm text-balance">
					One sign-in for frontier models, your credit balance, and team workspaces — without
					leaving the app.
				</p>
				<Button
					type="button"
					size="lg"
					className="mt-5"
					onClick={onLogin}
					data-qa-id="kilo-account-login"
				>
					Sign in to Kilo
					<ArrowUpRightIcon data-icon="inline-end" />
				</Button>
			</div>
			<Separator />
			<ItemGroup className="grid grid-cols-3 gap-2 p-3">
				{SIGN_IN_BENEFITS.map(({ Icon, label }) => (
					<Item
						key={label}
						variant="muted"
						size="sm"
						role="listitem"
						className="flex-col justify-center"
					>
						<ItemMedia variant="icon" className="text-primary">
							<Icon />
						</ItemMedia>
						<ItemContent className="items-center">
							<ItemTitle>{label}</ItemTitle>
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}

function SignedInView({
	auth,
	profile,
	orgOptions,
	currentOrgValue,
}: {
	auth: KiloAuthContextValue;
	profile: KiloProfileData;
	orgOptions: OrgOption[];
	currentOrgValue: string | undefined;
}) {
	const { name, email } = profile.profile;

	return (
		<>
			<section className="border-border bg-card rounded-xl border">
				<div className="flex items-center gap-3.5 p-4">
					<Avatar size="lg">
						<AvatarFallback>{initialsFor(name, email)}</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold" data-qa-id="kilo-account-name">
							{name || email}
						</p>
						<p className="text-muted-foreground truncate text-xs" data-qa-id="kilo-account-email">
							{email}
						</p>
					</div>
				</div>

				{orgOptions.length > 0 ? (
					<>
						<Separator />
						<div className="flex items-center justify-between gap-4 p-4">
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
								<SelectTrigger
									aria-label="Organization"
									data-qa-id="kilo-account-org"
									className="w-44"
								>
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
													<span className="text-muted-foreground text-xs">
														{option.description}
													</span>
												) : null}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</div>
					</>
				) : null}
			</section>

			{profile.balance ? (
				<section
					className="border-border bg-card rounded-xl border"
					data-qa-id="kilo-account-balance"
				>
					<div className="p-4">
						<p className="text-sm font-medium">Balance</p>
						<div className="mt-1 flex items-center justify-between gap-4">
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
						<>
							<Separator />
							<KiloPassUsage pass={profile.kiloPass} />
						</>
					) : null}

					{isPersonalAccount(profile) && !profile.kiloPass ? (
						<>
							<Separator />
							<div className="flex items-center justify-between gap-4 p-4">
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
						</>
					) : null}
				</section>
			) : null}

			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground self-end"
				onClick={auth.logout}
				data-qa-id="kilo-account-logout"
			>
				<LogOutIcon data-icon="inline-start" />
				Sign Out of Kilo
			</Button>
		</>
	);
}

function KiloPassUsage({ pass }: { pass: NonNullable<KiloProfileData["kiloPass"]> }) {
	const percent = passUsagePercent(pass.currentPeriodUsageUsd, pass.currentPeriodBaseCreditsUsd);
	const renewal = pass.nextBillingAt ? formatRenewalDate(pass.nextBillingAt) : "";

	return (
		<div className="flex flex-col gap-2.5 p-4">
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
