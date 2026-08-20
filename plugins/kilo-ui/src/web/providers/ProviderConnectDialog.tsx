import { useState, type FormEvent } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
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

type ProviderConnectDialogProps = {
	open: boolean;
	providerName: string;
	pending: boolean;
	error: string | null;
	onOpenChange(open: boolean): void;
	onSubmit(apiKey: string): Promise<void>;
};

export function ProviderConnectDialog({
	open,
	providerName,
	pending,
	error,
	onOpenChange,
	onSubmit,
}: ProviderConnectDialogProps) {
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
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setApiKey("");
					setLocalError(null);
				}
				onOpenChange(next);
			}}
		>
			<DialogContent data-qa-id="kilo-providers-connect-dialog" className="sm:max-w-md">
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>Connect {providerName}</DialogTitle>
					</DialogHeader>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="kilo-provider-api-key">API key</FieldLabel>
							<Input
								id="kilo-provider-api-key"
								type="password"
								autoComplete="off"
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								data-qa-id="kilo-providers-api-key"
							/>
							{localError || error ? <FieldError>{localError ?? error}</FieldError> : null}
						</Field>
					</FieldGroup>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={pending} data-qa-id="kilo-providers-connect">
							{pending ? "Connecting…" : "Connect"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
