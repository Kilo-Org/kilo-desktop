import {
	ChevronDownIcon,
	ExternalLinkIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "@kilo-desktop/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kilo-desktop/ui/components/table";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
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
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { Separator } from "@kilo-desktop/ui/components/separator";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { KernelShell } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";

import { ApiKeyField } from "./ApiKeyField";
import {
	CUSTOM_PROVIDER_PACKAGE,
	CUSTOM_PROVIDER_PACKAGES,
	findDuplicate,
	generateProviderID,
	resolveModalities,
	sanitizeCustomProviderConfig,
	type CustomProviderPackage,
	type ModelModalities,
	type SanitizedProviderConfig,
} from "./custom-provider";

/** Same docs deep-link as Kilo VS Code / Cursor custom provider UI. */
const CUSTOM_PROVIDER_DOCS_URL = "https://kilo.ai/docs/ai-providers#custom-provider";
const MODEL_ROW_LAYOUT =
	"grid min-w-0 grid-cols-[minmax(8rem,1fr)_5.5rem_5.5rem_3.5rem] items-center gap-2";
const HEADER_ROW_LAYOUT =
	"grid min-w-0 grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.5fr)_3.5rem] items-center gap-2";

type HeaderRow = { rowID: string; key: string; value: string };
type ModelRow = {
	rowID: string;
	id: string;
	reasoning: boolean;
	supportsImages: boolean;
	modalities?: ModelModalities;
};

export type CustomProviderFormState = {
	name: string;
	npm: CustomProviderPackage;
	baseURL: string;
	apiKey: string;
	headers: HeaderRow[];
	models: ModelRow[];
};

type ExistingCustom = {
	providerID: string;
	name: string;
	config: SanitizedProviderConfig | Record<string, unknown>;
};

export type CustomProviderSubmitInput = {
	providerID: string;
	provider: unknown;
	apiKey: string | undefined;
	apiKeyChanged: boolean;
};

type CustomProviderFormProps = {
	existing: ExistingCustom | null;
	blockedIds: readonly string[];
	pending: boolean;
	error: string | null;
	/**
	 * `dialog` renders inside a `DialogContent` with its own header, scroll
	 * region, and footer; `inline` renders bare fields and actions for an
	 * expanded settings row.
	 */
	layout?: "dialog" | "inline";
	stepIndicator?: ReactNode;
	onBack?: () => void;
	onCancel(): void;
	onSubmit(input: CustomProviderSubmitInput): Promise<void>;
};

export const EMBEDDED_CUSTOM_PROVIDER_CONTENT_CLASS_NAME =
	"max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0";

const PACKAGE_ITEMS = CUSTOM_PROVIDER_PACKAGES.map((value) => ({
	value,
	label:
		value === "@ai-sdk/openai-compatible"
			? "OpenAI Compatible"
			: value === "@ai-sdk/openai"
				? "OpenAI Responses"
				: "Anthropic Messages",
}));

function emptyModel(): ModelRow {
	return { rowID: crypto.randomUUID(), id: "", reasoning: false, supportsImages: false };
}

function emptyHeader(): HeaderRow {
	return { rowID: crypto.randomUUID(), key: "", value: "" };
}

function modelsFromConfig(config: ExistingCustom["config"]): ModelRow[] {
	const models =
		"models" in config && config.models && typeof config.models === "object" ? config.models : {};
	const entries = Object.entries(
		models as Record<string, { name?: string; reasoning?: boolean; modalities?: ModelModalities }>,
	);
	if (entries.length === 0) return [];
	return entries.map(([id, model]) => ({
		rowID: crypto.randomUUID(),
		id,
		reasoning: model.reasoning === true,
		supportsImages: model.modalities?.input?.includes("image") === true,
		...(model.modalities ? { modalities: model.modalities } : {}),
	}));
}

function headersFromConfig(config: ExistingCustom["config"]): HeaderRow[] {
	const options =
		"options" in config ? (config.options as { headers?: Record<string, string> }) : undefined;
	const headers = options?.headers;
	if (!headers || Object.keys(headers).length === 0) return [];
	return Object.entries(headers).map(([key, value]) => ({
		rowID: crypto.randomUUID(),
		key,
		value,
	}));
}

function initForm(existing: ExistingCustom | null): CustomProviderFormState {
	if (!existing) {
		return {
			name: "",
			npm: CUSTOM_PROVIDER_PACKAGE,
			baseURL: "",
			apiKey: "",
			headers: [],
			models: [],
		};
	}
	const options =
		"options" in existing.config ? (existing.config.options as { baseURL?: string }) : undefined;
	const npm =
		"npm" in existing.config && typeof existing.config.npm === "string"
			? existing.config.npm
			: CUSTOM_PROVIDER_PACKAGE;
	return {
		name: existing.name,
		npm: CUSTOM_PROVIDER_PACKAGES.includes(npm as CustomProviderPackage)
			? (npm as CustomProviderPackage)
			: CUSTOM_PROVIDER_PACKAGE,
		baseURL: options?.baseURL ?? "",
		apiKey: "",
		headers: headersFromConfig(existing.config),
		models: modelsFromConfig(existing.config),
	};
}

function toProvider(form: CustomProviderFormState): unknown {
	const headers = Object.fromEntries(
		form.headers
			.map((row) => [row.key.trim(), row.value.trim()] as const)
			.filter(([key, value]) => key.length > 0 && value.length > 0),
	);
	const models = Object.fromEntries(
		form.models
			.filter((model) => model.id.trim().length > 0)
			.map((model) => {
				const modalities = resolveModalities(model.modalities, model.supportsImages);
				return [
					model.id.trim(),
					{
						name: model.id.trim(),
						...(model.reasoning ? { reasoning: true } : {}),
						...(modalities ? { modalities } : {}),
					},
				] as const;
			}),
	);
	return {
		npm: form.npm,
		name: form.name,
		options: {
			baseURL: form.baseURL,
			...(Object.keys(headers).length > 0 ? { headers } : {}),
		},
		models,
	};
}

function validateHeaders(headers: HeaderRow[]): string | null {
	if (headers.some((row) => !row.key.trim() || !row.value.trim())) {
		return "Header name and value are both required";
	}
	const duplicate = findDuplicate(
		headers.map((row) => row.key),
		true,
	);
	if (duplicate) {
		return `Header "${duplicate}" is duplicated`;
	}
	return null;
}

export function CustomProviderForm({
	existing,
	blockedIds,
	pending,
	error,
	layout = "dialog",
	stepIndicator,
	onBack,
	onCancel,
	onSubmit,
}: CustomProviderFormProps) {
	const shell = useDomain(KernelShell);
	// Several inline editors can be expanded at once, so field ids must be unique per form.
	const fieldId = useId();
	const ids = {
		name: `${fieldId}-name`,
		npm: `${fieldId}-npm`,
		url: `${fieldId}-url`,
		key: `${fieldId}-key`,
		modelId: `${fieldId}-model-id`,
		headerKey: `${fieldId}-header-key`,
		headerValue: `${fieldId}-header-value`,
	};
	const inline = layout === "inline";
	const editing = existing !== null;
	const [form, setForm] = useState<CustomProviderFormState>(() => initForm(existing));
	const [modelDraft, setModelDraft] = useState<ModelRow>(emptyModel);
	const [modelDraftError, setModelDraftError] = useState<string | null>(null);
	const [headerDraft, setHeaderDraft] = useState<HeaderRow>(emptyHeader);
	const [headerDraftError, setHeaderDraftError] = useState<string | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const [apiKeyChanged, setApiKeyChanged] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(() =>
		existing ? headersFromConfig(existing.config).length > 0 : false,
	);
	const formError = localError ?? error;
	const apiKeyRemovalPending = editing && apiKeyChanged && !form.apiKey.trim();

	const addModel = () => {
		const id = modelDraft.id.trim();
		if (!id) {
			setModelDraftError("Enter a model ID");
			return;
		}
		if (form.models.some((model) => model.id === id)) {
			setModelDraftError(`Model ID "${id}" is already added`);
			return;
		}
		setForm((current) => ({
			...current,
			models: [...current.models, { ...modelDraft, id }],
		}));
		setModelDraft(emptyModel());
		setModelDraftError(null);
	};

	const addHeader = () => {
		const header = {
			...headerDraft,
			key: headerDraft.key.trim(),
			value: headerDraft.value.trim(),
		};
		const validationError = validateHeaders([...form.headers, header]);
		if (validationError) {
			setHeaderDraftError(validationError);
			return;
		}
		setForm((current) => ({
			...current,
			headers: [...current.headers, header],
		}));
		setHeaderDraft(emptyHeader());
		setHeaderDraftError(null);
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const providerID = existing?.providerID ?? generateProviderID(form.name, blockedIds);
		const pendingModel = modelDraft.id.trim() ? [{ ...modelDraft, id: modelDraft.id.trim() }] : [];
		const models = [...form.models, ...pendingModel];
		const model = findDuplicate(models.map((row) => row.id));
		if (model) {
			setModelDraftError(`Model ID "${model}" is already added`);
			return;
		}
		const pendingHeader =
			headerDraft.key.trim() || headerDraft.value.trim()
				? [{ ...headerDraft, key: headerDraft.key.trim(), value: headerDraft.value.trim() }]
				: [];
		const headers = [...form.headers, ...pendingHeader];
		const headerError = validateHeaders(headers);
		if (headerError) {
			setAdvancedOpen(true);
			setHeaderDraftError(headerError);
			return;
		}
		const provider = toProvider({ ...form, models, headers });
		const sanitized = sanitizeCustomProviderConfig(provider);
		if ("error" in sanitized) {
			setLocalError(sanitized.error);
			return;
		}
		setLocalError(null);
		setHeaderDraftError(null);
		const key = form.apiKey.trim();
		void onSubmit({
			providerID,
			provider,
			apiKey: apiKeyChanged ? key : undefined,
			apiKeyChanged,
		});
	};

	const updateModel = (index: number, patch: Partial<ModelRow>) => {
		setForm((current) => ({
			...current,
			models: current.models.map((row, rowIndex) =>
				rowIndex === index ? { ...row, ...patch } : row,
			),
		}));
	};

	const updateAllModels = (patch: Partial<ModelRow>) => {
		setForm((current) => ({
			...current,
			models: current.models.map((row) => ({ ...row, ...patch })),
		}));
	};

	const allModelsSupportReasoning =
		form.models.length > 0 && form.models.every((model) => model.reasoning);
	const allModelsSupportImages =
		form.models.length > 0 && form.models.every((model) => model.supportsImages);

	const setupGuideLink = (
		<ExternalLink
			href={CUSTOM_PROVIDER_DOCS_URL}
			onOpen={(url) => void shell?.methods.openExternal({ url }).catch(() => undefined)}
		>
			Setup guide
			<ExternalLinkIcon className="ml-1 inline size-3" />
		</ExternalLink>
	);

	const cancelOrBack = onBack ? (
		<Button type="button" variant="outline" disabled={pending} onClick={onBack}>
			Back
		</Button>
	) : (
		<Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
			Cancel
		</Button>
	);
	const submitButton = (
		<Button type="submit" disabled={pending} data-qa-id="kilo-providers-custom-save">
			{pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
			{pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add AI Provider"}
		</Button>
	);

	return (
		<form onSubmit={submit} className={inline ? "flex min-w-0 flex-col gap-5" : "contents"}>
			{inline ? null : (
				<DialogHeader className="px-4 pt-4 pr-12">
					<DialogTitle>{editing ? "Edit custom provider" : "Add custom AI provider"}</DialogTitle>
					<DialogDescription>
						Add an OpenAI- or Anthropic-compatible endpoint. {setupGuideLink}
					</DialogDescription>
				</DialogHeader>
			)}
			<div className={inline ? "min-w-0" : "scroll-fade-y min-h-0 overflow-y-auto px-4 py-4"}>
				<FieldGroup className="gap-5">
					<FieldGroup className="grid gap-4 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor={ids.name}>Provider name</FieldLabel>
							<Input
								id={ids.name}
								value={form.name}
								onChange={(event) =>
									setForm((current) => ({ ...current, name: event.target.value }))
								}
								placeholder="Local vLLM"
								data-qa-id="kilo-providers-custom-name"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={ids.npm}>API format</FieldLabel>
							<Select
								items={PACKAGE_ITEMS}
								value={form.npm}
								onValueChange={(value) => {
									if (value == null) return;
									setForm((current) => ({
										...current,
										npm: value as CustomProviderPackage,
									}));
								}}
							>
								<SelectTrigger
									id={ids.npm}
									className="w-full"
									data-qa-id="kilo-providers-custom-npm"
								>
									<SelectValue>
										{(value) => PACKAGE_ITEMS.find((item) => item.value === value)?.label ?? value}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{PACKAGE_ITEMS.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
					</FieldGroup>

					<Field>
						<FieldLabel htmlFor={ids.url}>Base URL</FieldLabel>
						<Input
							id={ids.url}
							value={form.baseURL}
							onChange={(event) =>
								setForm((current) => ({ ...current, baseURL: event.target.value }))
							}
							placeholder="https://api.example.com/v1"
							data-qa-id="kilo-providers-custom-url"
						/>
					</Field>

					<Field className="gap-2.5">
						<div className="flex items-center justify-between gap-3">
							<FieldLabel htmlFor={ids.key}>API key</FieldLabel>
							<Badge variant={apiKeyRemovalPending ? "destructive" : "secondary"}>
								{apiKeyRemovalPending
									? "Removal pending"
									: editing && apiKeyChanged
										? "New key"
										: "Optional"}
							</Badge>
						</div>
						<ApiKeyField
							id={ids.key}
							value={form.apiKey}
							placeholder={editing ? "Enter a new API key" : "Enter an API key"}
							qaId="kilo-providers-custom-key"
							onChange={(value) => {
								setApiKeyChanged(value.trim().length > 0);
								setForm((current) => ({ ...current, apiKey: value }));
							}}
						/>
						<div className="flex items-center justify-between gap-3">
							<FieldDescription className="min-w-0">
								{apiKeyRemovalPending
									? "Any stored key will be removed when you save."
									: editing
										? "Leave blank to keep the current authentication settings."
										: "Only needed when the endpoint requires authentication."}
							</FieldDescription>
							{editing ? (
								<Button
									type="button"
									variant="ghost"
									size="xs"
									className={
										apiKeyRemovalPending
											? "-mr-1.5 w-auto shrink-0"
											: "text-destructive hover:text-destructive -mr-1.5 w-auto shrink-0"
									}
									onClick={() => {
										setApiKeyChanged(!apiKeyRemovalPending);
										setForm((current) => ({ ...current, apiKey: "" }));
									}}
									data-qa-id="kilo-providers-custom-key-remove"
								>
									{apiKeyRemovalPending ? (
										<RotateCcwIcon data-icon="inline-start" />
									) : (
										<Trash2Icon data-icon="inline-start" />
									)}
									{apiKeyRemovalPending ? "Keep stored key" : "Remove stored key"}
								</Button>
							) : null}
						</div>
					</Field>

					<Separator />

					<FieldSet className="gap-3">
						<div className="flex flex-col gap-1">
							<FieldLegend variant="label" className="mb-0">
								Models
							</FieldLegend>
							<FieldDescription>Add each model ID exposed by this endpoint.</FieldDescription>
						</div>
						<div className="border-border overflow-hidden rounded-lg border">
							<div className="scroll-fade-y max-h-60 overflow-y-auto">
								<Table className="table-fixed" aria-label="Models">
									<TableHeader>
										<TableRow>
											<TableHead scope="col">Model ID</TableHead>
											<TableHead scope="col" className="w-[5.5rem] text-center">
												Reasoning
											</TableHead>
											<TableHead scope="col" className="w-[5.5rem] text-center">
												Images
											</TableHead>
											<TableHead scope="col" className="w-14">
												<span className="sr-only">Actions</span>
											</TableHead>
										</TableRow>
									</TableHeader>
									{form.models.length > 0 ? (
										<TableBody>
											<TableRow>
												<TableCell className="text-muted-foreground font-medium">
													All models
												</TableCell>
												<TableCell className="text-center">
													<Checkbox
														checked={allModelsSupportReasoning}
														onCheckedChange={(checked) => updateAllModels({ reasoning: checked })}
														aria-label="Toggle reasoning support for all models"
														data-qa-id="kilo-providers-model-reasoning-all"
													/>
												</TableCell>
												<TableCell className="text-center">
													<Checkbox
														checked={allModelsSupportImages}
														onCheckedChange={(checked) =>
															updateAllModels({ supportsImages: checked })
														}
														aria-label="Toggle image input support for all models"
														data-qa-id="kilo-providers-model-images-all"
													/>
												</TableCell>
												<TableCell />
											</TableRow>
											{form.models.map((model, index) => (
												<TableRow
													key={model.rowID}
													data-qa-id={`kilo-providers-model-row-${index}`}
												>
													<TableCell className="truncate font-mono">{model.id}</TableCell>
													<TableCell className="text-center">
														<Checkbox
															checked={model.reasoning}
															onCheckedChange={(checked) =>
																updateModel(index, { reasoning: checked })
															}
															aria-label={`Reasoning support for ${model.id}`}
															data-qa-id={`kilo-providers-model-reasoning-${index}`}
														/>
													</TableCell>
													<TableCell className="text-center">
														<Checkbox
															checked={model.supportsImages}
															onCheckedChange={(checked) =>
																updateModel(index, { supportsImages: checked })
															}
															aria-label={`Image input support for ${model.id}`}
															data-qa-id={`kilo-providers-model-images-${index}`}
														/>
													</TableCell>
													<TableCell className="text-center">
														<Button
															type="button"
															variant="ghost"
															size="icon-xs"
															aria-label={`Remove ${model.id}`}
															onClick={() =>
																setForm((current) => ({
																	...current,
																	models: current.models.filter(
																		(_, rowIndex) => rowIndex !== index,
																	),
																}))
															}
															data-qa-id={`kilo-providers-model-remove-${index}`}
														>
															<Trash2Icon />
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									) : null}
								</Table>
							</div>
							<Field
								data-invalid={Boolean(modelDraftError)}
								className="border-border border-t p-2.5"
							>
								<FieldLabel htmlFor={ids.modelId} className="sr-only">
									Model ID
								</FieldLabel>
								<div className={MODEL_ROW_LAYOUT}>
									<Input
										id={ids.modelId}
										className="min-w-40 flex-1"
										placeholder="e.g. gpt-4.1"
										value={modelDraft.id}
										aria-invalid={Boolean(modelDraftError) || undefined}
										onChange={(event) => {
											setModelDraft((current) => ({ ...current, id: event.target.value }));
											setModelDraftError(null);
										}}
										onKeyDown={(event) => {
											if (event.key !== "Enter") return;
											event.preventDefault();
											addModel();
										}}
										data-qa-id="kilo-providers-model-id-input"
									/>
									<div className="flex justify-center">
										<Checkbox
											checked={modelDraft.reasoning}
											onCheckedChange={(checked) =>
												setModelDraft((current) => ({ ...current, reasoning: checked }))
											}
											aria-label="Reasoning support for new model"
											data-qa-id="kilo-providers-model-reasoning-input"
										/>
									</div>
									<div className="flex justify-center">
										<Checkbox
											checked={modelDraft.supportsImages}
											onCheckedChange={(checked) =>
												setModelDraft((current) => ({ ...current, supportsImages: checked }))
											}
											aria-label="Image input support for new model"
											data-qa-id="kilo-providers-model-images-input"
										/>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="w-full"
										disabled={!modelDraft.id.trim()}
										onClick={addModel}
										data-qa-id="kilo-providers-add-model"
									>
										<PlusIcon data-icon="inline-start" />
										Add
									</Button>
								</div>
								{modelDraftError ? <FieldError>{modelDraftError}</FieldError> : null}
							</Field>
						</div>
					</FieldSet>

					<Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
						<div className="border-border overflow-hidden rounded-lg border">
							<CollapsibleTrigger
								type="button"
								className="group hover:bg-muted flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors"
								data-qa-id="kilo-providers-custom-advanced"
							>
								<div className="min-w-0">
									<p className="text-sm font-medium">Advanced settings</p>
									<p className="text-muted-foreground text-xs">
										Custom request headers
										{form.headers.length ? ` · ${form.headers.length}` : ""}
									</p>
								</div>
								<ChevronDownIcon className="text-muted-foreground size-4 transition-transform group-aria-expanded:rotate-180" />
							</CollapsibleTrigger>
							<CollapsibleContent>
								<Separator />
								<FieldSet className="gap-2 p-3">
									<FieldLegend className="sr-only">Custom headers</FieldLegend>
									<FieldDescription>
										Header values are saved to your configuration. Use {"{env:MY_API_TOKEN}"} for
										secrets.
									</FieldDescription>
									<div className="border-border overflow-hidden rounded-lg border">
										<div className="scroll-fade-y max-h-48 overflow-y-auto">
											<Table className="table-fixed" aria-label="Custom request headers">
												<TableHeader>
													<TableRow>
														<TableHead scope="col" className="w-[40%]">
															Name
														</TableHead>
														<TableHead scope="col">Value</TableHead>
														<TableHead scope="col" className="w-14">
															<span className="sr-only">Actions</span>
														</TableHead>
													</TableRow>
												</TableHeader>
												{form.headers.length > 0 ? (
													<TableBody>
														{form.headers.map((header, index) => (
															<TableRow key={header.rowID}>
																<TableCell
																	className="truncate font-mono text-xs"
																	title={header.key}
																>
																	{header.key}
																</TableCell>
																<TableCell
																	className="truncate font-mono text-xs"
																	title={header.value}
																>
																	{header.value}
																</TableCell>
																<TableCell className="text-center">
																	<Button
																		type="button"
																		variant="ghost"
																		size="icon-xs"
																		aria-label={`Remove header ${index + 1}`}
																		onClick={() =>
																			setForm((current) => ({
																				...current,
																				headers: current.headers.filter(
																					(_, rowIndex) => rowIndex !== index,
																				),
																			}))
																		}
																		data-qa-id={`kilo-providers-header-remove-${index}`}
																	>
																		<Trash2Icon />
																	</Button>
																</TableCell>
															</TableRow>
														))}
													</TableBody>
												) : null}
											</Table>
										</div>
										<Field
											data-invalid={Boolean(headerDraftError)}
											className="border-border border-t p-2.5"
										>
											<div className={HEADER_ROW_LAYOUT}>
												<Field className="gap-0">
													<FieldLabel htmlFor={ids.headerKey} className="sr-only">
														Header name
													</FieldLabel>
													<Input
														id={ids.headerKey}
														placeholder="e.g. Authorization"
														value={headerDraft.key}
														aria-invalid={Boolean(headerDraftError) || undefined}
														onChange={(event) => {
															setHeaderDraft((current) => ({
																...current,
																key: event.target.value,
															}));
															setHeaderDraftError(null);
														}}
														onKeyDown={(event) => {
															if (event.key !== "Enter") return;
															event.preventDefault();
															addHeader();
														}}
														data-qa-id="kilo-providers-header-key-input"
													/>
												</Field>
												<Field className="gap-0">
													<FieldLabel htmlFor={ids.headerValue} className="sr-only">
														Header value
													</FieldLabel>
													<Input
														id={ids.headerValue}
														placeholder="e.g. Bearer {env:API_TOKEN}"
														value={headerDraft.value}
														aria-invalid={Boolean(headerDraftError) || undefined}
														onChange={(event) => {
															setHeaderDraft((current) => ({
																...current,
																value: event.target.value,
															}));
															setHeaderDraftError(null);
														}}
														onKeyDown={(event) => {
															if (event.key !== "Enter") return;
															event.preventDefault();
															addHeader();
														}}
														data-qa-id="kilo-providers-header-value-input"
													/>
												</Field>
												<Button
													type="button"
													variant="outline"
													size="sm"
													className="w-full"
													disabled={!headerDraft.key.trim() || !headerDraft.value.trim()}
													onClick={addHeader}
													data-qa-id="kilo-providers-add-header"
												>
													<PlusIcon data-icon="inline-start" />
													Add
												</Button>
											</div>
											{headerDraftError ? <FieldError>{headerDraftError}</FieldError> : null}
										</Field>
									</div>
								</FieldSet>
							</CollapsibleContent>
						</div>
					</Collapsible>

					{formError ? (
						<Field data-invalid>
							<FieldError>{formError}</FieldError>
						</Field>
					) : null}
				</FieldGroup>
			</div>
			{inline ? (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-muted-foreground text-xs">
						OpenAI- or Anthropic-compatible endpoint. {setupGuideLink}
					</p>
					<div className="ml-auto flex gap-2">
						{cancelOrBack}
						{submitButton}
					</div>
				</div>
			) : (
				<DialogFooter className="m-0 rounded-b-xl px-4 py-3">
					{stepIndicator}
					{cancelOrBack}
					{submitButton}
				</DialogFooter>
			)}
		</form>
	);
}
