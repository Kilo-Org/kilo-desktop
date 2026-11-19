import { useState, type FormEvent } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
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
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";

import {
	TERMINAL_PROFILE_SOURCE_LABELS,
	TERMINAL_PROFILE_SOURCES,
	type CustomTerminalProfile,
	type TerminalProfileSource,
} from "../contracts/profiles.js";
import { parseProfileDraft, type ProfileDraft, type ProfileDraftField } from "./profile-draft.js";

const SOURCE_ITEMS = TERMINAL_PROFILE_SOURCES.map((source) => ({
	value: source,
	label: TERMINAL_PROFILE_SOURCE_LABELS[source],
}));

interface CustomProfileFormProps {
	readonly title: string;
	readonly initialDraft: ProfileDraft;
	readonly pending: boolean;
	readonly onCancel: () => void;
	readonly onSave: (profile: CustomTerminalProfile) => void;
}

/**
 * Adds or edits one custom profile in a dialog. Edits stay in a local draft;
 * only Save hands the profile on. The parent mounts it only while open, so the
 * draft starts fresh each time. A field's error shows once it has been edited.
 */
export function CustomProfileForm({
	title,
	initialDraft,
	pending,
	onCancel,
	onSave,
}: CustomProfileFormProps) {
	const [draft, setDraft] = useState(initialDraft);
	const [touched, setTouched] = useState<ReadonlySet<ProfileDraftField>>(() => new Set());
	const parsed = parseProfileDraft(draft);
	const errorFor = (field: ProfileDraftField) =>
		!parsed.ok && touched.has(field) ? parsed.errors[field] : undefined;
	const edit = (field: ProfileDraftField, patch: Partial<ProfileDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		setTouched((current) => new Set(current).add(field));
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (parsed.ok && !pending) onSave(parsed.profile);
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
			<DialogContent data-qa-id="terminal-profile-dialog" className="sm:max-w-lg">
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							New terminals can start this shell once it's the default.
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<TextField
							id="terminal-profile-label"
							label="Name"
							value={draft.label}
							error={errorFor("label")}
							onChange={(label) => edit("label", { label })}
						/>
						<Field>
							<FieldLabel>Shell</FieldLabel>
							<ToggleGroup
								variant="outline"
								spacing={0}
								value={[draft.kind]}
								onValueChange={(value: unknown[]) => {
									const kind = value[0];
									if (kind === "executable" || kind === "source") edit("source", { kind });
								}}
							>
								<ToggleGroupItem value="executable" data-qa-id="terminal-profile-kind-executable">
									Executable
								</ToggleGroupItem>
								<ToggleGroupItem value="source" data-qa-id="terminal-profile-kind-source">
									Detected shell
								</ToggleGroupItem>
							</ToggleGroup>
						</Field>
						{draft.kind === "executable" ? (
							<TextField
								id="terminal-profile-path"
								label="Path"
								description="An absolute path, or a name found on PATH (like fish or pwsh)."
								value={draft.path}
								error={errorFor("path")}
								onChange={(path) => edit("path", { path })}
							/>
						) : (
							<Field>
								<FieldLabel htmlFor="terminal-profile-source">Detected shell</FieldLabel>
								<Select
									value={draft.source}
									items={SOURCE_ITEMS}
									onValueChange={(source) => {
										if (source) edit("source", { source: source as TerminalProfileSource });
									}}
								>
									<SelectTrigger
										id="terminal-profile-source"
										className="w-full"
										data-qa-id="terminal-profile-source"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{SOURCE_ITEMS.map((item) => (
												<SelectItem
													key={item.value}
													value={item.value}
													data-qa-id={`terminal-profile-source-${item.value}`}
												>
													{item.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								<FieldDescription>Uses the best install found on this computer.</FieldDescription>
							</Field>
						)}
						<TextField
							id="terminal-profile-args"
							label="Arguments"
							description="One per line."
							multiline
							value={draft.args}
							error={errorFor("args")}
							onChange={(args) => edit("args", { args })}
						/>
						<TextField
							id="terminal-profile-env"
							label="Environment"
							description="One NAME=value per line; NAME= unsets it."
							multiline
							value={draft.env}
							error={errorFor("env")}
							onChange={(env) => edit("env", { env })}
						/>
					</FieldGroup>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onCancel}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!parsed.ok || pending}
							data-qa-id="terminal-profile-save"
						>
							{pending ? <Spinner data-icon="inline-start" /> : null}
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface TextFieldProps {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly multiline?: boolean;
	readonly value: string;
	readonly error: string | undefined;
	readonly onChange: (value: string) => void;
}

function TextField({ id, label, description, multiline, value, error, onChange }: TextFieldProps) {
	const invalid = error ? true : undefined;
	const control = {
		id,
		value,
		"aria-invalid": invalid,
		"data-qa-id": id,
		spellCheck: false,
	};
	return (
		<Field data-invalid={invalid}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{multiline ? (
				<Textarea {...control} rows={3} onChange={(event) => onChange(event.target.value)} />
			) : (
				<Input {...control} onChange={(event) => onChange(event.target.value)} />
			)}
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}
