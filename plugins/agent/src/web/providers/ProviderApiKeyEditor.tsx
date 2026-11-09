import { useEffect, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { useDomain } from "@kilo-desktop/kernel/web";

import { AgentConfig } from "../../contracts";

import { ProviderApiKeyForm } from "./ProviderConnectDialog";
import type { ProviderRow } from "./provider-list";

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
	const config = useDomain(AgentConfig);
	const [storedKey, setStoredKey] = useState<string | undefined>(undefined);
	const loading = storedKey === undefined;

	useEffect(() => {
		if (!config) return;
		let cancelled = false;
		void config.methods.storedApiKey({ providerId: provider.id }).then(
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
	}, [config, provider.id]);

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
