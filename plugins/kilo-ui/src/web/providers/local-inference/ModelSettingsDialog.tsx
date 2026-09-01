import { useState, type FormEvent, type KeyboardEvent } from "react";
import {
	ChevronDownIcon,
	ExternalLinkIcon,
	PlusIcon,
	Settings2Icon,
	Trash2Icon,
} from "lucide-react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@anaconda-agentic-desktop/ui/components/input-group";
import { ScrollArea } from "@anaconda-agentic-desktop/ui/components/scroll-area";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Slider } from "@anaconda-agentic-desktop/ui/components/slider";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { LLAMA_SERVER_DOCS_URL } from "./constants.js";
import type { LocalModel, LocalModelSettings } from "./contract.js";
import { llamaFlagsFromRows, parseLlamaFlagRow } from "./llama-flags.js";
import {
	clampTemperature,
	parseContextLength,
	parseMaxResponseTokens,
	temperatureFromSlider,
} from "./parse-settings.js";

const DIALOG_CONTENT_CLASS_NAME =
	"max-h-[min(90vh,40rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl";
const DEFAULT_TEMPERATURE = 0.8;
const FLAG_ROW_LAYOUT =
	"grid min-w-0 grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.5fr)_3.5rem] items-center gap-2";

type FlagRow = { rowID: string; key: string; value: string };

function emptyFlag(): FlagRow {
	return { rowID: crypto.randomUUID(), key: "", value: "" };
}

function rowsFromFlags(flags: Readonly<Record<string, string>>): FlagRow[] {
	return Object.keys(flags)
		.toSorted()
		.map((key) => ({ rowID: crypto.randomUUID(), key, value: flags[key] ?? "" }));
}

function draftFrom(model: LocalModel): {
	temperature: number | undefined;
	contextLength: string;
	maxResponseTokens: string;
	includeKiloContext: boolean;
	flagRows: FlagRow[];
	advanced: boolean;
} {
	const settings = model.settings;
	const llamaFlags = settings?.llamaFlags ?? {};
	const flagRows = rowsFromFlags(llamaFlags);
	return {
		temperature: settings?.temperature,
		contextLength: settings?.contextLength === undefined ? "" : String(settings.contextLength),
		maxResponseTokens:
			settings?.maxResponseTokens === undefined ? "" : String(settings.maxResponseTokens),
		includeKiloContext: settings?.includeKiloContext === true,
		flagRows,
		advanced: flagRows.length > 0,
	};
}

export function ModelSettingsDialog({
	model,
	pending,
	error,
	onSave,
}: {
	model: LocalModel;
	pending: boolean;
	error?: string | undefined;
	onSave: (settings: LocalModelSettings) => Promise<void>;
}) {
	const sdk = useSdk("local-inference");
	const initial = draftFrom(model);
	const [open, setOpen] = useState(false);
	const [temperature, setTemperature] = useState(initial.temperature);
	const [contextLength, setContextLength] = useState(initial.contextLength);
	const [maxResponseTokens, setMaxResponseTokens] = useState(initial.maxResponseTokens);
	const [includeKiloContext, setIncludeKiloContext] = useState(initial.includeKiloContext);
	const [flagRows, setFlagRows] = useState(initial.flagRows);
	const [flagDraft, setFlagDraft] = useState<FlagRow>(emptyFlag);
	const [flagDraftError, setFlagDraftError] = useState<string | null>(null);
	const [advanced, setAdvanced] = useState(initial.advanced);
	const [localError, setLocalError] = useState<string | null>(null);
	const formError = localError ?? error;

	const reset = (next: LocalModel) => {
		const draft = draftFrom(next);
		setTemperature(draft.temperature);
		setContextLength(draft.contextLength);
		setMaxResponseTokens(draft.maxResponseTokens);
		setIncludeKiloContext(draft.includeKiloContext);
		setFlagRows(draft.flagRows);
		setFlagDraft(emptyFlag());
		setFlagDraftError(null);
		setAdvanced(draft.advanced);
		setLocalError(null);
	};

	const close = () => {
		if (pending) return;
		setOpen(false);
	};

	const addFlag = () => {
		const parsed = parseLlamaFlagRow(flagDraft.key, flagDraft.value);
		if (!parsed.ok) {
			setFlagDraftError(parsed.error);
			return;
		}
		const result = llamaFlagsFromRows([...flagRows, parsed]);
		if (!result.ok) {
			setFlagDraftError(result.error);
			return;
		}
		setFlagRows((current) => [...current, { ...flagDraft, key: parsed.key, value: parsed.value }]);
		setFlagDraft(emptyFlag());
		setFlagDraftError(null);
	};

	const submitFlagDraft = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		addFlag();
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const contextResult = parseContextLength(contextLength);
		if (!contextResult.ok) {
			setLocalError(contextResult.error);
			return;
		}
		const maxTokensResult = parseMaxResponseTokens(maxResponseTokens);
		if (!maxTokensResult.ok) {
			setLocalError(maxTokensResult.error);
			return;
		}
		const pending =
			flagDraft.key.trim() || flagDraft.value.trim()
				? [{ key: flagDraft.key.trim(), value: flagDraft.value.trim() }]
				: [];
		const flags = llamaFlagsFromRows([...flagRows, ...pending]);
		if (!flags.ok) {
			setFlagDraftError(flags.error);
			setAdvanced(true);
			return;
		}
		setLocalError(null);
		setFlagDraftError(null);
		void onSave({
			...(temperature !== undefined ? { temperature: clampTemperature(temperature) } : {}),
			...(contextResult.value !== undefined ? { contextLength: contextResult.value } : {}),
			...(maxTokensResult.value !== undefined ? { maxResponseTokens: maxTokensResult.value } : {}),
			...(includeKiloContext ? { includeKiloContext: true } : {}),
			...(Object.keys(flags.flags).length > 0 ? { llamaFlags: flags.flags } : {}),
		}).then(
			() => setOpen(false),
			() => undefined,
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && pending) return;
				if (next) reset(model);
				setOpen(next);
			}}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<DialogTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={`Settings for ${model.name}`}
									data-qa-id={`local-provider-settings-${model.id}`}
								/>
							}
						/>
					}
				>
					<Settings2Icon />
				</TooltipTrigger>
				<TooltipContent data-qa-id="local-provider-settings-tooltip">Model settings</TooltipContent>
			</Tooltip>
			<DialogContent
				className={DIALOG_CONTENT_CLASS_NAME}
				data-qa-id="local-provider-settings-dialog"
			>
				<form className="contents" onSubmit={submit}>
					<DialogHeader className="px-4 pt-4 pr-12">
						<DialogTitle>Model settings</DialogTitle>
						<DialogDescription className="truncate">{model.name}</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 overflow-y-auto px-4 py-4">
						<FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`local-model-kilo-context-${model.id}`}>
										Kilo context and tools
									</FieldLabel>
									<FieldDescription>
										Off by default so local models stay fast. Turn on to send Kilo's coding prompt
										and tools.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`local-model-kilo-context-${model.id}`}
									checked={includeKiloContext}
									onCheckedChange={setIncludeKiloContext}
									aria-label="Kilo context and tools"
									data-qa-id="local-provider-settings-kilo-context"
								/>
							</Field>
							<Field>
								<FieldContent className="flex-row items-center justify-between gap-3">
									<FieldLabel htmlFor={`local-model-temperature-override-${model.id}`}>
										Temperature
									</FieldLabel>
									<div className="flex items-center gap-2">
										{temperature === undefined ? null : (
											<Input
												id={`local-model-temperature-value-${model.id}`}
												type="number"
												inputMode="decimal"
												min={0}
												max={2}
												step={0.1}
												value={temperature.toFixed(1)}
												onChange={(event) => {
													const next = Number(event.target.value);
													if (Number.isFinite(next)) setTemperature(clampTemperature(next));
												}}
												className="w-16 shrink-0 [appearance:textfield] text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
												aria-label="Temperature"
												data-qa-id="local-provider-settings-temperature"
											/>
										)}
										<Switch
											id={`local-model-temperature-override-${model.id}`}
											checked={temperature !== undefined}
											onCheckedChange={(checked) =>
												setTemperature(checked ? DEFAULT_TEMPERATURE : undefined)
											}
											aria-label="Override temperature"
											data-qa-id="local-provider-settings-temperature-override"
										/>
									</div>
								</FieldContent>
								{temperature === undefined ? (
									<FieldDescription>Using the model's default temperature.</FieldDescription>
								) : (
									<>
										<Slider
											min={0}
											max={2}
											step={0.1}
											value={temperature}
											onValueChange={(value) => {
												const next = temperatureFromSlider(value);
												if (next !== undefined) setTemperature(next);
											}}
											aria-label="Temperature"
										/>
										<FieldDescription>0.0 is deterministic. 2.0 is more random.</FieldDescription>
									</>
								)}
							</Field>
							<Field>
								<FieldLabel htmlFor={`local-model-context-${model.id}`}>Context length</FieldLabel>
								<InputGroup>
									<InputGroupInput
										id={`local-model-context-${model.id}`}
										type="number"
										inputMode="numeric"
										min={256}
										max={1_048_576}
										step={256}
										placeholder="Model default"
										value={contextLength}
										onChange={(event) => setContextLength(event.target.value)}
										data-qa-id="local-provider-settings-context"
									/>
									<InputGroupAddon align="inline-end">
										<InputGroupText>tokens</InputGroupText>
									</InputGroupAddon>
								</InputGroup>
								<FieldDescription>Changing this reloads the model.</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor={`local-model-max-tokens-${model.id}`}>
									Maximum response length
								</FieldLabel>
								<InputGroup>
									<InputGroupInput
										id={`local-model-max-tokens-${model.id}`}
										type="number"
										inputMode="numeric"
										min={1}
										max={1_048_576}
										step={1}
										placeholder="Default"
										value={maxResponseTokens}
										onChange={(event) => setMaxResponseTokens(event.target.value)}
										data-qa-id="local-provider-settings-max-tokens"
									/>
									<InputGroupAddon align="inline-end">
										<InputGroupText>tokens</InputGroupText>
									</InputGroupAddon>
								</InputGroup>
								<FieldDescription className="text-nowrap">
									Leave blank to let the model decide.
								</FieldDescription>
							</Field>
							<Collapsible open={advanced} onOpenChange={setAdvanced}>
								<div className="border-border overflow-hidden rounded-lg border">
									<CollapsibleTrigger
										type="button"
										className="group hover:bg-foreground/5 flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors"
										data-qa-id="local-provider-settings-advanced"
									>
										<p className="text-sm font-medium">Advanced</p>
										<ChevronDownIcon className="text-muted-foreground size-4 transition-transform group-aria-expanded:rotate-180" />
									</CollapsibleTrigger>
									<CollapsibleContent>
										<Separator />
										<FieldSet className="gap-2 p-3">
											<FieldLegend className="sr-only">llama.cpp flags</FieldLegend>
											<FieldDescription>
												Optional llama.cpp flags for this model. See{" "}
												<a
													href={LLAMA_SERVER_DOCS_URL}
													onClick={(event) => {
														event.preventDefault();
														void sdk.shell
															.openExternal(LLAMA_SERVER_DOCS_URL)
															.catch(() => undefined);
													}}
													data-qa-id="local-provider-settings-flag-docs"
												>
													the docs
													<ExternalLinkIcon className="ml-1 inline size-3" />
												</a>
											</FieldDescription>
											<div
												className="border-border overflow-hidden rounded-lg border"
												role="table"
												aria-label="llama.cpp flags"
											>
												<div
													className={`${FLAG_ROW_LAYOUT} border-border bg-foreground/3 text-muted-foreground border-b px-2.5 py-2 text-xs font-medium`}
													role="row"
												>
													<span role="columnheader">Name</span>
													<span role="columnheader">Value</span>
													<span className="sr-only" role="columnheader">
														Actions
													</span>
												</div>
												{flagRows.length > 0 ? (
													<ScrollArea
														className="border-border border-b"
														style={{ height: Math.min(flagRows.length, 4) * 36 }}
													>
														<div className="divide-border divide-y" role="rowgroup">
															{flagRows.map((flag, index) => (
																<div
																	key={flag.rowID}
																	className={`${FLAG_ROW_LAYOUT} min-h-9 px-2.5 [content-visibility:auto]`}
																	role="row"
																>
																	<span
																		className="truncate font-mono text-xs"
																		role="cell"
																		title={flag.key}
																	>
																		{flag.key}
																	</span>
																	<span
																		className="truncate font-mono text-xs"
																		role="cell"
																		title={flag.value}
																	>
																		{flag.value}
																	</span>
																	<div className="flex justify-center" role="cell">
																		<Button
																			type="button"
																			variant="ghost"
																			size="icon-xs"
																			aria-label={`Remove flag ${index + 1}`}
																			onClick={() =>
																				setFlagRows((current) =>
																					current.filter((_, rowIndex) => rowIndex !== index),
																				)
																			}
																			data-qa-id={`local-provider-settings-flag-remove-${index}`}
																		>
																			<Trash2Icon />
																		</Button>
																	</div>
																</div>
															))}
														</div>
													</ScrollArea>
												) : null}
												<Field data-invalid={Boolean(flagDraftError)} className="p-2.5">
													<div className={FLAG_ROW_LAYOUT}>
														<Field className="gap-0">
															<FieldLabel
																htmlFor={`local-model-flag-key-${model.id}`}
																className="sr-only"
															>
																Flag name
															</FieldLabel>
															<Input
																id={`local-model-flag-key-${model.id}`}
																placeholder="n-gpu-layers"
																value={flagDraft.key}
																aria-invalid={Boolean(flagDraftError) || undefined}
																onChange={(event) => {
																	setFlagDraft((current) => ({
																		...current,
																		key: event.target.value,
																	}));
																	setFlagDraftError(null);
																}}
																onKeyDown={submitFlagDraft}
																data-qa-id="local-provider-settings-flag-key"
															/>
														</Field>
														<Field className="gap-0">
															<FieldLabel
																htmlFor={`local-model-flag-value-${model.id}`}
																className="sr-only"
															>
																Flag value
															</FieldLabel>
															<Input
																id={`local-model-flag-value-${model.id}`}
																placeholder="99"
																value={flagDraft.value}
																aria-invalid={Boolean(flagDraftError) || undefined}
																onChange={(event) => {
																	setFlagDraft((current) => ({
																		...current,
																		value: event.target.value,
																	}));
																	setFlagDraftError(null);
																}}
																onKeyDown={submitFlagDraft}
																data-qa-id="local-provider-settings-flag-value"
															/>
														</Field>
														<Button
															type="button"
															variant="outline"
															size="sm"
															className="w-full"
															disabled={!flagDraft.key.trim() || !flagDraft.value.trim()}
															onClick={addFlag}
															data-qa-id="local-provider-settings-add-flag"
														>
															<PlusIcon data-icon="inline-start" />
															Add
														</Button>
													</div>
													{flagDraftError ? <FieldError>{flagDraftError}</FieldError> : null}
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
						<Button type="button" variant="outline" disabled={pending} onClick={close}>
							Cancel
						</Button>
						<Button type="submit" disabled={pending} data-qa-id="local-provider-settings-save">
							{pending ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
