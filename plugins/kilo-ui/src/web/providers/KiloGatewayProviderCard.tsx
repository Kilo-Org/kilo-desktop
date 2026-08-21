import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { KiloGatewayAccountPanel } from "../account/KiloGatewayAccountPanel.js";
import { useKiloAuth } from "../account/KiloAuthContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { PROVIDER_ROW_GRID } from "./provider-row-layout.js";

/**
 * Always-visible expandable card for Kilo Gateway account. Lives above the
 * Connected / Popular lists — not a catalog row — because Desktop owns Kilo.
 */
export function KiloGatewayProviderCard() {
	const auth = useKiloAuth();
	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const signedIn = auth.authenticated === true && Boolean(auth.profile);
	const profileFailed = auth.authenticated === true && !auth.profile && Boolean(auth.profileError);
	const preferExpanded = showDeviceAuth || profileFailed || auth.isLoading;
	const showDisconnect = signedIn || profileFailed;
	const showConnect =
		!signedIn &&
		!profileFailed &&
		!showDeviceAuth &&
		!auth.isLoading &&
		!auth.connectionUnavailable &&
		auth.authenticated === false;

	const [userOpen, setUserOpen] = useState(false);
	const open = preferExpanded || userOpen;

	const status = gatewayStatusLabel({
		isLoading: auth.isLoading && !showDeviceAuth,
		connectionUnavailable: auth.connectionUnavailable,
		showDeviceAuth,
		signedIn,
		profileFailed,
		email: auth.profile?.profile.email,
	});

	return (
		<Collapsible
			open={open}
			onOpenChange={setUserOpen}
			className="border-border bg-card min-w-0 overflow-hidden rounded-xl border"
			data-qa-id="kilo-providers-row-kilo"
			data-state={open ? "expanded" : "collapsed"}
		>
			<div className={cn(PROVIDER_ROW_GRID, "p-3")}>
				<CollapsibleTrigger
					type="button"
					className="hover:bg-foreground/5 col-span-2 flex min-w-0 items-center gap-3 rounded-lg p-1 text-left transition-colors"
					data-qa-id="kilo-providers-kilo-toggle"
				>
					<ProviderIcon provider="kilo" variant="color" size={22} fallbackLabel="Kilo Gateway" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium">Kilo Gateway</p>
						{status ? (
							<p
								className="text-muted-foreground truncate text-xs"
								{...(signedIn && auth.profile?.profile.email
									? { "data-qa-id": "kilo-account-email" }
									: {})}
							>
								{status}
							</p>
						) : null}
					</div>
				</CollapsibleTrigger>
				<div />
				<div className="flex justify-center">
					{showDisconnect ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => auth.logout()}
							data-qa-id="kilo-account-logout"
						>
							Disconnect
						</Button>
					) : null}
					{showConnect && !open ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => auth.login()}
							data-qa-id="kilo-account-login"
						>
							Connect
						</Button>
					) : null}
				</div>
				<div className="flex justify-center">
					<CollapsibleTrigger
						type="button"
						className="hover:bg-foreground/5 text-muted-foreground rounded-lg p-1.5 transition-colors"
						aria-label={open ? "Collapse Kilo Gateway" : "Expand Kilo Gateway"}
					>
						<ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
					</CollapsibleTrigger>
				</div>
			</div>
			<CollapsibleContent className="px-4 pb-4">
				<KiloGatewayAccountPanel showSignOut={false} />
			</CollapsibleContent>
		</Collapsible>
	);
}

function gatewayStatusLabel(input: {
	isLoading: boolean;
	connectionUnavailable: boolean;
	showDeviceAuth: boolean;
	signedIn: boolean;
	profileFailed: boolean;
	email: string | undefined;
}): string | undefined {
	if (input.connectionUnavailable) return "Unavailable in browser";
	if (input.isLoading) return "Checking account…";
	if (input.showDeviceAuth) return "Connecting…";
	if (input.profileFailed) return "Couldn't load account";
	if (input.signedIn) return input.email ?? "Connected";
	return "Connect to use Kilo models";
}
