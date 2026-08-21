import { BrainIcon, ImageIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Toggle } from "@anaconda-agentic-desktop/ui/components/toggle";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import {
	CUSTOM_PROVIDER_PACKAGE,
	CUSTOM_PROVIDER_PACKAGES,
	findDuplicate,
	resolveModalities,
	sanitizeCustomProviderConfig,
	validateProviderID,
	type CustomProviderPackage,
	type ModelModalities,
	type SanitizedProviderConfig,
} from "./custom-provider.js";

/** Same docs deep-link as Kilo VS Code / Cursor custom provider UI. */
const CUSTOM_PROVIDER_DOCS_URL = "https://kilo.ai/docs/ai-providers#custom-provider";

const EDITOR_ROW =
	"grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-1.5";
const EDITOR_ACTIONS = "-mr-1.5 flex shrink-0 items-center";

type HeaderRow = { key: string; value: string };
type ModelRow = {
	id: string;
	name: string;
	reasoning: boolean;
	supportsImages: boolean;
	modalities?: ModelModalities;
};

export type CustomProviderFormState = {
	providerID: string;
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

type InvalidField = "id" | "models" | "headers" | "config" | null;

type CustomProviderDialogProps = {
	open: boolean;
	existing: ExistingCustom | null;
	blockedIds: readonly string[];
	pending: boolean;
	error: string | null;
	onOpenChange(open: boolean): void;
	onSubmit(input: {
		providerID: string;
		provider: unknown;
		apiKey: string | undefined;
		apiKeyChanged: boolean;
	}): Promise<void>;
};

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
	return { id: "", name: "", reasoning: false, supportsImages: false };
}

function modelsFromConfig(config: ExistingCustom["config"]): ModelRow[] {
	const models =
		"models" in config && config.models && typeof config.models === "object" ? config.models : {};
	const entries = Object.entries(
		models as Record<string, { name?: string; reasoning?: boolean; modalities?: ModelModalities }>,
	);
	if (entries.length === 0) return [emptyModel()];
	return entries.map(([id, model]) => ({
		id,
		name: model.name ?? id,
		reasoning: model.reasoning === true,
		supportsImages: model.modalities?.input?.includes("image") === true,
		...(model.modalities ? { modalities: model.modalities } : {}),
	}));
}

function headersFromConfig(config: ExistingCustom["config"]): HeaderRow[] {
	const options =
		"options" in config ? (config.options as { headers?: Record<string, string> }) : undefined;
	const headers = options?.headers;
	if (!headers || Object.keys(headers).length === 0) return [{ key: "", value: "" }];
	return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

function initForm(existing: ExistingCustom | null): CustomProviderFormState {
	if (!existing) {
		return {
			providerID: "",
			name: "",
			npm: CUSTOM_PROVIDER_PACKAGE,
			baseURL: "",
			apiKey: "",
			headers: [{ key: "", value: "" }],
			models: [emptyModel()],
		};
	}
	const options =
		"options" in existing.config ? (existing.config.options as { baseURL?: string }) : undefined;
	const npm =
		"npm" in existing.config && typeof existing.config.npm === "string"
			? existing.config.npm
			: CUSTOM_PROVIDER_PACKAGE;
	return {
		providerID: existing.providerID,
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
						name: model.name.trim() || model.id.trim(),
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

export function CustomProviderDialog({
	open,
	existing,
	blockedIds,
	pending,
	error,
	onOpenChange,
	onSubmit,
}: CustomProviderDialogProps) {
	const sdk = useSdk("kilo-ui");
	const editing = existing !== null;
	const [form, setForm] = useState<CustomProviderFormState>(() => initForm(existing));
	const [localError, setLocalError] = useState<string | null>(null);
	const [invalid, setInvalid] = useState<InvalidField>(null);
	const [apiKeyChanged, setApiKeyChanged] = useState(false);
	const formError = localError ?? error;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const id = validateProviderID(form.providerID);
		if ("error" in id) {
			setLocalError(id.error);
			setInvalid("id");
			return;
		}
		if (!editing && blockedIds.includes(id.value)) {
			setLocalError("Provider ID already exists");
			setInvalid("id");
			return;
		}
		const model = findDuplicate(form.models.map((row) => row.id));
		if (model) {
			setLocalError(`Model ID "${model}" is duplicated`);
			setInvalid("models");
			return;
		}
		const header = findDuplicate(
			form.headers.map((row) => row.key),
			true,
		);
		if (header) {
			setLocalError(`Header "${header}" is duplicated`);
			setInvalid("headers");
			return;
		}
		const provider = toProvider(form);
		const sanitized = sanitizeCustomProviderConfig(provider);
		if ("error" in sanitized) {
			setLocalError(sanitized.error);
			setInvalid("config");
			return;
		}
		setLocalError(null);
		setInvalid(null);
		const key = form.apiKey.trim();
		void onSubmit({
			providerID: id.value,
			provider,
			apiKey: apiKeyChanged ? key : undefined,
			apiKeyChanged,
		});
	};

	const toggleAll = (field: "reasoning" | "supportsImages") => {
		setForm((current) => {
			const next = !current.models.every((model) => model[field]);
			return {
				...current,
				models: current.models.map((model) => ({ ...model, [field]: next })),
			};
		});
	};

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
				className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
			>
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>{editing ? "Edit AI Provider" : "Custom AI Provider"}</DialogTitle>
						<DialogDescription>
							Configure a custom AI provider.{" "}
							<a
								href={CUSTOM_PROVIDER_DOCS_URL}
								onClick={(event) => {
									event.preventDefault();
									void sdk.shell.openExternal(CUSTOM_PROVIDER_DOCS_URL).catch(() => undefined);
								}}
							>
								See the documentation
							</a>
							.
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field
							data-disabled={editing || undefined}
							data-invalid={invalid === "id" || undefined}
						>
							<FieldLabel htmlFor="kilo-custom-id">Provider ID</FieldLabel>
							<Input
								id="kilo-custom-id"
								value={form.providerID}
								disabled={editing}
								aria-invalid={invalid === "id" || undefined}
								onChange={(event) =>
									setForm((current) => ({ ...current, providerID: event.target.value }))
								}
								placeholder="myprovider"
								data-qa-id="kilo-providers-custom-id"
							/>
							<FieldDescription>
								Lowercase letters, numbers, hyphens, or underscores
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="kilo-custom-name">Display name</FieldLabel>
							<Input
								id="kilo-custom-name"
								value={form.name}
								onChange={(event) =>
									setForm((current) => ({ ...current, name: event.target.value }))
								}
								placeholder="My AI Provider"
								data-qa-id="kilo-providers-custom-name"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="kilo-custom-npm">Provider API</FieldLabel>
							<Select
								items={PACKAGE_ITEMS}
								value={form.npm}
								onValueChange={(value) => {
									if (value == null) return;
									setForm((current) => ({ ...current, npm: value as CustomProviderPackage }));
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
						<Field>
							<FieldLabel htmlFor="kilo-custom-url">Base URL</FieldLabel>
							<Input
								id="kilo-custom-url"
								value={form.baseURL}
								onChange={(event) =>
									setForm((current) => ({ ...current, baseURL: event.target.value }))
								}
								placeholder="https://api.myprovider.com/v1"
								data-qa-id="kilo-providers-custom-url"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="kilo-custom-key">API key</FieldLabel>
							<Input
								id="kilo-custom-key"
								type="password"
								autoComplete="off"
								value={form.apiKey}
								onChange={(event) => {
									setApiKeyChanged(event.target.value.trim().length > 0);
									setForm((current) => ({ ...current, apiKey: event.target.value }));
								}}
								placeholder={editing ? "Leave blank to keep stored key" : "API key"}
								data-qa-id="kilo-providers-custom-key"
							/>
							<FieldDescription>
								{apiKeyChanged && !form.apiKey.trim()
									? "The stored API key will be removed when you save."
									: editing
										? "Enter a value to replace the stored key, or leave blank to preserve it."
										: "Optional. Leave empty if you manage auth via headers."}
							</FieldDescription>
							{editing ? (
								<Button
									type="button"
									variant="ghost"
									size="xs"
									className="self-start"
									onClick={() => {
										setApiKeyChanged(true);
										setForm((current) => ({ ...current, apiKey: "" }));
									}}
									data-qa-id="kilo-providers-custom-key-remove"
								>
									Remove stored API key
								</Button>
							) : null}
						</Field>

						<FieldSet>
							<FieldLegend className="sr-only">Models</FieldLegend>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<FieldTitle>Models</FieldTitle>
								<div className="flex flex-wrap gap-1">
									<Button
										type="button"
										variant="ghost"
										size="xs"
										onClick={() => toggleAll("reasoning")}
										data-qa-id="kilo-providers-toggle-reasoning"
									>
										Toggle reasoning for all
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="xs"
										onClick={() => toggleAll("supportsImages")}
										data-qa-id="kilo-providers-toggle-images"
									>
										Toggle image for all
									</Button>
								</div>
							</div>
							<FieldGroup className="gap-2">
								{form.models.map((model, index) => (
									<div key={index} className={EDITOR_ROW}>
										<div className="min-w-0 pr-1">
											<FieldLabel htmlFor={`kilo-custom-model-id-${index}`} className="sr-only">
												Model {index + 1} ID
											</FieldLabel>
											<Input
												id={`kilo-custom-model-id-${index}`}
												placeholder="model-id"
												value={model.id}
												aria-invalid={invalid === "models" || undefined}
												onChange={(event) =>
													setForm((current) => ({
														...current,
														models: current.models.map((row, rowIndex) =>
															rowIndex === index ? { ...row, id: event.target.value } : row,
														),
													}))
												}
												data-qa-id={`kilo-providers-model-id-${index}`}
											/>
										</div>
										<div className="min-w-0">
											<FieldLabel htmlFor={`kilo-custom-model-name-${index}`} className="sr-only">
												Model {index + 1} name
											</FieldLabel>
											<Input
												id={`kilo-custom-model-name-${index}`}
												placeholder="Display Name"
												value={model.name}
												onChange={(event) =>
													setForm((current) => ({
														...current,
														models: current.models.map((row, rowIndex) =>
															rowIndex === index ? { ...row, name: event.target.value } : row,
														),
													}))
												}
												data-qa-id={`kilo-providers-model-name-${index}`}
											/>
										</div>
										<div className={EDITOR_ACTIONS}>
											<ModelFlag
												pressed={model.reasoning}
												label={`Reasoning for ${model.name || model.id || `model ${index + 1}`}`}
												hint="Reasoning"
												qaId={`kilo-providers-model-reasoning-${index}`}
												icon={<BrainIcon />}
												onPressedChange={(pressed) =>
													setForm((current) => ({
														...current,
														models: current.models.map((row, rowIndex) =>
															rowIndex === index ? { ...row, reasoning: pressed } : row,
														),
													}))
												}
											/>
											<ModelFlag
												pressed={model.supportsImages}
												label={`Image support for ${model.name || model.id || `model ${index + 1}`}`}
												hint="Image"
												qaId={`kilo-providers-model-images-${index}`}
												icon={<ImageIcon />}
												onPressedChange={(pressed) =>
													setForm((current) => ({
														...current,
														models: current.models.map((row, rowIndex) =>
															rowIndex === index ? { ...row, supportsImages: pressed } : row,
														),
													}))
												}
											/>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={`Remove model ${index + 1}`}
												disabled={form.models.length <= 1}
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
							</FieldGroup>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="-ml-1.5 self-start"
								onClick={() =>
									setForm((current) => ({
										...current,
										models: [...current.models, emptyModel()],
									}))
								}
								data-qa-id="kilo-providers-add-model"
							>
								<PlusIcon data-icon="inline-start" />
								Add model
							</Button>
						</FieldSet>

						<FieldSet>
							<FieldLegend className="sr-only">Headers</FieldLegend>
							<FieldTitle>Headers (optional)</FieldTitle>
							<FieldGroup className="gap-2">
								{form.headers.map((header, index) => (
									<div key={index} className={EDITOR_ROW}>
										<div className="min-w-0 pr-1">
											<FieldLabel htmlFor={`kilo-custom-header-key-${index}`} className="sr-only">
												Header {index + 1} name
											</FieldLabel>
											<Input
												id={`kilo-custom-header-key-${index}`}
												placeholder="Header-Name"
												value={header.key}
												aria-invalid={invalid === "headers" || undefined}
												onChange={(event) =>
													setForm((current) => ({
														...current,
														headers: current.headers.map((row, rowIndex) =>
															rowIndex === index ? { ...row, key: event.target.value } : row,
														),
													}))
												}
												data-qa-id={`kilo-providers-header-key-${index}`}
											/>
										</div>
										<div className="min-w-0">
											<FieldLabel htmlFor={`kilo-custom-header-value-${index}`} className="sr-only">
												Header {index + 1} value
											</FieldLabel>
											<Input
												id={`kilo-custom-header-value-${index}`}
												placeholder="value"
												value={header.value}
												onChange={(event) =>
													setForm((current) => ({
														...current,
														headers: current.headers.map((row, rowIndex) =>
															rowIndex === index ? { ...row, value: event.target.value } : row,
														),
													}))
												}
												data-qa-id={`kilo-providers-header-value-${index}`}
											/>
										</div>
										<div className={EDITOR_ACTIONS}>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={`Remove header ${index + 1}`}
												disabled={form.headers.length <= 1}
												onClick={() =>
													setForm((current) => ({
														...current,
														headers: current.headers.filter((_, rowIndex) => rowIndex !== index),
													}))
												}
												data-qa-id={`kilo-providers-header-remove-${index}`}
											>
												<Trash2Icon />
											</Button>
										</div>
									</div>
								))}
							</FieldGroup>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="-ml-1.5 self-start"
								onClick={() =>
									setForm((current) => ({
										...current,
										headers: [...current.headers, { key: "", value: "" }],
									}))
								}
								data-qa-id="kilo-providers-add-header"
							>
								<PlusIcon data-icon="inline-start" />
								Add header
							</Button>
						</FieldSet>

						{formError ? (
							<Field data-invalid>
								<FieldError>{formError}</FieldError>
							</Field>
						) : null}
					</FieldGroup>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={pending} data-qa-id="kilo-providers-custom-save">
							{pending ? "Saving…" : editing ? "Save" : "Connect"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ModelFlag({
	pressed,
	label,
	hint,
	qaId,
	icon,
	onPressedChange,
}: {
	pressed: boolean;
	label: string;
	hint: string;
	qaId: string;
	icon: ReactNode;
	onPressedChange: (pressed: boolean) => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				delay={300}
				closeDelay={400}
				render={
					<Toggle
						type="button"
						size="sm"
						pressed={pressed}
						aria-label={label}
						onPressedChange={onPressedChange}
						className="size-6 min-w-6 p-0"
						data-qa-id={qaId}
					/>
				}
			>
				{icon}
				<span className="sr-only">{hint}</span>
			</TooltipTrigger>
			<TooltipContent>{hint}</TooltipContent>
		</Tooltip>
	);
}
