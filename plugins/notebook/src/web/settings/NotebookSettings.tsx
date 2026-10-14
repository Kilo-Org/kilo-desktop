import {
	KiloAuthGate,
	SettingsPageHeader,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@kilo-desktop/sdk-react";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";

import {
	DEFAULT_NOTEBOOK_SETTINGS,
	type NotebookService,
	type NotebookSettings as NotebookSettingsValue,
} from "../../contracts/schemas.js";

interface SettingRowProps {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly onCheckedChange: (checked: boolean) => void;
}

function SettingRow({
	id,
	title,
	description,
	checked,
	disabled,
	onCheckedChange,
}: SettingRowProps) {
	// Wrapped like the Local Model Server's Runtime rows: `divide-y` draws on the
	// wrapper because the row's own transparent border would hide it.
	return (
		<div>
			<SummaryCard.Row>
				<SummaryCard.Content>
					<SummaryCard.Title>
						<label htmlFor={id}>{title}</label>
					</SummaryCard.Title>
					<SummaryCard.Description>{description}</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions>
					<Switch
						id={id}
						checked={checked}
						disabled={disabled}
						onCheckedChange={onCheckedChange}
						aria-label={title}
						data-qa-id={id}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</div>
	);
}

/**
 * Notebooks settings section (plugin.json `contributes.settings`). Embedded
 * notebooks require a Kilo account (DESK-3152), so the page sits behind the
 * same sign-in gate as the Conda Environments page.
 */
export function NotebookSettings() {
	return (
		<KiloAuthGate
			featureId="notebook"
			featureName="Notebooks"
			pendingFallback={<SettingsPageHeader />}
		>
			<NotebookSettingsContent />
		</KiloAuthGate>
	);
}

function NotebookSettingsContent() {
	const sdk = useSdk<NotebookService>("notebook");
	const settingsQuery = useSdkQuery(sdk, "getSettings");
	const updateSettings = useSdkMutation(sdk, "updateSettings", { invalidates: ["getSettings"] });
	const settings = settingsQuery.data ?? DEFAULT_NOTEBOOK_SETTINGS;
	const disabled = settingsQuery.isPending || updateSettings.isPending;
	const update = (patch: Partial<NotebookSettingsValue>) => updateSettings.mutate(patch);
	const error = settingsQuery.error ?? updateSettings.error;

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="notebook-settings">
			<SettingsPageHeader />
			<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
				<div className="divide-border divide-y">
					<SettingRow
						id="notebook-auto-create-environment"
						title="Automatically create environment.yml"
						description="Give new notebooks a shared conda environment in their workspace."
						checked={settings.autoCreateEnvironmentFile}
						disabled={disabled}
						onCheckedChange={(checked) => update({ autoCreateEnvironmentFile: checked })}
					/>
					<SettingRow
						id="notebook-trust-new-notebooks"
						title="Trust new notebooks"
						description="Skip the dependency approval prompt for new notebooks."
						checked={settings.trustNewNotebooks}
						disabled={disabled}
						onCheckedChange={(checked) => update({ trustNewNotebooks: checked })}
					/>
				</div>
			</div>
			{error ? <FieldError className="text-sm">{error.message}</FieldError> : null}
		</div>
	);
}
