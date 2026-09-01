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
import { ScrollArea } from "@anaconda-agentic-desktop/ui/components/scroll-area";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { LLAMA_SERVER_DOCS_URL } from "./constants.js";
import type { LocalServerSettings } from "./contract.js";
import { parseServerFlagRow, serverFlagsFromRows } from "./llama-flags.js";
import { parseMaxModels, parsePort } from "./parse-settings.js";

const DIALOG_CONTENT_CLASS_NAME =
	"max-h-[min(90vh,40rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl";
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

function draftFrom(settings: LocalServerSettings): {
	port: string;
	maxModels: string;
	serveOnLocalNetwork: boolean;
	flagRows: FlagRow[];
	advanced: boolean;
} {
	const llamaFlags = settings.llamaFlags ?? {};
	const flagRows = rowsFromFlags(llamaFlags);
	return {
		port: settings.port === undefined ? "" : String(settings.port),
		maxModels: settings.maxModels === undefined ? "" : String(settings.maxModels),
		serveOnLocalNetwork: Boolean(settings.serveOnLocalNetwork),
		flagRows,
		advanced: flagRows.length > 0,
	};
}

export function ServerSettingsDialog({
	settings,
	pending,
	error,
	onSave,
}: {
	settings: LocalServerSettings;
	pending: boolean;
	error?: string | undefined;
	onSave: (settings: LocalServerSettings) => Promise<void>;
}) {
	const sdk = useSdk("local-inference");
	const initial = draftFrom(settings);
	const [open, setOpen] = useState(false);
	const [port, setPort] = useState(initial.port);
	const [maxModels, setMaxModels] = useState(initial.maxModels);
	const [serveOnLocalNetwork, setServeOnLocalNetwork] = useState(initial.serveOnLocalNetwork);
	const [flagRows, setFlagRows] = useState(initial.flagRows);
	const [flagDraft, setFlagDraft] = useState<FlagRow>(emptyFlag);
	const [flagDraftError, setFlagDraftError] = useState<string | null>(null);
	const [advanced, setAdvanced] = useState(initial.advanced);
	const [localError, setLocalError] = useState<string | null>(null);
	const formError = localError ?? error;

	const reset = (next: LocalServerSettings) => {
		const draft = draftFrom(next);
		setPort(draft.port);
		setMaxModels(draft.maxModels);
		setServeOnLocalNetwork(draft.serveOnLocalNetwork);
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
		const parsed = parseServerFlagRow(flagDraft.key, flagDraft.value);
		if (!parsed.ok) {
			setFlagDraftError(parsed.error);
			return;
		}
		const result = serverFlagsFromRows([...flagRows, parsed]);
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
		const portResult = parsePort(port);
		if (!portResult.ok) {
			setLocalError(portResult.error);
			return;
		}
		const maxModelsResult = parseMaxModels(maxModels);
		if (!maxModelsResult.ok) {
			setLocalError(maxModelsResult.error);
			return;
		}
		const pendingFlags =
			flagDraft.key.trim() || flagDraft.value.trim()
				? [{ key: flagDraft.key.trim(), value: flagDraft.value.trim() }]
				: [];
		const flags = serverFlagsFromRows([...flagRows, ...pendingFlags]);
		if (!flags.ok) {
			setFlagDraftError(flags.error);
			setAdvanced(true);
			return;
		}
		setLocalError(null);
		setFlagDraftError(null);
		void onSave({
			...(portResult.value !== undefined ? { port: portResult.value } : {}),
			...(maxModelsResult.value !== undefined ? { maxModels: maxModelsResult.value } : {}),
			...(serveOnLocalNetwork ? { serveOnLocalNetwork: true } : {}),
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
				if (next) reset(settings);
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
									aria-label="Server settings"
									data-qa-id="local-provider-server-settings"
									onClick={(event) => event.stopPropagation()}
								/>
							}
						/>
					}
				>
					<Settings2Icon />
				</TooltipTrigger>
				<TooltipContent data-qa-id="local-provider-server-settings-tooltip">
					Server settings
				</TooltipContent>
			</Tooltip>
			<DialogContent
				className={DIALOG_CONTENT_CLASS_NAME}
				data-qa-id="local-provider-server-settings-dialog"
			>
				<form className="contents" onSubmit={submit}>
					<DialogHeader className="px-4 pt-4 pr-12">
						<DialogTitle>Server settings</DialogTitle>
						<DialogDescription>llama.cpp router and local server</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 overflow-y-auto px-4 py-4">
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="local-server-port">Port</FieldLabel>
								<Input
									id="local-server-port"
									type="number"
									inputMode="numeric"
									min={1}
									max={65_535}
									placeholder="Automatic"
									value={port}
									onChange={(event) => setPort(event.target.value)}
									data-qa-id="local-provider-server-port"
								/>
								<FieldDescription>
									Port for the OpenAI-compatible local server. Leave blank to pick a free port.
								</FieldDescription>
							</Field>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor="local-server-lan">Serve on local network</FieldLabel>
									<FieldDescription>
										Let other devices on this Wi-Fi or LAN use the API. Only enable this on a
										trusted network. You may need to allow incoming connections in the system
										firewall.
									</FieldDescription>
								</FieldContent>
								<Switch
									id="local-server-lan"
									checked={serveOnLocalNetwork}
									onCheckedChange={setServeOnLocalNetwork}
									aria-label="Serve on local network"
									data-qa-id="local-provider-server-lan"
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="local-server-max-models">Max loaded models</FieldLabel>
								<Input
									id="local-server-max-models"
									type="number"
									inputMode="numeric"
									min={1}
									max={64}
									placeholder="All registered models"
									value={maxModels}
									onChange={(event) => setMaxModels(event.target.value)}
									data-qa-id="local-provider-server-max-models"
								/>
								<FieldDescription>
									How many GGUF models the router may keep loaded at once. Saving restarts the
									server.
								</FieldDescription>
							</Field>
							<Collapsible open={advanced} onOpenChange={setAdvanced}>
								<div className="border-border overflow-hidden rounded-lg border">
									<CollapsibleTrigger
										type="button"
										className="group hover:bg-foreground/5 flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors"
										data-qa-id="local-provider-server-advanced"
									>
										<p className="text-sm font-medium">Advanced</p>
										<ChevronDownIcon className="text-muted-foreground size-4 transition-transform group-aria-expanded:rotate-180" />
									</CollapsibleTrigger>
									<CollapsibleContent>
										<Separator />
										<FieldSet className="gap-2 p-3">
											<FieldLegend className="sr-only">llama.cpp router flags</FieldLegend>
											<FieldDescription>
												Optional llama.cpp flags for the router process. See{" "}
												<a
													href={LLAMA_SERVER_DOCS_URL}
													onClick={(event) => {
														event.preventDefault();
														void sdk.shell
															.openExternal(LLAMA_SERVER_DOCS_URL)
															.catch(() => undefined);
													}}
													data-qa-id="local-provider-server-flag-docs"
												>
													the docs
													<ExternalLinkIcon className="ml-1 inline size-3" />
												</a>
											</FieldDescription>
											<div
												className="border-border overflow-hidden rounded-lg border"
												role="table"
												aria-label="llama.cpp router flags"
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
																			data-qa-id={`local-provider-server-flag-remove-${index}`}
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
															<FieldLabel htmlFor="local-server-flag-key" className="sr-only">
																Flag name
															</FieldLabel>
															<Input
																id="local-server-flag-key"
																placeholder="timeout"
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
																data-qa-id="local-provider-server-flag-key"
															/>
														</Field>
														<Field className="gap-0">
															<FieldLabel htmlFor="local-server-flag-value" className="sr-only">
																Flag value
															</FieldLabel>
															<Input
																id="local-server-flag-value"
																placeholder="3600"
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
																data-qa-id="local-provider-server-flag-value"
															/>
														</Field>
														<Button
															type="button"
															variant="outline"
															size="sm"
															className="w-full"
															disabled={!flagDraft.key.trim() || !flagDraft.value.trim()}
															onClick={addFlag}
															data-qa-id="local-provider-server-add-flag"
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
						<Button
							type="submit"
							disabled={pending}
							data-qa-id="local-provider-server-settings-save"
						>
							{pending ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
