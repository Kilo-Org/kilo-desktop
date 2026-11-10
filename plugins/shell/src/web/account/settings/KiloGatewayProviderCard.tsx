import { LogInIcon, LogOutIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

import { ButtonSkeleton } from "@kilo-desktop/ui/components/button-skeleton";
import { KiloGatewayAccountLoadingState, KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel";
import { useKiloAccount } from "../use-kilo-account";
import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";

/**
 * Kilo is the default provider path. When signed in, account and billing
 * details stay open on the card so they don't compete with the rest of the
 * provider inventory for a disclosure control. While auth loads, the card keeps
 * its real icon and title and reserves the description, the Sign in / Sign out
 * button, and — once credentials are known to exist — the account details.
 */
export function KiloGatewayProviderDisclosure() {
	const auth = useKiloAccount();
	const showDeviceAuth = auth.deviceSignIn.status !== "idle";
	const connected = auth.signedIn === true;
	const signedIn = connected && Boolean(auth.profile);
	const profileFailed = auth.signedIn === true && !auth.profile && Boolean(auth.profileError);
	const showRecovery = showDeviceAuth || profileFailed;
	const showAccountDetails = signedIn || showRecovery;
	const initialLoading = auth.isLoading && !showDeviceAuth && !auth.profile;
	const email = auth.profile?.profile.email;
	return (
		<div
			className="min-w-0"
			data-qa-id="kilo-providers-row-kilo"
			data-state={initialLoading ? "loading" : showAccountDetails ? "expanded" : "summary"}
			aria-busy={initialLoading || undefined}
		>
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<ProviderIcon provider="kilo" variant="color" size={18} fallbackLabel="Kilo Gateway" />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title>Kilo Gateway</SummaryCard.Title>
					{initialLoading ? (
						<SummaryCard.Description>
							<SkeletonText className="w-48" />
						</SummaryCard.Description>
					) : (
						<SummaryCard.Description
							{...(signedIn && email ? { "data-qa-id": "kilo-account-email" } : {})}
						>
							{gatewayDescription({
								unavailableMessage: auth.connectionUnavailable
									? auth.unavailableMessage
									: undefined,
								showDeviceAuth,
								signedIn,
								profileFailed,
								email,
							})}
						</SummaryCard.Description>
					)}
				</SummaryCard.Content>
				<SummaryCard.Actions className="gap-1" data-qa-id="kilo-provider-header-actions">
					{initialLoading ? (
						<ButtonSkeleton>
							{connected ? (
								<LogOutIcon data-icon="inline-start" />
							) : (
								<LogInIcon data-icon="inline-start" />
							)}
							{connected ? "Sign out" : "Sign in"}
						</ButtonSkeleton>
					) : null}
					{connected && !initialLoading ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={auth.signOut}
							data-qa-id="kilo-account-logout"
						>
							<LogOutIcon data-icon="inline-start" />
							Sign out
						</Button>
					) : null}
					{!signedIn && !profileFailed && !showDeviceAuth && !initialLoading ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={auth.connectionUnavailable}
							onClick={() => auth.signIn()}
							data-qa-id="kilo-account-login"
						>
							<LogInIcon data-icon="inline-start" />
							Sign in
						</Button>
					) : null}
				</SummaryCard.Actions>
			</SummaryCard.Row>

			{initialLoading && connected ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountLoadingState showSignOut={false} />
				</div>
			) : null}
			{showAccountDetails ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountPanel showSignOut={false} />
				</div>
			) : null}
		</div>
	);
}

function gatewayDescription(input: {
	unavailableMessage: string | undefined;
	showDeviceAuth: boolean;
	signedIn: boolean;
	profileFailed: boolean;
	email: string | undefined;
}): string {
	if (input.unavailableMessage) return input.unavailableMessage;
	if (input.showDeviceAuth) return "Finish connecting your Kilo account.";
	if (input.profileFailed) return "Your account is connected, but its profile could not be loaded.";
	if (input.signedIn) return input.email ?? "Your Kilo account is connected.";
	return "One gateway to every model and provider";
}
