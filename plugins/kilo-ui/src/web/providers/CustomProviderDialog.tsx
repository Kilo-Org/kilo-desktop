import {
	ChevronDownIcon,
	ExternalLinkIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "@kilo-desktop/ui/components/badge";
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
import { ScrollArea } from "@kilo-desktop/ui/components/scroll-area";
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
import { useSdk } from "@kilo-desktop/sdk-react";

import { ApiKeyField } from "./ApiKeyField.js";
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
} from "./custom-provider.js";

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

type CustomProviderDialogProps = {
	open: boolean;
	existing: ExistingCustom | null;
	blockedIds: readonly string[];
	pending: boolean;
	error: string | null;
	onOpenChange(open: boolean): void;
	onSubmit(input: CustomProviderSubmitInput): Promise<void>;
};

type CustomProviderFormProps = Omit<CustomProviderDialogProps, "open" | "onOpenChange"> & {
	stepIndicator?: ReactNode;
	onBack?: () => void;
	onCancel(): void;
};

export const CUSTOM_PROVIDER_DIALOG_CONTENT_CLASS_NAME =
	"max-h-[min(90vh,48rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl";

export const EMBEDDED_CUSTOM_PROVIDER_CONTENT_CLASS_NAME =
	"max-h-[min(90vh,48rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0";

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
	stepIndicator,
	onBack,
	onCancel,
	onSubmit,
}: CustomProviderFormProps) {
	const sdk = useSdk("kilo-ui");
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

	return (
		<form onSubmit={submit} className="contents">
			<DialogHeader className="gap-4 px-4 pt-4 pr-12">
				{stepIndicator}
				<div className="flex flex-col gap-2">
					<DialogTitle>{editing ? "Edit custom provider" : "Add custom AI Provider"}</DialogTitle>
					<DialogDescription>
						Add an OpenAI- or Anthropic-compatible endpoint.{" "}
						<a
							href={CUSTOM_PROVIDER_DOCS_URL}
							onClick={(event) => {
								event.preventDefault();
								void sdk.shell.openExternal(CUSTOM_PROVIDER_DOCS_URL).catch(() => undefined);
							}}
						>
							Setup guide
							<ExternalLinkIcon className="ml-1 inline size-3" />
						</a>
					</DialogDescription>
				</div>
			</DialogHeader>
			<div className="scroll-fade min-h-0 overflow-y-auto px-4 py-4">
				<FieldGroup className="gap-5">
					<FieldGroup className="grid gap-4 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor="kilo-custom-name">Provider name</FieldLabel>
							<Input
								id="kilo-custom-name"
								value={form.name}
								onChange={(event) =>
									setForm((current) => ({ ...current, name: event.target.value }))
								}
								placeholder="Local vLLM"
								data-qa-id="kilo-providers-custom-name"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="kilo-custom-npm">API format</FieldLabel>
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
									id="kilo-custom-npm"
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
						<FieldLabel htmlFor="kilo-custom-url">Base URL</FieldLabel>
						<Input
							id="kilo-custom-url"
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
							<FieldLabel htmlFor="kilo-custom-key">API key</FieldLabel>
							<Badge variant={apiKeyRemovalPending ? "destructive" : "secondary"}>
								{apiKeyRemovalPending
									? "Removal pending"
									: editing && apiKeyChanged
										? "New key"
										: "Optional"}
							</Badge>
						</div>
						<ApiKeyField
							id="kilo-custom-key"
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
						<div
							className="border-border overflow-hidden rounded-lg border"
							role="table"
							aria-label="Models"
						>
							<div
								className={`${MODEL_ROW_LAYOUT} border-border bg-foreground/3 text-muted-foreground border-b px-2.5 py-2 text-xs font-medium`}
								role="row"
							>
								<span role="columnheader">Model ID</span>
								<span className="text-center" role="columnheader">
									Reasoning
								</span>
								<span className="text-center" role="columnheader">
									Images
								</span>
								<span className="sr-only" role="columnheader">
									Actions
								</span>
							</div>
							{form.models.length > 0 ? (
								<div
									className={`${MODEL_ROW_LAYOUT} border-border bg-foreground/2 min-h-9 border-b px-2.5`}
									role="row"
								>
									<span className="text-muted-foreground text-xs font-medium" role="cell">
										All models
									</span>
									<div className="flex justify-center" role="cell">
										<Checkbox
											checked={allModelsSupportReasoning}
											onCheckedChange={(checked) => updateAllModels({ reasoning: checked })}
											aria-label="Toggle reasoning support for all models"
											data-qa-id="kilo-providers-model-reasoning-all"
										/>
									</div>
									<div className="flex justify-center" role="cell">
										<Checkbox
											checked={allModelsSupportImages}
											onCheckedChange={(checked) => updateAllModels({ supportsImages: checked })}
											aria-label="Toggle image input support for all models"
											data-qa-id="kilo-providers-model-images-all"
										/>
									</div>
									<span role="cell" />
								</div>
							) : null}
							{form.models.length > 0 ? (
								<ScrollArea
									className="border-border border-b"
									style={{ height: Math.min(form.models.length, 5) * 36 }}
								>
									<div className="divide-border divide-y" role="rowgroup">
										{form.models.map((model, index) => (
											<div
												key={model.rowID}
												className={`${MODEL_ROW_LAYOUT} min-h-9 px-2.5`}
												role="row"
												data-qa-id={`kilo-providers-model-row-${index}`}
											>
												<span className="truncate font-mono text-sm" role="cell">
													{model.id}
												</span>
												<div className="flex justify-center" role="cell">
													<Checkbox
														checked={model.reasoning}
														onCheckedChange={(checked) =>
															updateModel(index, { reasoning: checked })
														}
														aria-label={`Reasoning support for ${model.id}`}
														data-qa-id={`kilo-providers-model-reasoning-${index}`}
													/>
												</div>
												<div className="flex justify-center" role="cell">
													<Checkbox
														checked={model.supportsImages}
														onCheckedChange={(checked) =>
															updateModel(index, { supportsImages: checked })
														}
														aria-label={`Image input support for ${model.id}`}
														data-qa-id={`kilo-providers-model-images-${index}`}
													/>
												</div>
												<div className="flex justify-center" role="cell">
													<Button
														type="button"
														variant="ghost"
														size="icon-xs"
														aria-label={`Remove ${model.id}`}
														onClick={() =>
															setForm((current) => ({
																...current,
																models: current.models.filter((_, rowIndex) => rowIndex !== index),
															}))
														}
														data-qa-id={`kilo-providers-model-remove-${index}`}
													>
														<Trash2Icon />
													</Button>
												</div>
											</div>
										))}
									</div>
								</ScrollArea>
							) : null}
							<Field data-invalid={Boolean(modelDraftError)} className="p-2.5">
								<FieldLabel htmlFor="kilo-custom-model-id" className="sr-only">
									Model ID
								</FieldLabel>
								<div className={MODEL_ROW_LAYOUT}>
									<Input
										id="kilo-custom-model-id"
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
								className="group hover:bg-foreground/5 flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors"
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
									<div
										className="border-border overflow-hidden rounded-lg border"
										role="table"
										aria-label="Custom request headers"
									>
										<div
											className={`${HEADER_ROW_LAYOUT} border-border bg-foreground/3 text-muted-foreground border-b px-2.5 py-2 text-xs font-medium`}
											role="row"
										>
											<span role="columnheader">Name</span>
											<span role="columnheader">Value</span>
											<span className="sr-only" role="columnheader">
												Actions
											</span>
										</div>
										{form.headers.length > 0 ? (
											<ScrollArea
												className="border-border border-b"
												style={{ height: Math.min(form.headers.length, 4) * 36 }}
											>
												<div className="divide-border divide-y" role="rowgroup">
													{form.headers.map((header, index) => (
														<div
															key={header.rowID}
															className={`${HEADER_ROW_LAYOUT} min-h-9 px-2.5 [content-visibility:auto]`}
															role="row"
														>
															<span
																className="truncate font-mono text-xs"
																role="cell"
																title={header.key}
															>
																{header.key}
															</span>
															<span
																className="truncate font-mono text-xs"
																role="cell"
																title={header.value}
															>
																{header.value}
															</span>
															<div className="flex justify-center" role="cell">
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
															</div>
														</div>
													))}
												</div>
											</ScrollArea>
										) : null}
										<Field data-invalid={Boolean(headerDraftError)} className="p-2.5">
											<div className={HEADER_ROW_LAYOUT}>
												<Field className="gap-0">
													<FieldLabel htmlFor="kilo-custom-header-key" className="sr-only">
														Header name
													</FieldLabel>
													<Input
														id="kilo-custom-header-key"
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
													<FieldLabel htmlFor="kilo-custom-header-value" className="sr-only">
														Header value
													</FieldLabel>
													<Input
														id="kilo-custom-header-value"
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
			<DialogFooter className="m-0 rounded-b-xl px-4 py-3">
				{onBack ? (
					<Button type="button" variant="outline" disabled={pending} onClick={onBack}>
						Back
					</Button>
				) : (
					<Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
						Cancel
					</Button>
				)}
				<Button type="submit" disabled={pending} data-qa-id="kilo-providers-custom-save">
					{pending
						? editing
							? "Saving…"
							: "Adding…"
						: editing
							? "Save changes"
							: "Add AI Provider"}
				</Button>
			</DialogFooter>
		</form>
	);
}

export function CustomProviderDialog({
	open,
	pending,
	onOpenChange,
	...formProps
}: CustomProviderDialogProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && pending) return;
				onOpenChange(next);
			}}
		>
			<DialogContent
				data-qa-id="kilo-providers-custom-dialog"
				className={CUSTOM_PROVIDER_DIALOG_CONTENT_CLASS_NAME}
			>
				<CustomProviderForm {...formProps} pending={pending} onCancel={() => onOpenChange(false)} />
			</DialogContent>
		</Dialog>
	);
}
