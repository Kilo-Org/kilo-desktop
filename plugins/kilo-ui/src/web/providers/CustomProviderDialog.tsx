import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Checkbox } from "@anaconda-agentic-desktop/ui/components/checkbox";
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
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";

import {
	CUSTOM_PROVIDER_PACKAGE,
	CUSTOM_PROVIDER_PACKAGES,
	MASKED_CUSTOM_PROVIDER_KEY,
	sanitizeCustomProviderConfig,
	validateProviderID,
	type CustomProviderPackage,
	type SanitizedProviderConfig,
} from "./custom-provider.js";

type HeaderRow = { key: string; value: string };
type ModelRow = { id: string; name: string; reasoning: boolean; supportsImages: boolean };

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
	hasApiKey: boolean;
};

type CustomProviderDialogProps = {
	open: boolean;
	existing: ExistingCustom | null;
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
		models as Record<
			string,
			{ name?: string; reasoning?: boolean; modalities?: { input?: string[] } }
		>,
	);
	if (entries.length === 0) return [emptyModel()];
	return entries.map(([id, model]) => ({
		id,
		name: model.name ?? id,
		reasoning: model.reasoning === true,
		supportsImages: model.modalities?.input?.includes("image") === true,
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
		apiKey: existing.hasApiKey ? MASKED_CUSTOM_PROVIDER_KEY : "",
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
			.map((model) => [
				model.id.trim(),
				{
					name: model.name.trim() || model.id.trim(),
					...(model.reasoning ? { reasoning: true } : {}),
					...(model.supportsImages
						? { modalities: { input: ["text", "image"], output: ["text"] } }
						: {}),
				},
			]),
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
	pending,
	error,
	onOpenChange,
	onSubmit,
}: CustomProviderDialogProps) {
	const editing = existing !== null;
	const [form, setForm] = useState<CustomProviderFormState>(() => initForm(existing));
	const [localError, setLocalError] = useState<string | null>(null);
	const [apiKeyChanged, setApiKeyChanged] = useState(false);
	const existingId = existing?.providerID ?? "";

	useEffect(() => {
		if (!open) return;
		setForm(initForm(existing));
		setLocalError(null);
		setApiKeyChanged(false);
	}, [open, existingId]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const id = validateProviderID(form.providerID);
		if ("error" in id) {
			setLocalError(id.error);
			return;
		}
		const provider = toProvider(form);
		const sanitized = sanitizeCustomProviderConfig(provider);
		if ("error" in sanitized) {
			setLocalError(sanitized.error);
			return;
		}
		setLocalError(null);
		const key = form.apiKey.trim();
		void onSubmit({
			providerID: id.value,
			provider,
			apiKey: apiKeyChanged ? key : undefined,
			apiKeyChanged,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-qa-id="kilo-providers-custom-dialog"
				className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
			>
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>{editing ? "Edit custom provider" : "Add custom provider"}</DialogTitle>
					</DialogHeader>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="kilo-custom-id">Provider ID</FieldLabel>
							<Input
								id="kilo-custom-id"
								value={form.providerID}
								disabled={editing}
								onChange={(event) =>
									setForm((current) => ({ ...current, providerID: event.target.value }))
								}
								placeholder="my-provider"
								data-qa-id="kilo-providers-custom-id"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="kilo-custom-name">Name</FieldLabel>
							<Input
								id="kilo-custom-name"
								value={form.name}
								onChange={(event) =>
									setForm((current) => ({ ...current, name: event.target.value }))
								}
								data-qa-id="kilo-providers-custom-name"
							/>
						</Field>
						<Field>
							<FieldLabel>Package</FieldLabel>
							<Select
								items={PACKAGE_ITEMS}
								value={form.npm}
								onValueChange={(value) => {
									if (value == null) return;
									setForm((current) => ({ ...current, npm: value as CustomProviderPackage }));
								}}
							>
								<SelectTrigger className="w-full" data-qa-id="kilo-providers-custom-npm">
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
								placeholder="https://api.example.com/v1"
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
									setApiKeyChanged(true);
									setForm((current) => ({ ...current, apiKey: event.target.value }));
								}}
								data-qa-id="kilo-providers-custom-key"
							/>
						</Field>
						<Field>
							<FieldLabel>Headers</FieldLabel>
							<div className="flex flex-col gap-2">
								{form.headers.map((header, index) => (
									<div key={index} className="flex gap-2">
										<Input
											placeholder="Name"
											value={header.key}
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
										<Input
											placeholder="Value"
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
								))}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="self-start"
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
							</div>
						</Field>
						<Field>
							<FieldLabel>Models</FieldLabel>
							<div className="flex flex-col gap-3">
								{form.models.map((model, index) => (
									<div
										key={index}
										className="border-border flex flex-col gap-2 rounded-lg border p-3"
									>
										<div className="flex gap-2">
											<Input
												placeholder="Model ID"
												value={model.id}
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
											<Input
												placeholder="Name"
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
											{form.models.length > 1 ? (
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													aria-label="Remove model"
													onClick={() =>
														setForm((current) => ({
															...current,
															models: current.models.filter((_, rowIndex) => rowIndex !== index),
														}))
													}
												>
													<Trash2Icon />
												</Button>
											) : null}
										</div>
										<label className="flex items-center gap-2 text-sm">
											<Checkbox
												checked={model.reasoning}
												onCheckedChange={(checked) =>
													setForm((current) => ({
														...current,
														models: current.models.map((row, rowIndex) =>
															rowIndex === index ? { ...row, reasoning: checked === true } : row,
														),
													}))
												}
												data-qa-id={`kilo-providers-model-reasoning-${index}`}
											/>
											Reasoning
										</label>
										<label className="flex items-center gap-2 text-sm">
											<Checkbox
												checked={model.supportsImages}
												onCheckedChange={(checked) =>
													setForm((current) => ({
														...current,
														models: current.models.map((row, rowIndex) =>
															rowIndex === index
																? { ...row, supportsImages: checked === true }
																: row,
														),
													}))
												}
												data-qa-id={`kilo-providers-model-images-${index}`}
											/>
											Images
										</label>
									</div>
								))}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="self-start"
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
							</div>
						</Field>
						{localError || error ? <FieldError>{localError ?? error}</FieldError> : null}
					</FieldGroup>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={pending} data-qa-id="kilo-providers-custom-save">
							{pending ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
