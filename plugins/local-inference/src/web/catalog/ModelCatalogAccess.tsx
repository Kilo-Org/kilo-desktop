import { LogInIcon } from "lucide-react";
import { useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@kilo-desktop/ui/components/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import type { LocalInferenceServiceContract } from "../../contracts/schemas.js";

export function ModelCatalogDialogHeader() {
	return (
		<DialogHeader className="gap-0.5 px-4 pt-4 pr-3 pb-6 text-left">
			<DialogTitle className="text-base leading-tight">Local Model Catalog</DialogTitle>
			<DialogDescription className="text-sm leading-tight">
				Browse models from Anaconda and add them to your local model server.
			</DialogDescription>
		</DialogHeader>
	);
}

export function ModelCatalogSignInGate({ reason }: { reason: string | undefined }) {
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const [loginError, setLoginError] = useState<string>();
	const errorMessage = loginError ?? reason;

	const login = async (): Promise<void> => {
		setLoginError(undefined);
		try {
			const next = await sdk.auth.login();
			if (next.status === "error") {
				setLoginError(next.reason);
				return;
			}
			if (next.status === "authenticated") {
				void sdk.telemetry.track({ event: "LOGGED_IN" });
			}
		} catch (error) {
			setLoginError(error instanceof Error ? error.message : String(error));
		}
	};

	return (
		<Empty className="min-h-0" data-qa-id="model-catalog-sign-in">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LogInIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>Sign in to browse models</EmptyTitle>
				<EmptyDescription>
					Sign in to your Anaconda account to view and download models from the catalog.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button type="button" data-qa-id="model-catalog-login" onClick={() => void login()}>
					<LogInIcon data-icon="inline-start" aria-hidden="true" />
					Sign in with Anaconda
				</Button>
				{errorMessage ? (
					<p className="text-destructive text-sm" role="alert">
						{errorMessage}
					</p>
				) : null}
			</EmptyContent>
		</Empty>
	);
}
