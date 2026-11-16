import type { AiProvider } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";

import { ProviderApiKeyForm } from "./ProviderConnectDialog";

/**
 * Inline editor for a catalog provider's API key, shown in its expanded row.
 * The stored key never leaves kilo.core, so the field starts empty and saving
 * replaces it.
 */
export function ProviderApiKeyEditor({
	provider,
	pending,
	error,
	onCancel,
	onSubmit,
}: {
	provider: AiProvider;
	pending: boolean;
	error: string | null;
	onCancel(): void;
	onSubmit(apiKey: string): Promise<void>;
}) {
	return (
		<ProviderApiKeyForm
			layout="inline"
			title={`Edit ${provider.name}`}
			description="Replace the stored API key."
			placeholder="Enter a new API key"
			pending={pending}
			error={error}
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
