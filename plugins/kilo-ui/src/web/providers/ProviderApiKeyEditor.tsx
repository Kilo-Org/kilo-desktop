import { useEffect, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { useSdk } from "@kilo-desktop/sdk-react";

import { ProviderApiKeyForm } from "./ProviderConnectDialog.js";
import type { ProviderRow } from "./provider-list.js";

function storedApiKeyValue(value: unknown): string {
	if (!value || typeof value !== "object" || !("key" in value)) return "";
	return typeof value.key === "string" ? value.key : "";
}

/** Inline editor for a catalog provider's stored API key, shown in its expanded row. */
export function ProviderApiKeyEditor({
	provider,
	pending,
	error,
	onCancel,
	onSubmit,
}: {
	provider: ProviderRow;
	pending: boolean;
	error: string | null;
	onCancel(): void;
	onSubmit(apiKey: string): Promise<void>;
}) {
	const sdk = useSdk("kilo-ui");
	const [storedKey, setStoredKey] = useState<string | undefined>(undefined);
	const loading = storedKey === undefined;

	useEffect(() => {
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
	}, [provider.id, sdk]);

	return (
		<ProviderApiKeyForm
			key={loading ? "loading" : "ready"}
			layout="inline"
			title={`Edit ${provider.name}`}
			description="View or replace the stored API key."
			loading={loading}
			pending={pending}
			error={error}
			initialApiKey={storedKey ?? ""}
			secondaryAction={
				<Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
					Cancel
				</Button>
			}
			submitLabel="Save key"
			pendingLabel="Saving…"
			inputQaId="kilo-providers-edit-api-key"
			submitQaId="kilo-providers-edit-save"
			onSubmit={onSubmit}
		/>
	);
}
