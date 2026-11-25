import { LogInIcon, LogOutIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";
import { ButtonSkeleton } from "@kilo-desktop/ui/components/button-skeleton";
import { KiloGatewayAccountLoadingState, KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel";
import { useKiloAccount } from "../use-kilo-account";

/** What a Kilo account gives you; matches the onboarding sign-in step. */
const KILO_ACCOUNT_SUMMARY = "One account for frontier models, credits, and your team's settings.";

/**
 * The Kilo panel in Settings → Account, contributed to
 * `kilo.shell/account-panel`: the Kilo account row (sign-in status with
 * sign-in/out controls, and the account's details once connected), in the
 * SummaryCard row pattern the other account panels use. State comes from
 * kilo.core's account domain object.
 */
export function KiloAccountPanel() {
	const auth = useKiloAccount();
	const showDeviceAuth = auth.deviceSignIn.status !== "idle";
	const connected = auth.signedIn === true;
	const signedIn = connected && Boolean(auth.profile);
	const profileFailed = connected && !auth.profile && Boolean(auth.profileError);
	const initialLoading = auth.isLoading && !showDeviceAuth && !auth.profile;
	const showAccountDetails = signedIn || showDeviceAuth || profileFailed;
	const email = auth.profile?.email;

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
					{auth.signedIn === true ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={auth.signOut}
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
							onClick={() => auth.signIn()}
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
 * Mirrors `KiloAccountPanel` while auth loads. Once credentials are known to
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
