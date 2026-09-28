import { LogInIcon, LogOutIcon } from "lucide-react";

import { SettingsPageHeader } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { ButtonSkeleton } from "./ButtonSkeleton.js";
import {
	KiloGatewayAccountLoadingState,
	KiloGatewayAccountPanel,
} from "./KiloGatewayAccountPanel.js";
import { useKiloAuth } from "./KiloAuthContext.js";

/**
 * Account settings: Kilo sign-in status with sign-out controls. Rows follow
 * the AI Providers page pattern (SummaryCard rows joined in one bordered
 * panel) so account management reads the same as the rest of Settings. State
 * comes from the KiloAuthProvider.
 */
export function AccountSettings() {
	const auth = useKiloAuth();
	const kiloLoading = auth.isLoading && auth.deviceAuth.status === "idle" && !auth.profile;

	return (
		<div
			className="flex min-w-0 flex-col gap-6"
			data-qa-id="account-page"
			data-state={kiloLoading ? "loading" : "ready"}
		>
			<SettingsPageHeader />
			<section
				className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border"
				aria-label="Accounts"
				data-qa-id="account-rows"
			>
				<div>
					<AccountKiloRow />
				</div>
			</section>
		</div>
	);
}

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
					<SummaryCard.Title>Kilo</SummaryCard.Title>
					<SummaryCard.Description
						{...(signedIn && email
							? { "data-qa-id": "account-kilo-email" }
							: { "data-qa-id": "account-kilo-status" })}
					>
						{kiloDescription({
							connectionUnavailable: auth.connectionUnavailable,
							showDeviceAuth,
							signedIn,
							profileFailed,
							email,
						})}
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
	connectionUnavailable: boolean;
	showDeviceAuth: boolean;
	signedIn: boolean;
	profileFailed: boolean;
	email: string | undefined;
}): string {
	if (input.connectionUnavailable) return "Available in the desktop app.";
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
					<SummaryCard.Title>Kilo</SummaryCard.Title>
					<SummaryCard.Description>
						<SkeletonText className="w-48" />
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
