import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";

type ProviderConnectFormProps = {
	providerName: string;
	pending: boolean;
	error: string | null;
	stepIndicator: ReactNode;
	onBack: () => void;
	onSubmit(apiKey: string): Promise<void>;
};

export function ProviderConnectForm({
	providerName,
	pending,
	error,
	stepIndicator,
	onBack,
	onSubmit,
}: ProviderConnectFormProps) {
	const [apiKey, setApiKey] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const key = apiKey.trim();
		if (!key) {
			setLocalError("API key is required");
			return;
		}
		setLocalError(null);
		void onSubmit(key);
	};

	return (
		<form onSubmit={submit} className="contents">
			{stepIndicator}
			<DialogHeader>
				<DialogTitle>{`Connect ${providerName}`}</DialogTitle>
				<DialogDescription>Enter the API key to connect this provider.</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={Boolean(localError || error) || undefined}>
					<FieldLabel htmlFor="kilo-provider-api-key">API key</FieldLabel>
					<Input
						id="kilo-provider-api-key"
						type="password"
						autoComplete="off"
						aria-invalid={Boolean(localError || error) || undefined}
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						data-qa-id="kilo-providers-api-key"
					/>
					{localError || error ? <FieldError>{localError ?? error}</FieldError> : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<Button type="button" variant="outline" disabled={pending} onClick={onBack}>
					Back
				</Button>
				<Button type="submit" disabled={pending} data-qa-id="kilo-providers-connect">
					{pending ? "Connecting…" : "Connect provider"}
				</Button>
			</DialogFooter>
		</form>
	);
}
