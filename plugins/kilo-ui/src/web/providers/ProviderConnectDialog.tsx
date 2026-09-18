import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";

import { ApiKeyField } from "./ApiKeyField.js";

type ProviderConnectFormProps = {
	providerName: string;
	pending: boolean;
	error: string | null;
	stepIndicator: ReactNode;
	onBack: () => void;
	onSubmit(apiKey: string): Promise<void>;
};

type ProviderApiKeyFormProps = {
	title: string;
	description: string;
	pending: boolean;
	error: string | null;
	secondaryAction: ReactNode;
	submitLabel: string;
	pendingLabel: string;
	inputQaId: string;
	submitQaId: string;
	initialApiKey?: string;
	onSubmit(apiKey: string): Promise<void>;
};

export function ProviderApiKeyForm({
	title,
	description,
	pending,
	error,
	secondaryAction,
	submitLabel,
	pendingLabel,
	inputQaId,
	submitQaId,
	initialApiKey = "",
	onSubmit,
}: ProviderApiKeyFormProps) {
	const [apiKey, setApiKey] = useState(initialApiKey);
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
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={Boolean(localError || error) || undefined}>
					<FieldLabel htmlFor="kilo-provider-api-key">API key</FieldLabel>
					<ApiKeyField
						id="kilo-provider-api-key"
						invalid={Boolean(localError || error)}
						value={apiKey}
						onChange={setApiKey}
						qaId={inputQaId}
					/>
					{localError || error ? <FieldError>{localError ?? error}</FieldError> : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				{secondaryAction}
				<Button type="submit" disabled={pending} data-qa-id={submitQaId}>
					{pending ? pendingLabel : submitLabel}
				</Button>
			</DialogFooter>
		</form>
	);
}

export function ProviderConnectForm({
	providerName,
	pending,
	error,
	stepIndicator,
	onBack,
	onSubmit,
}: ProviderConnectFormProps) {
	return (
		<>
			{stepIndicator}
			<ProviderApiKeyForm
				title={`Add ${providerName}`}
				description="Enter the API key to add this provider."
				pending={pending}
				error={error}
				secondaryAction={
					<Button type="button" variant="outline" disabled={pending} onClick={onBack}>
						Back
					</Button>
				}
				submitLabel="Add AI Provider"
				pendingLabel="Adding…"
				inputQaId="kilo-providers-api-key"
				submitQaId="kilo-providers-connect"
				onSubmit={onSubmit}
			/>
		</>
	);
}
