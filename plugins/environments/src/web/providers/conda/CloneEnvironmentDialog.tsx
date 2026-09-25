import { useState, type FormEvent } from "react";

import { useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import type { CondaEnv, CondaService } from "../../../contracts/providers/conda.js";
import { environmentDisplayName, validateEnvironmentName } from "./environment-display.js";
import { friendlyEnvironmentsError } from "./environments-error-message.js";

interface CloneEnvironmentDialogProps {
	env: CondaEnv;
	open: boolean;
	onClose: () => void;
}

export function CloneEnvironmentDialog({ env, open, onClose }: CloneEnvironmentDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const sourceName = environmentDisplayName(env);
	const [name, setName] = useState(`${env.name || sourceName}-copy`);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);

	const mutation = useSdkMutation(sdk, "conda.envs.clone", {
		invalidates: ["conda.envs.list"],
	});

	function validate(): boolean {
		const nameError = validateEnvironmentName(name);
		if (nameError) {
			setValidationError(nameError);
			return false;
		}
		setValidationError(null);
		return true;
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!validate()) return;
		if (!env.name) {
			setServerError("Cannot clone a prefix-only environment by name.");
			return;
		}

		setServerError(null);
		mutation.mutate(
			{ sourceName: env.name, sourcePrefix: env.prefix, name: name.trim() },
			{
				onSuccess: () => onClose(),
				onError: (reason) =>
					setServerError(friendlyEnvironmentsError(reason, "Could not clone environment.")),
			},
		);
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) onClose();
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent data-qa-id="environments-clone-dialog" className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Clone {sourceName}</DialogTitle>
					<DialogDescription>
						Create a new environment with the same packages as {sourceName}.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<Field data-invalid={validationError ? true : undefined}>
						<FieldLabel htmlFor="environments-clone-name">New name</FieldLabel>
						<Input
							id="environments-clone-name"
							value={name}
							aria-invalid={validationError ? true : undefined}
							onChange={(e) => setName(e.target.value)}
							autoFocus
							data-qa-id="environments-clone-name"
						/>
						{validationError ? <FieldError>{validationError}</FieldError> : null}
					</Field>

					{serverError ? <FieldError>{serverError}</FieldError> : null}

					<DialogFooter>
						<DialogClose render={<Button variant="outline" disabled={mutation.isPending} />}>
							Cancel
						</DialogClose>
						<Button
							type="submit"
							disabled={mutation.isPending}
							data-qa-id="environments-clone-submit"
						>
							{mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{mutation.isPending ? "Cloning…" : "Clone"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
