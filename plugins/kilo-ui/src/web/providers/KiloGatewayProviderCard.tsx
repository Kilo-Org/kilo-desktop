import { useState } from "react";
import { LogOutIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { SummaryCard } from "@anaconda-agentic-desktop/ui/components/summary-card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { KiloGatewayAccountPanel } from "../account/KiloGatewayAccountPanel.js";
import { useKiloAuth } from "../account/KiloAuthContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";

/**
 * Kilo is the default provider path, but its summary follows the same inventory
 * row hierarchy as every other provider. Account and billing details stay
 * available on demand without dominating the provider overview.
 */
export function KiloGatewayProviderDisclosure() {
	const auth = useKiloAuth();
	const [detailsOpen, setDetailsOpen] = useState(false);
	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const connected = auth.authenticated === true;
	const signedIn = connected && Boolean(auth.profile);
	const profileFailed = auth.authenticated === true && !auth.profile && Boolean(auth.profileError);
	const showRecovery = showDeviceAuth || profileFailed;
	const canToggleDetails = signedIn || showRecovery;
	const showAccountDetails = showRecovery || (signedIn && detailsOpen);
	const initialLoading = auth.isLoading && !showDeviceAuth && !auth.profile;
	const email = auth.profile?.profile.email;
	return (
		<TooltipProvider>
			<Collapsible
				className="min-w-0"
				open={showAccountDetails}
				onOpenChange={(open) => {
					if (canToggleDetails) setDetailsOpen(open);
				}}
				data-qa-id="kilo-providers-row-kilo"
				data-state={showAccountDetails ? "expanded" : "summary"}
			>
				<SummaryCard.Row>
					<SummaryCard.Trigger
						type="button"
						disabled={!canToggleDetails}
						aria-label="Toggle Kilo Gateway details"
						data-qa-id="kilo-provider-row-trigger"
					>
						<SummaryCard.Icon>
							<ProviderIcon
								provider="kilo"
								variant="color"
								size={18}
								fallbackLabel="Kilo Gateway"
							/>
						</SummaryCard.Icon>
						<SummaryCard.Content>
							<SummaryCard.Title>Kilo Gateway</SummaryCard.Title>
							{initialLoading ? (
								<Skeleton className="mt-1 h-3.5 w-48" />
							) : (
								<SummaryCard.Description
									{...(signedIn && email ? { "data-qa-id": "kilo-account-email" } : {})}
								>
									{gatewayDescription({
										connectionUnavailable: auth.connectionUnavailable,
										showDeviceAuth,
										signedIn,
										profileFailed,
										email,
									})}
								</SummaryCard.Description>
							)}
						</SummaryCard.Content>
					</SummaryCard.Trigger>
					<SummaryCard.Actions className="gap-1" data-qa-id="kilo-provider-header-actions">
						{initialLoading && connected ? <Skeleton className="size-8 rounded-lg" /> : null}
						{connected && !initialLoading && showAccountDetails ? (
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label="Sign Out"
											onClick={auth.logout}
											data-qa-id="kilo-account-logout"
										/>
									}
								>
									<LogOutIcon />
								</TooltipTrigger>
								<TooltipContent>Sign out of Kilo Gateway.</TooltipContent>
							</Tooltip>
						) : null}
						{signedIn ? (
							<SummaryCard.Toggle
								label="Toggle Kilo Gateway details"
								open={showAccountDetails}
								data-qa-id="kilo-provider-toggle"
							/>
						) : null}
						{!signedIn && !profileFailed && !showDeviceAuth && !initialLoading ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={auth.connectionUnavailable}
								onClick={() => auth.login()}
								data-qa-id="kilo-account-login"
							>
								Sign In
							</Button>
						) : null}
					</SummaryCard.Actions>
				</SummaryCard.Row>

				<CollapsibleContent>
					<div className="border-border bg-background/60 border-t p-4">
						<KiloGatewayAccountPanel showSignOut={false} />
					</div>
				</CollapsibleContent>
			</Collapsible>
		</TooltipProvider>
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
	return "One gateway to every model and provider";
}
