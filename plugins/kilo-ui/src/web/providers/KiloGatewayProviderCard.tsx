import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";

import { KiloGatewayAccountPanel } from "../account/KiloGatewayAccountPanel.js";
import { useKiloAuth } from "../account/KiloAuthContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";

/**
 * Kilo is the default provider path, so this surface presents it as a single
 * decisive connection rather than another row in a provider table. Once
 * connected, account context and billing actions live directly beneath the
 * provider summary so the card remains the single place to manage Kilo.
 */
export function KiloGatewayProviderCard() {
	const auth = useKiloAuth();
	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const connected = auth.authenticated === true;
	const signedIn = connected && Boolean(auth.profile);
	const profileFailed = auth.authenticated === true && !auth.profile && Boolean(auth.profileError);
	const showRecovery = showDeviceAuth || profileFailed;
	const showAccountDetails = connected || showRecovery;
	const initialLoading = auth.isLoading && !showDeviceAuth && !auth.profile;
	const email = auth.profile?.profile.email;

	return (
		<section
			className="border-border bg-card min-w-0 overflow-hidden rounded-xl border"
			data-qa-id="kilo-providers-row-kilo"
			data-state={showAccountDetails ? "expanded" : "summary"}
		>
			<div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<div className="border-border bg-background flex size-10 shrink-0 items-center justify-center rounded-lg border">
						<ProviderIcon provider="kilo" variant="color" size={22} fallbackLabel="Kilo Gateway" />
					</div>
					<div className="min-w-0">
						<h2 className="text-base font-semibold tracking-tight">Kilo Gateway</h2>
						{initialLoading ? (
							<Skeleton className="mt-1.5 h-3.5 w-48" />
						) : (
							<p
								className="text-muted-foreground mt-0.5 max-w-md text-sm"
								{...(signedIn && email ? { "data-qa-id": "kilo-account-email" } : {})}
							>
								{gatewayDescription({
									connectionUnavailable: auth.connectionUnavailable,
									showDeviceAuth,
									signedIn,
									profileFailed,
									email,
								})}
							</p>
						)}
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2 pl-13 sm:pl-0">
					{initialLoading && connected ? <Skeleton className="h-7 w-20 rounded-lg" /> : null}
					{signedIn ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => auth.logout()}
							data-qa-id="kilo-account-logout"
						>
							Log Out
						</Button>
					) : null}
					{!signedIn && !profileFailed && !showDeviceAuth && !initialLoading ? (
						<Button
							type="button"
							size="sm"
							disabled={auth.connectionUnavailable}
							onClick={() => auth.login()}
							data-qa-id="kilo-account-login"
						>
							Sign In
						</Button>
					) : null}
				</div>
			</div>

			{showAccountDetails ? (
				<>
					<Separator />
					<div className="bg-background/60 p-4">
						<KiloGatewayAccountPanel showSignOut={profileFailed} />
					</div>
				</>
			) : null}
		</section>
	);
}

function gatewayDescription(input: {
	connectionUnavailable: boolean;
	showDeviceAuth: boolean;
	signedIn: boolean;
	profileFailed: boolean;
	email: string | undefined;
}): string {
	if (input.connectionUnavailable) return "Available in the desktop app.";
	if (input.showDeviceAuth) return "Finish connecting your Kilo account.";
	if (input.profileFailed) return "Your account is connected, but its profile could not be loaded.";
	if (input.signedIn) return input.email ?? "Your Kilo account is connected.";
	return "One gateway to every model and provider.";
}
