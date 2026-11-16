import {
	ArrowRightIcon,
	ChevronDownIcon,
	CodeIcon,
	NotebookIcon,
	NotebookTabsIcon,
	type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { Separator } from "@kilo-desktop/ui/components/separator";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import {
	WizardStepIndicator,
	type WizardStep,
} from "@kilo-desktop/ui/components/wizard-step-indicator";

import type { BriefField, TemplateSummary } from "../contracts";

type NewWorkbookStep = "template" | "brief";

const STEPS: readonly WizardStep<NewWorkbookStep>[] = [
	{ id: "template", label: "Choose a template" },
	{ id: "brief", label: "Fill in the Brief" },
];

/** Past this many templates, the template step offers a filter. */
const FILTER_FROM = 7;

const TEMPLATE_ICONS: Readonly<Record<string, LucideIcon>> = {
	code: CodeIcon,
	notebook: NotebookIcon,
};

/**
 * Creates a workbook from a template, as a two-step wizard in the style of
 * Add AI Provider: choose a template from a compact grid (clicking one moves
 * on; a filter appears once there are many), then name the workbook and fill
 * in its Brief, the template's optional fields folded into More details. A
 * single template skips the first step. Stays open, showing why, when the
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
	const skipChooseStep = templates.length === 1;
	const [templateId, setTemplateId] = useState<string | null>(
		skipChooseStep ? templates[0]!.id : null,
	);
	const template = templates.find((candidate) => candidate.id === templateId) ?? null;
	const step: NewWorkbookStep = template ? "brief" : "template";
	const back = () => setTemplateId(null);

	const stepIndicator = skipChooseStep ? null : (
		<div className="flex items-center sm:mr-auto">
			<WizardStepIndicator
				steps={STEPS}
				currentStep={step}
				busy={busy}
				qaPrefix="workbooks-new"
				canSelect={(candidate) => candidate === "template" || template !== null}
				onSelect={(candidate) => {
					if (candidate === "template") back();
				}}
			/>
		</div>
	);

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent
				data-qa-id="workbooks-new-dialog"
				className="max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl"
			>
				{template ? (
					<BriefStep
						key={template.id}
						template={template}
						busy={busy}
						error={error}
						stepIndicator={stepIndicator}
						{...(skipChooseStep ? {} : { onBack: back })}
						onCancel={onClose}
						onCreate={(name, values) => onCreate(template.id, name, values)}
					/>
				) : (
					<TemplateStep
						templates={templates}
						stepIndicator={stepIndicator}
						onPick={setTemplateId}
						onCancel={onClose}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function TemplateStep({
	templates,
	stepIndicator,
	onPick,
	onCancel,
}: {
	readonly templates: readonly TemplateSummary[];
	readonly stepIndicator: ReactNode;
	readonly onPick: (id: string) => void;
	readonly onCancel: () => void;
}) {
	const [filter, setFilter] = useState("");
	const query = filter.trim().toLowerCase();
	const shown = query
		? templates.filter((template) =>
				`${template.name} ${template.description}`.toLowerCase().includes(query),
			)
		: templates;
	return (
		<>
			<DialogHeader>
				<DialogTitle>New workbook</DialogTitle>
				<DialogDescription>
					Choose a template for how you'll work: it sets up the workbook's sections and tells the
					agents how to keep it current.
				</DialogDescription>
			</DialogHeader>
			<div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4">
				{templates.length >= FILTER_FROM ? (
					<Input
						type="search"
						value={filter}
						autoFocus
						aria-label="Filter templates"
						placeholder="Filter templates"
						data-qa-id="workbooks-template-filter"
						onChange={(event) => setFilter(event.target.value)}
					/>
				) : (
					<span />
				)}
				<div className="scroll-fade-y -mx-4 min-h-0 overflow-y-auto px-4">
					{shown.length > 0 ? (
						<ItemGroup className="grid gap-2 sm:grid-cols-2" data-qa-id="workbooks-templates">
							{shown.map((template) => (
								<TemplateChoiceItem
									key={template.id}
									template={template}
									onSelect={() => onPick(template.id)}
								/>
							))}
						</ItemGroup>
					) : (
						<p className="text-muted-foreground py-6 text-center text-sm">
							No templates match "{filter.trim()}".
						</p>
					)}
				</div>
				<DialogFooter>
					{stepIndicator}
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
				</DialogFooter>
			</div>
		</>
	);
}

/** One template, as Add AI Provider's provider choices: click to continue with it. */
function TemplateChoiceItem({
	template,
	onSelect,
}: {
	readonly template: TemplateSummary;
	readonly onSelect: () => void;
}) {
	const Icon = TEMPLATE_ICONS[template.icon ?? ""] ?? NotebookTabsIcon;
	return (
		<Item
			render={<button type="button" />}
			variant="outline"
			size="sm"
			className="bg-card hover:bg-muted min-w-0 flex-nowrap text-left"
			title={template.description}
			onClick={onSelect}
			data-qa-id={`workbooks-template-${template.id}`}
		>
			<ItemMedia className="border-border bg-background size-8 rounded-lg border">
				<Icon className="size-4" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>{template.name}</ItemTitle>
				<ItemDescription className="line-clamp-1 text-xs">{template.description}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<ArrowRightIcon className="text-muted-foreground size-4" />
			</ItemActions>
		</Item>
	);
}

function BriefStep({
	template,
	busy,
	error,
	stepIndicator,
	onBack,
	onCancel,
	onCreate,
}: {
	readonly template: TemplateSummary;
	readonly busy: boolean;
	readonly error: string | null;
	readonly stepIndicator: ReactNode;
	readonly onBack?: () => void;
	readonly onCancel: () => void;
	readonly onCreate: (name: string, values: Record<string, string>) => void;
}) {
	const [name, setName] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const missing = template.fields.some((field) => field.required && !values[field.id]?.trim());
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!missing && name.trim()) onCreate(name.trim(), values);
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle>New {template.name} workbook</DialogTitle>
				<DialogDescription>{template.description}</DialogDescription>
			</DialogHeader>
			<form
				onSubmit={submit}
				className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4"
				data-qa-id="workbooks-new-form"
			>
				<div className="scroll-fade-y -mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4">
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
						fields={template.fields.filter((field) => !field.required)}
						values={values}
						onChange={(id, value) => setValues({ ...values, [id]: value })}
					/>
					{error ? <FieldError data-qa-id="workbooks-start-error">{error}</FieldError> : null}
				</div>
				<DialogFooter>
					{stepIndicator}
					{onBack ? (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							data-qa-id="workbooks-back"
							onClick={onBack}
						>
							Back
						</Button>
					) : (
						<Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
							Cancel
						</Button>
					)}
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
		</>
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
