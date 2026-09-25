import { CircleCheckIcon } from "lucide-react";

import {
	Item,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { DeviceAuthPanel } from "../account/DeviceAuthPanel.js";
import type { KiloAuthContextValue } from "../account/KiloAuthContext.js";
import { KiloSignInCard } from "../account/KiloSignInCard.js";

export function SignInStep({
	auth,
	onCopy,
}: {
	auth: KiloAuthContextValue;
	onCopy: (text: string) => void;
}) {
	if (auth.deviceAuth.status !== "idle") {
		return (
			<DeviceAuthPanel
				deviceAuth={auth.deviceAuth}
				onCancel={auth.cancelLogin}
				onRetry={auth.login}
				onOpenBrowser={auth.openExternal}
				onCopy={onCopy}
			/>
		);
	}

	if (auth.authenticated === null) {
		return (
			<Item variant="outline" data-qa-id="onboarding-connecting">
				<ItemMedia variant="icon">
					<Spinner className="text-muted-foreground" />
				</ItemMedia>
				<ItemContent>
					<ItemDescription>Connecting to Kilo…</ItemDescription>
				</ItemContent>
			</Item>
		);
	}

	if (auth.authenticated === true) {
		const name = auth.profile?.profile.name ?? auth.profile?.profile.email ?? "Kilo";
		return (
			<Item variant="outline" data-qa-id="onboarding-signed-in">
				<ItemMedia variant="icon" className="text-success">
					<CircleCheckIcon aria-hidden="true" />
				</ItemMedia>
				<ItemContent className="min-w-0">
					<ItemTitle>Connected as {name}</ItemTitle>
					<ItemDescription>Continue to create your first workspace.</ItemDescription>
				</ItemContent>
			</Item>
		);
	}

	return <KiloSignInCard onLogin={auth.login} />;
}
