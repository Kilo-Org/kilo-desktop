import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";

import { ApiKeyField } from "./ApiKeyField";

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
	placeholder?: string;
	/**
	 * `dialog` renders a dialog header and footer; `inline` renders bare fields
	 * and actions for an expanded settings row, omitting the title.
	 */
	layout?: "dialog" | "inline";
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
	placeholder,
	layout = "dialog",
	onSubmit,
}: ProviderApiKeyFormProps) {
	// Several inline editors can be expanded at once, so the input id must be unique per form.
	const inputId = useId();
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

	const inline = layout === "inline";
	const actions = (
		<>
			{secondaryAction}
			<Button type="submit" disabled={pending} data-qa-id={submitQaId}>
				{pending ? pendingLabel : submitLabel}
			</Button>
		</>
	);

	return (
		<form onSubmit={submit} className={inline ? "flex min-w-0 flex-col gap-4" : "contents"}>
			{inline ? null : (
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
			)}
			<FieldGroup>
				<Field data-invalid={Boolean(localError || error) || undefined}>
					<FieldLabel htmlFor={inputId}>API key</FieldLabel>
					<ApiKeyField
						id={inputId}
						invalid={Boolean(localError || error)}
						value={apiKey}
						onChange={setApiKey}
						qaId={inputQaId}
						{...(placeholder ? { placeholder } : {})}
					/>
					{inline ? <FieldDescription>{description}</FieldDescription> : null}
					{localError || error ? <FieldError>{localError ?? error}</FieldError> : null}
				</Field>
			</FieldGroup>
			{inline ? (
				<div className="flex justify-end gap-2">{actions}</div>
			) : (
				<DialogFooter>{actions}</DialogFooter>
			)}
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
		<ProviderApiKeyForm
			title={`Add ${providerName}`}
			description="Enter the API key to add this provider."
			pending={pending}
			error={error}
			secondaryAction={
				<>
					{stepIndicator}
					<Button type="button" variant="outline" disabled={pending} onClick={onBack}>
						Back
					</Button>
				</>
			}
			submitLabel="Add AI Provider"
			pendingLabel="Adding…"
			inputQaId="kilo-providers-api-key"
			submitQaId="kilo-providers-connect"
			onSubmit={onSubmit}
		/>
	);
}
