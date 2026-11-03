import { LogInIcon, LogOutIcon } from "lucide-react";

import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";
import { ButtonSkeleton } from "@kilo-desktop/ui/components/button-skeleton";
import { KiloGatewayAccountLoadingState, KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel";
import { AccountPanel } from "../../contracts";
import { useKiloAuth } from "../use-kilo-auth";

/**
 * Account settings: the Kilo account panel (sign-in status with sign-in/out
 * controls), followed by one panel per contributed account. Panels use the
 * SummaryCard row pattern so account management reads the same as the rest of
 * Settings. Kilo state comes from kilo.account's identity domain; other
 * plugins add panels through `kilo.account/account-panel`.
 */
export function AccountSettings() {
	const auth = useKiloAuth();
	const contributedPanels = useExtensions(AccountPanel);
	const kiloLoading = auth.isLoading && auth.deviceAuth.status === "idle" && !auth.profile;

	return (
		<div
			className="flex min-w-0 flex-col gap-6"
			data-qa-id="account-page"
			data-state={kiloLoading ? "loading" : "ready"}
		>
			<SettingsPageHeader />
			<section
				className="flex min-w-0 flex-col gap-4"
				aria-label="Accounts"
				data-qa-id="account-rows"
			>
				<section
					className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border"
					aria-label="Kilo"
					data-qa-id="account-panel-kilo"
				>
					<div>
						<AccountKiloRow />
					</div>
				</section>
				{contributedPanels.map((contribution) => (
					<section
						key={contribution.key}
						// `empty:hidden`: a panel may render nothing (e.g. behind a flag);
						// don't leave an empty bordered frame behind.
						className="border-border bg-card min-w-0 overflow-hidden rounded-lg border empty:hidden"
						data-qa-id={`account-panel-${contribution.key}`}
					>
						<RenderContribution contribution={contribution} />
					</section>
				))}
			</section>
		</div>
	);
}

/** What a Kilo account gives you; matches the onboarding sign-in step. */
const KILO_ACCOUNT_SUMMARY = "One account for frontier models, credits, and your team's settings.";

function AccountKiloRow() {
	const auth = useKiloAuth();
	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const connected = auth.authenticated === true;
	const signedIn = connected && Boolean(auth.profile);
	const profileFailed = connected && !auth.profile && Boolean(auth.profileError);
	const initialLoading = auth.isLoading && !showDeviceAuth && !auth.profile;
	const showAccountDetails = signedIn || showDeviceAuth || profileFailed;
	const email = auth.profile?.profile.email;

	if (initialLoading) return <KiloRowLoading connected={connected} />;

	return (
		<div
			className="min-w-0"
			data-qa-id="account-kilo-row"
			data-state={showAccountDetails ? "expanded" : "summary"}
		>
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<ProviderIcon provider="kilo" variant="color" size={18} fallbackLabel="Kilo" />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title className="w-full min-w-0 gap-1.5">
						<span className="shrink-0" data-qa-id="account-kilo-title">
							Kilo
						</span>
						<span aria-hidden="true" className="text-muted-foreground font-normal">
							·
						</span>
						<span
							className="text-muted-foreground min-w-0 truncate font-normal"
							{...(signedIn && email
								? { "data-qa-id": "account-kilo-email" }
								: { "data-qa-id": "account-kilo-status" })}
						>
							{kiloDescription({
								unavailableMessage: auth.connectionUnavailable
									? auth.unavailableMessage
									: undefined,
								showDeviceAuth,
								signedIn,
								profileFailed,
								email,
							})}
						</span>
					</SummaryCard.Title>
					<SummaryCard.Description className="line-clamp-none">
						{KILO_ACCOUNT_SUMMARY}
					</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions className="gap-1" data-qa-id="account-kilo-actions">
					{/* Sign-out stays available whenever credentials exist, even when
					    the profile fetch failed — otherwise that state is unrecoverable
					    from this page. */}
					{auth.authenticated === true ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={auth.logout}
							data-qa-id="account-kilo-sign-out"
						>
							<LogOutIcon data-icon="inline-start" />
							Sign out
						</Button>
					) : null}
					{!signedIn && !profileFailed && !showDeviceAuth ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={auth.connectionUnavailable}
							onClick={() => auth.login()}
							data-qa-id="account-kilo-sign-in"
						>
							<LogInIcon data-icon="inline-start" />
							Sign in
						</Button>
					) : null}
				</SummaryCard.Actions>
			</SummaryCard.Row>

			{showAccountDetails ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountPanel showSignOut={false} />
				</div>
			) : null}
		</div>
	);
}

function kiloDescription(input: {
	unavailableMessage: string | undefined;
	showDeviceAuth: boolean;
	signedIn: boolean;
	profileFailed: boolean;
	email: string | undefined;
}): string {
	if (input.unavailableMessage) return input.unavailableMessage;
	if (input.showDeviceAuth) return "Finish connecting your Kilo account.";
	if (input.profileFailed) return "Your account is connected, but its profile could not be loaded.";
	if (input.signedIn) return `Signed in as ${input.email ?? "your Kilo account"}`;
	return "Not signed in.";
}

/**
 * Mirrors `AccountKiloRow` while auth loads. Once credentials are known to
 * exist, the account details panel is reserved too, so a slow profile fetch
 * doesn't pop ~200px of balance/actions in under the row.
 */
function KiloRowLoading({ connected }: { connected: boolean }) {
	return (
		<div className="min-w-0" data-qa-id="account-kilo-row" data-state="loading" aria-busy="true">
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<ProviderIcon provider="kilo" variant="color" size={18} fallbackLabel="Kilo" />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title className="w-full min-w-0 gap-1.5">
						<span className="shrink-0" data-qa-id="account-kilo-title">
							Kilo
						</span>
						<SkeletonText className="w-40" />
					</SummaryCard.Title>
					<SummaryCard.Description className="line-clamp-none">
						{KILO_ACCOUNT_SUMMARY}
					</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions>
					<AccountActionSkeleton signedIn={connected} />
				</SummaryCard.Actions>
			</SummaryCard.Row>
			{connected ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountLoadingState showSignOut={false} />
				</div>
			) : null}
		</div>
	);
}

/** Sized to the Sign in / Sign out button the loaded row will show. */
function AccountActionSkeleton({ signedIn }: { signedIn: boolean }) {
	return signedIn ? (
		<ButtonSkeleton>
			<LogOutIcon data-icon="inline-start" />
			Sign out
		</ButtonSkeleton>
	) : (
		<ButtonSkeleton>
			<LogInIcon data-icon="inline-start" />
			Sign in
		</ButtonSkeleton>
	);
}
