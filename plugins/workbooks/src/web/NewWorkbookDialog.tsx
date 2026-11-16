import { useState, type FormEvent } from "react";

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
import { Field, FieldDescription, FieldError, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import { RadioGroup, RadioGroupItem } from "@kilo-desktop/ui/components/radio-group";

import type { TemplateSummary } from "../contracts";

/**
 * Creates a workbook from a template: pick the template (radio cards, as
 * onboarding's work style), name the workbook and fill in its Brief, whose
 * fields follow the template picked (only the template's required fields must be given;
 * the first agent asks about the rest). Stays open, showing why, when the
 * workbook can't be created.
 */
export function NewWorkbookDialog({
	templates,
	busy,
	error,
	onCreate,
	onClose,
}: {
	readonly templates: readonly TemplateSummary[];
	readonly busy: boolean;
	readonly error: string | null;
	readonly onCreate: (templateId: string, name: string, values: Record<string, string>) => void;
	readonly onClose: () => void;
}) {
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [name, setName] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const template = templates.find((candidate) => candidate.id === templateId) ?? templates[0];
	const missing =
		!template || template.fields.some((field) => field.required && !values[field.id]?.trim());

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (template && !missing && name.trim()) onCreate(template.id, name.trim(), values);
	};

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent data-qa-id="workbooks-new-dialog" className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New workbook</DialogTitle>
					<DialogDescription>
						A workbook keeps what your chats learn and decide about this work, so each new chat
						starts from it instead of from pasted text.
					</DialogDescription>
				</DialogHeader>
				{template ? (
					<form onSubmit={submit} className="flex flex-col gap-4" data-qa-id="workbooks-new-form">
						<Field>
							<FieldLabel id="workbooks-template-label">Template</FieldLabel>
							<RadioGroup
								aria-labelledby="workbooks-template-label"
								value={template.id}
								onValueChange={(next) => setTemplateId(String(next))}
								disabled={busy}
								className="grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]"
							>
								{templates.map((candidate) => (
									<label
										key={candidate.id}
										data-qa-id={`workbooks-template-${candidate.id}`}
										className="bg-foreground/5 hover:bg-foreground/8 has-data-checked:ring-primary-ink flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-transparent transition-[background-color,box-shadow] has-disabled:cursor-not-allowed has-disabled:opacity-60"
									>
										<RadioGroupItem value={candidate.id} className="bg-background mt-0.5" />
										<span className="flex min-w-0 flex-col gap-0.5">
											<span className="text-sm font-medium">{candidate.name}</span>
											<span className="text-muted-foreground text-xs">{candidate.description}</span>
										</span>
									</label>
								))}
							</RadioGroup>
						</Field>
						<Field>
							<FieldLabel htmlFor="workbooks-name">Name</FieldLabel>
							<Input
								id="workbooks-name"
								value={name}
								autoFocus
								placeholder="e.g. Fix the bug in the Kilo server"
								data-qa-id="workbooks-name"
								onChange={(event) => setName(event.target.value)}
							/>
						</Field>
						{template.fields.map((field) => (
							<Field key={field.id}>
								<FieldLabel htmlFor={`workbooks-field-${field.id}`}>
									{field.label}
									{field.required ? null : (
										<span className="text-muted-foreground font-normal">(optional)</span>
									)}
								</FieldLabel>
								<Textarea
									id={`workbooks-field-${field.id}`}
									rows={field.required ? 3 : 2}
									value={values[field.id] ?? ""}
									data-qa-id={`workbooks-field-${field.id}`}
									onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
								/>
								{field.hint ? <FieldDescription>{field.hint}</FieldDescription> : null}
							</Field>
						))}
						{error ? <FieldError data-qa-id="workbooks-start-error">{error}</FieldError> : null}
						<DialogFooter>
							<DialogClose render={<Button variant="outline" disabled={busy} />}>
								Cancel
							</DialogClose>
							<Button
								type="submit"
								disabled={busy || missing || !name.trim()}
								data-qa-id="workbooks-create"
							>
								{busy ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
								{busy ? "Creating…" : "Create and start"}
							</Button>
						</DialogFooter>
					</form>
				) : (
					<p className="text-muted-foreground text-sm">No workbook templates are available.</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
