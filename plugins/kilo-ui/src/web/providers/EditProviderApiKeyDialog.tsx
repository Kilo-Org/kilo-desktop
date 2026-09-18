import { useEffect, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { useSdk } from "@kilo-desktop/sdk-react";

import { ProviderApiKeyForm } from "./ProviderConnectDialog.js";
import type { ProviderRow } from "./provider-list.js";

function storedApiKeyValue(value: unknown): string {
	if (!value || typeof value !== "object" || !("key" in value)) return "";
	return typeof value.key === "string" ? value.key : "";
}

export function EditProviderApiKeyDialog({
	open,
	provider,
	pending,
	error,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	provider: ProviderRow | null;
	pending: boolean;
	error: string | null;
	onOpenChange(open: boolean): void;
	onSubmit(apiKey: string): Promise<void>;
}) {
	const sdk = useSdk("kilo-ui");
	const [storedKey, setStoredKey] = useState<string | undefined>(undefined);
	const title = `Edit ${provider?.name ?? "provider"}`;

	useEffect(() => {
		if (!open || !provider) {
			setStoredKey(undefined);
			return;
		}
		let cancelled = false;
		void sdk.invoke("providers.getApiKey", { providerID: provider.id }).then(
			(result) => {
				if (!cancelled) setStoredKey(storedApiKeyValue(result));
			},
			() => {
				if (!cancelled) setStoredKey("");
			},
		);
		return () => {
			cancelled = true;
		};
	}, [open, provider, sdk]);

	return (
		<Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
			<DialogContent data-qa-id="kilo-providers-edit-dialog" className="sm:max-w-md">
				{storedKey === undefined ? (
					<>
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription>Loading the stored API key…</DialogDescription>
						</DialogHeader>
						<Skeleton className="h-9 w-full" data-qa-id="kilo-providers-edit-loading" />
					</>
				) : (
					<ProviderApiKeyForm
						title={title}
						description="View or replace the stored API key."
						pending={pending}
						error={error}
						initialApiKey={storedKey}
						secondaryAction={
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => onOpenChange(false)}
							>
								Cancel
							</Button>
						}
						submitLabel="Save key"
						pendingLabel="Saving…"
						inputQaId="kilo-providers-edit-api-key"
						submitQaId="kilo-providers-edit-save"
						onSubmit={onSubmit}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
