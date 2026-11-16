import { ChevronDownIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
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
import { Separator } from "@kilo-desktop/ui/components/separator";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import { RadioGroup, RadioGroupItem } from "@kilo-desktop/ui/components/radio-group";

import type { BriefField, TemplateSummary } from "../contracts";

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
			<DialogContent
				data-qa-id="workbooks-new-dialog"
				className="max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg"
			>
				<DialogHeader>
					<DialogTitle>New workbook</DialogTitle>
					<DialogDescription>
						A workbook keeps what your chats learn and decide about this work, so each new chat
						starts from it instead of from pasted text.
					</DialogDescription>
				</DialogHeader>
				{template ? (
					<form
						onSubmit={submit}
						className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4"
						data-qa-id="workbooks-new-form"
					>
						<div className="scroll-fade-y -mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4">
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
												<span className="text-muted-foreground text-xs">
													{candidate.description}
												</span>
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
							{template.fields
								.filter((field) => field.required)
								.map((field) => (
									<BriefFieldInput
										key={field.id}
										field={field}
										value={values[field.id] ?? ""}
										onChange={(value) => setValues({ ...values, [field.id]: value })}
									/>
								))}
							<MoreDetails
								key={template.id}
								fields={template.fields.filter((field) => !field.required)}
								values={values}
								onChange={(id, value) => setValues({ ...values, [id]: value })}
							/>
							{error ? <FieldError data-qa-id="workbooks-start-error">{error}</FieldError> : null}
						</div>
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

function BriefFieldInput({
	field,
	value,
	onChange,
}: {
	readonly field: BriefField;
	readonly value: string;
	readonly onChange: (value: string) => void;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={`workbooks-field-${field.id}`}>{field.label}</FieldLabel>
			<Textarea
				id={`workbooks-field-${field.id}`}
				rows={field.required ? 3 : 2}
				value={value}
				data-qa-id={`workbooks-field-${field.id}`}
				onChange={(event) => onChange(event.target.value)}
			/>
			{field.hint ? <FieldDescription>{field.hint}</FieldDescription> : null}
		</Field>
	);
}

/**
 * The template's optional Brief fields, folded away as Custom Provider's
 * "Advanced settings" are: a bordered disclosure whose summary names them and
 * says how many are filled in. The first agent asks about whatever is left.
 */
function MoreDetails({
	fields,
	values,
	onChange,
}: {
	readonly fields: readonly BriefField[];
	readonly values: Readonly<Record<string, string>>;
	readonly onChange: (id: string, value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	if (fields.length === 0) return null;
	const filled = fields.filter((field) => values[field.id]?.trim()).length;
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<div className="border-border overflow-hidden rounded-lg border">
				<CollapsibleTrigger
					type="button"
					className="group hover:bg-muted flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors"
					data-qa-id="workbooks-more-details"
				>
					<div className="min-w-0">
						<p className="text-sm font-medium">More details</p>
						<p className="text-muted-foreground truncate text-xs">
							{fields.map((field) => field.label).join(", ")}
							{filled ? ` · ${filled} filled in` : " · optional"}
						</p>
					</div>
					<ChevronDownIcon className="text-muted-foreground size-4 shrink-0 transition-transform group-aria-expanded:rotate-180" />
				</CollapsibleTrigger>
				<CollapsibleContent>
					<Separator />
					<div className="flex flex-col gap-4 p-3">
						{fields.map((field) => (
							<BriefFieldInput
								key={field.id}
								field={field}
								value={values[field.id] ?? ""}
								onChange={(value) => onChange(field.id, value)}
							/>
						))}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}
