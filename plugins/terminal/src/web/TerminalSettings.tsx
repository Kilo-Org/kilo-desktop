import { useState } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Alert, AlertDescription } from "@kilo-desktop/ui/components/alert";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { FieldError } from "@kilo-desktop/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";

import {
	DEFAULT_TERMINAL_SETTINGS,
	TERMINAL_PROFILE_SOURCE_LABELS,
	Terminals,
	type CustomTerminalProfile,
	type TerminalProfile,
	type TerminalSettings as TerminalSettingsValue,
} from "../contracts/index.js";
import { CustomProfileForm } from "./CustomProfileForm.js";
import { draftFromProfile, emptyProfileDraft, type ProfileDraft } from "./profile-draft.js";

/** The select's value for "no default": main picks a shell itself. */
const AUTOMATIC_PROFILE = "automatic";

const NO_PROFILES: TerminalProfile[] = [];
const selectProfiles = (state: { profiles: TerminalProfile[] }) => state.profiles;
const selectSettings = (state: { settings: TerminalSettingsValue }) => state.settings;

interface DefaultOption {
	readonly value: string;
	readonly label: string;
	readonly available: boolean;
}

function defaultOptions(
	profiles: readonly TerminalProfile[],
	defaultId: string | null,
): DefaultOption[] {
	const options: DefaultOption[] = [
		{ value: AUTOMATIC_PROFILE, label: "Automatic", available: true },
		...profiles.filter((profile) => profile.available).map(toOption),
		...profiles.filter((profile) => !profile.available).map(toOption),
	];
	// A default whose shell is no longer detected still needs a label in the trigger.
	if (defaultId !== null && !options.some((option) => option.value === defaultId)) {
		options.push({ value: defaultId, label: defaultId, available: false });
	}
	return options;
}

function toOption(profile: TerminalProfile): DefaultOption {
	return { value: profile.id, label: profile.label, available: profile.available };
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

/**
 * Settings → Terminal: the shell new terminals run, and the person's own
 * profiles. Everything shown is derived from `terminals`' state; changes go
 * straight to main and apply the next time a shell starts.
 */
export function TerminalSettings() {
	const terminals = useDomainObject(Terminals);
	if (!terminals) {
		return (
			<div className="flex min-w-0 flex-col gap-6">
				<SettingsPageHeader />
				<Alert data-qa-id="terminal-settings-unavailable">
					<AlertDescription>Terminal settings are available in the desktop app.</AlertDescription>
				</Alert>
			</div>
		);
	}
	return <TerminalSettingsContent />;
}

interface Editing {
	readonly title: string;
	readonly draft: ProfileDraft;
}

function TerminalSettingsContent() {
	const terminals = useDomainObject(Terminals);
	const profiles = useDomainObjectState(Terminals, selectProfiles) ?? NO_PROFILES;
	const settings = useDomainObjectState(Terminals, selectSettings) ?? DEFAULT_TERMINAL_SETTINGS;
	const [pending, setPending] = useState(false);
	const [rescanning, setRescanning] = useState(false);
	const [editing, setEditing] = useState<Editing | null>(null);
	const [error, setError] = useState<string | null>(null);

	const options = defaultOptions(profiles, settings.defaultProfileId);
	const selected = settings.defaultProfileId ?? AUTOMATIC_PROFILE;
	const missingDefault =
		settings.defaultProfileId !== null &&
		profiles.length > 0 &&
		!profiles.some((profile) => profile.id === settings.defaultProfileId && profile.available)
			? (options.find((option) => option.value === settings.defaultProfileId)?.label ??
				settings.defaultProfileId)
			: null;

	const save = async (patch: Partial<TerminalSettingsValue>): Promise<boolean> => {
		if (!terminals) return false;
		setPending(true);
		setError(null);
		try {
			await terminals.methods.updateSettings(patch);
			return true;
		} catch (saveError) {
			setError(errorMessage(saveError, "Could not save the setting."));
			return false;
		} finally {
			setPending(false);
		}
	};
	const rescan = () => {
		if (!terminals) return;
		setRescanning(true);
		setError(null);
		void terminals.methods
			.refreshProfiles(undefined)
			.catch((rescanError: unknown) =>
				setError(errorMessage(rescanError, "Could not look for shells.")),
			)
			.finally(() => setRescanning(false));
	};
	const saveProfile = async (profile: CustomTerminalProfile) => {
		const exists = settings.customProfiles.some((candidate) => candidate.id === profile.id);
		const customProfiles = exists
			? settings.customProfiles.map((candidate) =>
					candidate.id === profile.id ? profile : candidate,
				)
			: [...settings.customProfiles, profile];
		if (await save({ customProfiles })) setEditing(null);
	};

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="terminal-settings">
			<SettingsPageHeader />
			<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="terminal-default-profile">Default shell</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							New terminals, and terminals you restart, run this shell.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Button
							variant="outline"
							size="sm"
							disabled={rescanning}
							onClick={rescan}
							data-qa-id="terminal-rescan"
						>
							{rescanning ? (
								<Spinner data-icon="inline-start" />
							) : (
								<RefreshCwIcon data-icon="inline-start" />
							)}
							Rescan shells
						</Button>
						<Select
							value={selected}
							items={options}
							disabled={pending}
							onValueChange={(value) => {
								if (value === null || value === selected) return;
								void save({ defaultProfileId: value === AUTOMATIC_PROFILE ? null : value });
							}}
						>
							<SelectTrigger
								id="terminal-default-profile"
								aria-label="Default shell"
								className="w-52"
								data-qa-id="terminal-default-profile"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{options.map((option) => (
										<SelectItem
											key={option.value}
											value={option.value}
											disabled={!option.available}
											data-qa-id={`terminal-profile-option-${option.value}`}
										>
											<span className="truncate">{option.label}</span>
											{option.available ? null : <Badge variant="outline">Not found</Badge>}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</div>
			{missingDefault === null ? null : (
				<Alert data-qa-id="terminal-default-missing">
					<AlertDescription>
						{missingDefault} wasn't found, so new terminals start a shell automatically.
					</AlertDescription>
				</Alert>
			)}
			<section className="flex min-w-0 flex-col gap-3" aria-labelledby="terminal-custom-profiles">
				<div className="flex items-center justify-between gap-3">
					<h3 id="terminal-custom-profiles" className="text-sm font-medium">
						Your profiles
					</h3>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							setEditing({ title: "Add profile", draft: emptyProfileDraft(crypto.randomUUID()) })
						}
						data-qa-id="terminal-add-profile"
					>
						<PlusIcon data-icon="inline-start" />
						Add profile
					</Button>
				</div>
				{settings.customProfiles.length === 0 ? (
					<Empty className="border" data-qa-id="terminal-custom-profiles-empty">
						<EmptyHeader>
							<EmptyTitle>No profiles yet</EmptyTitle>
							<EmptyDescription>
								Add one to run a shell with its own arguments or environment.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<div className="flex flex-col gap-2">
						{settings.customProfiles.map((profile) => (
							<CustomProfileRow
								key={profile.id}
								profile={profile}
								found={profiles.find((candidate) => candidate.id === profile.id)}
								disabled={pending}
								onEdit={() =>
									setEditing({ title: "Edit profile", draft: draftFromProfile(profile) })
								}
								onRemove={() =>
									void save({
										customProfiles: settings.customProfiles.filter(
											(candidate) => candidate.id !== profile.id,
										),
									})
								}
							/>
						))}
					</div>
				)}
			</section>
			{error ? <FieldError className="text-sm">{error}</FieldError> : null}
			{editing ? (
				<CustomProfileForm
					title={editing.title}
					initialDraft={editing.draft}
					pending={pending}
					onCancel={() => setEditing(null)}
					onSave={(profile) => void saveProfile(profile)}
				/>
			) : null}
		</div>
	);
}

interface CustomProfileRowProps {
	readonly profile: CustomTerminalProfile;
	/** What detection made of it; undefined until detection settles. */
	readonly found: TerminalProfile | undefined;
	readonly disabled: boolean;
	readonly onEdit: () => void;
	readonly onRemove: () => void;
}

function CustomProfileRow({ profile, found, disabled, onEdit, onRemove }: CustomProfileRowProps) {
	const shell = profile.path ?? TERMINAL_PROFILE_SOURCE_LABELS[profile.source!];
	return (
		<Item variant="outline" data-qa-id="terminal-custom-profile">
			<ItemContent className="min-w-0">
				<ItemTitle>
					{profile.label}
					{found && !found.available ? <Badge variant="outline">Not found</Badge> : null}
				</ItemTitle>
				<ItemDescription className="truncate font-mono">
					{[shell, ...(profile.args ?? [])].join(" ")}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Edit ${profile.label}`}
					disabled={disabled}
					onClick={onEdit}
				>
					<PencilIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Remove ${profile.label}`}
					disabled={disabled}
					onClick={onRemove}
				>
					<Trash2Icon />
				</Button>
			</ItemActions>
		</Item>
	);
}
