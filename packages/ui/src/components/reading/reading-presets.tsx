import { useId, useState, type ReactNode } from "react";
import {
	CheckIcon,
	ChevronDownIcon,
	PencilIcon,
	SaveIcon,
	StarIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@kilo-desktop/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
import {
	READING_PRESET_LIMIT,
	READING_PRESET_NAME_MAX,
	activeReadingPreset,
	hasUnsavedReadingChanges,
	presetNameTaken,
	readingPresetSummary,
	type ReadingPreset,
	type ReadingPresetsState,
} from "@kilo-desktop/ui/lib/reading/presets";
import {
	readingThemeSwatches,
	resolveReadingTheme,
	type AppThemeSnapshot,
} from "@kilo-desktop/ui/lib/reading/reading-theme";
import type { ReadingSettings } from "@kilo-desktop/ui/lib/reading/settings";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { APP_THEMES } from "@kilo-desktop/ui/themes/app-themes";

import { useFocusLayer, useFocusPortalContainer } from "./focus-context";

/**
 * Saved reading presets as the Aa control shows them. The host owns the
 * presets (kilo.shell/reading-presets) and works out `unsaved`; every action
 * answers a promise so a dialog can show why it failed.
 */
export interface ReadingPresetsControl {
	readonly state: ReadingPresetsState;
	/** The live settings differ from the active preset (or from the defaults, with none active). */
	readonly unsaved: boolean;
	/** Applies a preset; null matches Settings → Appearance. */
	readonly apply: (id: string | null) => Promise<unknown>;
	readonly save: (name: string, makeDefault: boolean) => Promise<unknown>;
	readonly update: (id: string) => Promise<unknown>;
	readonly rename: (id: string, name: string) => Promise<unknown>;
	readonly remove: (id: string) => Promise<unknown>;
	readonly setDefault: (id: string | null) => Promise<unknown>;
}

export type ReadingPresetsDialog = "save" | "manage" | null;

/** The `kilo.shell/reading-presets` methods, as a window holds them. */
export interface ReadingPresetsMethods {
	readonly save: (input: { name: string; makeDefault?: boolean }) => Promise<ReadingPreset>;
	readonly apply: (input: { id: string | null }) => Promise<unknown>;
	readonly update: (input: { id: string }) => Promise<unknown>;
	readonly rename: (input: { id: string; name: string }) => Promise<unknown>;
	readonly remove: (input: { id: string }) => Promise<unknown>;
	readonly setDefault: (input: { id: string | null }) => Promise<unknown>;
}

/**
 * The control a host passes to the Aa button, over the presets domain
 * object. A host without one (browser mode) passes nothing and the header
 * keeps only Reset. `onSaved` lets the host confirm a save (a toast).
 */
export function readingPresetsControl({
	state,
	methods,
	live,
	onSaved,
}: {
	state: ReadingPresetsState;
	methods: ReadingPresetsMethods;
	live: ReadingSettings;
	onSaved?: (preset: ReadingPreset, isDefault: boolean) => void;
}): ReadingPresetsControl {
	return {
		state,
		unsaved: hasUnsavedReadingChanges(live, state),
		apply: (id) => methods.apply({ id }),
		save: async (name, makeDefault) => {
			const preset = await methods.save({ name, makeDefault });
			onSaved?.(preset, makeDefault);
			return preset;
		},
		update: (id) => methods.update({ id }),
		rename: (id, name) => methods.rename({ id, name }),
		remove: (id) => methods.remove({ id }),
		setDefault: (id) => methods.setDefault({ id }),
	};
}

/** The toast title confirming a save. */
export function readingPresetSavedTitle(preset: ReadingPreset, isDefault: boolean): string {
	return `Saved “${preset.name}”${isDefault ? " · Used when Kilo opens" : ""}`;
}

/** What the host's Reset does with presets: back to the active preset, else to the defaults. */
export function resetsToPreset(state: ReadingPresetsState | null | undefined): string | null {
	return state ? (activeReadingPreset(state)?.id ?? null) : null;
}

const messageOf = (reason: unknown, fallback: string) =>
	reason instanceof Error && reason.message ? reason.message : fallback;

/** One action at a time, with its failure kept for the open dialog. */
function usePresetAction() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = (operation: () => Promise<unknown>, onSuccess?: () => void) => {
		setError(null);
		setPending(true);
		void operation()
			.then(
				() => onSuccess?.(),
				(reason: unknown) => setError(messageOf(reason, "The reading preset action failed.")),
			)
			.finally(() => setPending(false));
	};
	return { pending, error, setError, run };
}

/** The app's theme and mode as Settings → Appearance names them ("Kilo · Dark"). */
function appThemeLabel(appTheme: AppThemeSnapshot): string {
	const name = APP_THEMES.find(({ id }) => id === appTheme.themeId)?.name ?? appTheme.themeId;
	return `${name} · ${appTheme.mode === "light" ? "Light" : "Dark"}`;
}

const HEADER_LINK =
	"text-primary-brand focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded px-1 text-xs font-medium outline-none hover:underline focus-visible:ring-2";

/**
 * The Reading panel header's preset controls: the presets menu button (named
 * after the active preset, with a dot while there are unsaved changes) and,
 * while there is something to save, a link: "Update" (overwrites the active
 * preset in one click) when a preset is active, else "Save…" (names a new
 * one). Saving the changes as a new preset stays in the menu. The menu
 * always starts with "App appearance", which goes back to following
 * Settings → Appearance (the standard reading settings, no preset active).
 */
export function ReadingPresetsHeader({
	presets,
	appTheme,
	onOpenDialog,
	qaId,
}: {
	presets: ReadingPresetsControl;
	appTheme: AppThemeSnapshot;
	onOpenDialog: (dialog: Exclude<ReadingPresetsDialog, null>) => void;
	qaId: string;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const container = useFocusPortalContainer();
	useFocusLayer(menuOpen);
	const { state, unsaved } = presets;
	const active = activeReadingPreset(state);
	const full = state.presets.length >= READING_PRESET_LIMIT;
	const matchesAppearance = !active && !unsaved;
	return (
		<>
			<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<DropdownMenuTrigger
					data-qa-id={`${qaId}-presets-trigger`}
					aria-label={
						active
							? `Reading preset: ${active.name}${unsaved ? " (unsaved changes)" : ""}`
							: `Reading presets${unsaved ? " (unsaved changes)" : ""}`
					}
					className="bg-muted text-foreground hover:bg-state-hover focus-visible:ring-ring/50 data-popup-open:bg-state-selected inline-flex h-6 max-w-32 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-2"
				>
					{unsaved ? (
						<span
							aria-hidden="true"
							data-qa-id={`${qaId}-presets-unsaved`}
							className="bg-primary-brand size-1.5 shrink-0 rounded-full"
						/>
					) : null}
					<span className="truncate">{active ? active.name : "Presets"}</span>
					<ChevronDownIcon aria-hidden="true" className="text-muted-foreground size-3 shrink-0" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="min-w-60"
					container={container ?? undefined}
					data-qa-id={`${qaId}-presets-menu`}
				>
					<DropdownMenuGroup>
						<DropdownMenuItem
							data-qa-id={`${qaId}-preset-apply-appearance`}
							aria-label="Apply App appearance"
							aria-description="Settings → Appearance: the app's theme, mode and text size"
							aria-current={matchesAppearance ? "true" : undefined}
							onClick={() => void presets.apply(null).catch(() => {})}
						>
							<span className="flex size-3.5 shrink-0 items-center justify-center">
								{matchesAppearance ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
							</span>
							<span className="min-w-0 flex-1 truncate">App appearance</span>
							<span className="text-muted-foreground shrink-0 text-xs">
								{appThemeLabel(appTheme)}
							</span>
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						{state.presets.length === 0 ? (
							<DropdownMenuItem disabled>No reading presets yet</DropdownMenuItem>
						) : null}
						{state.presets.map((preset) => {
							const isActive = preset.id === state.activeId;
							return (
								<DropdownMenuItem
									key={preset.id}
									data-qa-id={`${qaId}-preset-apply-${preset.id}`}
									aria-label={`Apply ${preset.name}`}
									aria-current={isActive ? "true" : undefined}
									onClick={() => void presets.apply(preset.id).catch(() => {})}
								>
									<span className="flex size-3.5 shrink-0 items-center justify-center">
										{isActive ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
									</span>
									<span className="min-w-0 flex-1 truncate">{preset.name}</span>
									{preset.id === state.defaultId ? (
										<Badge variant="secondary">Default</Badge>
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							data-qa-id={`${qaId}-preset-save-current`}
							disabled={full}
							onClick={() => onOpenDialog("save")}
						>
							Save current reading settings
						</DropdownMenuItem>
						<DropdownMenuItem
							data-qa-id={`${qaId}-preset-manage`}
							onClick={() => onOpenDialog("manage")}
						>
							Manage reading presets
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{active && unsaved ? (
				<button
					type="button"
					onClick={() => void presets.update(active.id).catch(() => {})}
					aria-label={`Update “${active.name}”`}
					data-qa-id={`${qaId}-preset-update`}
					className={HEADER_LINK}
				>
					<SaveIcon aria-hidden="true" className="size-3" />
					Update
				</button>
			) : unsaved && !full ? (
				<button
					type="button"
					onClick={() => onOpenDialog("save")}
					data-qa-id={`${qaId}-preset-save`}
					className={HEADER_LINK}
				>
					Save…
				</button>
			) : null}
		</>
	);
}

/** The swatch of the theme a preset paints with: its background with its accent. */
function PresetSwatch({
	settings,
	appTheme,
}: {
	settings: ReadingSettings;
	appTheme: AppThemeSnapshot;
}) {
	const resolved = resolveReadingTheme(settings, appTheme);
	const swatch = readingThemeSwatches(resolved.mode).find(({ id }) => id === resolved.themeId);
	return (
		<span
			aria-hidden="true"
			className="border-foreground/15 flex size-6 shrink-0 items-center justify-center rounded-full border"
			style={swatch ? { backgroundColor: swatch.background } : undefined}
		>
			<span
				className="size-2 rounded-full"
				style={swatch ? { backgroundColor: swatch.accent } : undefined}
			/>
		</span>
	);
}

function PresetAction({
	label,
	qaId,
	disabled,
	onClick,
	destructive = false,
	pressed,
	children,
}: {
	label: string;
	qaId: string;
	disabled: boolean;
	onClick: () => void;
	destructive?: boolean;
	pressed?: boolean;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						aria-pressed={pressed}
						data-qa-id={qaId}
						disabled={disabled}
						onClick={onClick}
						className={destructive ? "text-destructive hover:text-destructive" : undefined}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * The Save and Manage dialogs, and Manage's delete confirmation. Rendered
 * outside the Reading popover, so they outlive it; inside Focus they portal
 * into the reader's popup layer and hold Escape while open.
 */
export function ReadingPresetDialogs({
	presets,
	settings,
	appTheme,
	baseSize,
	dialog,
	onClose,
	qaId,
}: {
	presets: ReadingPresetsControl;
	settings: ReadingSettings;
	appTheme: AppThemeSnapshot;
	/** The surface's text size at step 0, so summaries match the panel's px. */
	baseSize: number;
	dialog: ReadingPresetsDialog;
	onClose: () => void;
	qaId: string;
}) {
	const [deleting, setDeleting] = useState<ReadingPreset | null>(null);
	const container = useFocusPortalContainer() ?? undefined;
	useFocusLayer(dialog !== null || deleting !== null);
	return (
		<>
			{dialog === "save" ? (
				<SavePresetDialog
					presets={presets}
					settings={settings}
					baseSize={baseSize}
					container={container}
					onClose={onClose}
					qaId={qaId}
				/>
			) : null}
			{dialog === "manage" ? (
				<ManagePresetsDialog
					presets={presets}
					appTheme={appTheme}
					baseSize={baseSize}
					container={container}
					hidden={deleting !== null}
					onDelete={setDeleting}
					onClose={onClose}
					qaId={qaId}
				/>
			) : null}
			{deleting ? (
				<DeletePresetDialog
					preset={deleting}
					presets={presets}
					container={container}
					onClose={() => setDeleting(null)}
					qaId={qaId}
				/>
			) : null}
		</>
	);
}

function SavePresetDialog({
	presets,
	settings,
	baseSize,
	container,
	onClose,
	qaId,
}: {
	presets: ReadingPresetsControl;
	settings: ReadingSettings;
	baseSize: number;
	container: HTMLElement | undefined;
	onClose: () => void;
	qaId: string;
}) {
	const fieldId = useId();
	const action = usePresetAction();
	const [name, setName] = useState("");
	const [makeDefault, setMakeDefault] = useState(false);
	const { pending } = action;
	const taken = name.trim() !== "" && presetNameTaken(presets.state.presets, name);
	const full = presets.state.presets.length >= READING_PRESET_LIMIT;
	const canSave = !pending && !taken && !full && name.trim() !== "";
	const summary = readingPresetSummary(settings, baseSize);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				container={container}
				showCloseButton={false}
				className="sm:max-w-md"
				data-qa-id={`${qaId}-preset-save-dialog`}
			>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						if (!canSave) return;
						action.run(() => presets.save(name.trim(), makeDefault), onClose);
					}}
				>
					<DialogHeader>
						<DialogTitle>Save current reading settings</DialogTitle>
						<DialogDescription>
							Save theme, text size, spacing and Focus options for reuse. Chat content is not saved.
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field data-invalid={taken || undefined}>
							<FieldLabel htmlFor={`${fieldId}-name`}>Preset name</FieldLabel>
							<Input
								id={`${fieldId}-name`}
								data-qa-id={`${qaId}-preset-name`}
								value={name}
								onChange={(event) => setName(event.target.value)}
								maxLength={READING_PRESET_NAME_MAX}
								aria-invalid={taken || undefined}
								disabled={pending}
								autoFocus
							/>
							{taken ? <FieldError>A preset with this name already exists.</FieldError> : null}
							{full ? (
								<FieldError>
									You can save up to {READING_PRESET_LIMIT} reading presets. Delete one first.
								</FieldError>
							) : null}
						</Field>
						<ul
							aria-label="What will be saved"
							className="flex flex-wrap gap-1.5"
							data-qa-id={`${qaId}-preset-summary`}
						>
							{summary.map((part) => (
								<li key={part}>
									<Badge variant="secondary">{part}</Badge>
								</li>
							))}
						</ul>
						<Field orientation="horizontal">
							<Checkbox
								id={`${fieldId}-default`}
								data-qa-id={`${qaId}-preset-default`}
								checked={makeDefault}
								onCheckedChange={setMakeDefault}
								disabled={pending}
							/>
							<FieldLabel htmlFor={`${fieldId}-default`}>Use when Kilo opens</FieldLabel>
						</Field>
					</FieldGroup>
					{action.error ? (
						<Alert variant="destructive">
							<AlertDescription>{action.error}</AlertDescription>
						</Alert>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							data-qa-id={`${qaId}-preset-save-cancel`}
							disabled={pending}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button type="submit" data-qa-id={`${qaId}-preset-save-confirm`} disabled={!canSave}>
							{pending ? "Saving…" : "Save preset"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ManagePresetsDialog({
	presets,
	appTheme,
	baseSize,
	container,
	hidden,
	onDelete,
	onClose,
	qaId,
}: {
	presets: ReadingPresetsControl;
	appTheme: AppThemeSnapshot;
	baseSize: number;
	container: HTMLElement | undefined;
	/** While the delete confirmation shows over it. */
	hidden: boolean;
	onDelete: (preset: ReadingPreset) => void;
	onClose: () => void;
	qaId: string;
}) {
	const action = usePresetAction();
	const [renaming, setRenaming] = useState<string | null>(null);
	const [name, setName] = useState("");
	const { pending } = action;
	const { presets: list, defaultId } = presets.state;
	const renameTaken =
		renaming !== null && name.trim() !== "" && presetNameTaken(list, name, renaming);
	const cancelRename = () => {
		setRenaming(null);
		action.setError(null);
	};
	return (
		<Dialog
			open={!hidden}
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				container={container}
				showCloseButton={false}
				className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
				data-qa-id={`${qaId}-preset-manage-dialog`}
			>
				<DialogHeader>
					<DialogTitle>Manage reading presets</DialogTitle>
					<DialogDescription>The starred preset is applied each time Kilo opens.</DialogDescription>
				</DialogHeader>
				<TooltipProvider>
					<ul
						aria-label="Reading presets"
						className="flex max-h-80 flex-col gap-1.5 overflow-y-auto"
					>
						{list.length === 0 ? (
							<li className="text-muted-foreground py-4 text-center text-sm">
								No reading presets yet
							</li>
						) : null}
						{list.map((preset) => {
							const isDefault = preset.id === defaultId;
							const defaultLabel = isDefault
								? "Stop applying when Kilo opens"
								: `Apply ${preset.name} when Kilo opens`;
							const editing = renaming === preset.id;
							return (
								<li
									key={preset.id}
									data-qa-id={`${qaId}-preset-row-${preset.id}`}
									className={cn(
										"border-border flex items-center gap-2 rounded-lg border px-2 py-1.5",
										editing && "border-ring",
									)}
								>
									<PresetAction
										label={defaultLabel}
										pressed={isDefault}
										qaId={`${qaId}-preset-set-default-${preset.id}`}
										disabled={pending}
										onClick={() =>
											action.run(() => presets.setDefault(isDefault ? null : preset.id))
										}
									>
										<StarIcon
											aria-hidden="true"
											className={cn(isDefault && "fill-current text-yellow-500")}
										/>
									</PresetAction>
									<PresetSwatch settings={preset.settings} appTheme={appTheme} />
									{editing ? (
										<form
											className="flex min-w-0 flex-1 items-center gap-1"
											onSubmit={(event) => {
												event.preventDefault();
												if (pending || !name.trim() || renameTaken) return;
												action.run(() => presets.rename(preset.id, name.trim()), cancelRename);
											}}
										>
											<Input
												aria-label="Preset name"
												aria-invalid={renameTaken || undefined}
												data-qa-id={`${qaId}-preset-rename-input`}
												className="h-7"
												value={name}
												onChange={(event) => setName(event.target.value)}
												maxLength={READING_PRESET_NAME_MAX}
												disabled={pending}
												autoFocus
												onFocus={(event) => event.target.select()}
												onKeyDown={(event) => {
													if (event.key !== "Escape") return;
													event.preventDefault();
													event.stopPropagation();
													if (!pending) cancelRename();
												}}
											/>
											<Button
												type="submit"
												variant="ghost"
												size="icon-sm"
												aria-label="Save name"
												data-qa-id={`${qaId}-preset-rename-save`}
												disabled={pending || !name.trim() || renameTaken}
											>
												<CheckIcon />
											</Button>
											<PresetAction
												label="Cancel rename"
												qaId={`${qaId}-preset-rename-cancel`}
												disabled={pending}
												onClick={cancelRename}
											>
												<XIcon />
											</PresetAction>
										</form>
									) : (
										<>
											<div className="flex min-w-0 flex-1 flex-col">
												<span className="truncate text-sm font-medium">{preset.name}</span>
												<span
													className="text-muted-foreground truncate text-xs"
													data-qa-id={`${qaId}-preset-row-summary-${preset.id}`}
												>
													{readingPresetSummary(preset.settings, baseSize).join(" · ")}
												</span>
											</div>
											<div className="flex shrink-0 items-center gap-0.5">
												<PresetAction
													label={`Update ${preset.name} from current settings`}
													qaId={`${qaId}-preset-update-${preset.id}`}
													disabled={pending || renaming !== null}
													onClick={() => action.run(() => presets.update(preset.id))}
												>
													<SaveIcon />
												</PresetAction>
												<PresetAction
													label={`Rename ${preset.name}`}
													qaId={`${qaId}-preset-rename-${preset.id}`}
													disabled={pending || renaming !== null}
													onClick={() => {
														action.setError(null);
														setRenaming(preset.id);
														setName(preset.name);
													}}
												>
													<PencilIcon />
												</PresetAction>
												<PresetAction
													destructive
													label={`Delete ${preset.name}`}
													qaId={`${qaId}-preset-delete-${preset.id}`}
													disabled={pending || renaming !== null}
													onClick={() => onDelete(preset)}
												>
													<Trash2Icon />
												</PresetAction>
											</div>
										</>
									)}
								</li>
							);
						})}
					</ul>
				</TooltipProvider>
				{renameTaken ? (
					<p className="text-destructive text-xs" role="alert">
						A preset with this name already exists.
					</p>
				) : null}
				{action.error ? (
					<Alert variant="destructive">
						<AlertDescription>{action.error}</AlertDescription>
					</Alert>
				) : null}
				<DialogFooter>
					<Button
						variant="outline"
						data-qa-id={`${qaId}-preset-manage-done`}
						disabled={pending}
						onClick={onClose}
					>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function DeletePresetDialog({
	preset,
	presets,
	container,
	onClose,
	qaId,
}: {
	preset: ReadingPreset;
	presets: ReadingPresetsControl;
	container: HTMLElement | undefined;
	onClose: () => void;
	qaId: string;
}) {
	const action = usePresetAction();
	const { pending } = action;
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<AlertDialogContent container={container} data-qa-id={`${qaId}-preset-delete-dialog`}>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {preset.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						This removes the saved reading preset. This cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{action.error ? (
					<Alert variant="destructive">
						<AlertDescription>{action.error}</AlertDescription>
					</Alert>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel data-qa-id={`${qaId}-preset-delete-cancel`} disabled={pending}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						data-qa-id={`${qaId}-preset-delete-confirm`}
						disabled={pending}
						onClick={() => action.run(() => presets.remove(preset.id), onClose)}
					>
						{pending ? "Deleting…" : "Delete preset"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
