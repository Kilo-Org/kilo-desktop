import { useId, useState } from "react";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { DEFAULT_WORKSPACE_IDENTITY_COLOR, type NewFolderFormProps } from "../../contracts";
import { FILLED_INPUT_CLASS, FILLED_SWATCH_CLASS } from "./filled-styles";
import { joinFolderPath } from "./folder-path";
import { LocationPicker } from "./LocationPicker";
import { useNewFolderServices } from "./new-folder-context";
import { useReportDraft } from "./workspace-source-host";
import { errorMessage, WorkspaceErrorAlert } from "./WorkspaceErrorAlert";
import { WorkspaceIdentityColorPicker } from "./WorkspaceIdentityColorPicker";

/**
 * The details screen for a workspace whose folder is made fresh at
 * `<location>/<name>` (a clone): the workspace's name doubles as the
 * folder's, and the location starts at the last one used. Presented through
 * the host, like any source screen.
 */
export function NewFolderForm({
	description,
	choice,
	summary,
	leadingField,
	suggestedName = "",
	ready = true,
	pendingLabel,
	errorTitle,
	create,
}: NewFolderFormProps) {
	const services = useNewFolderServices();
	const filled = services.appearance === "filled";
	const nameId = useId();
	const [typedName, setTypedName] = useState<string | null>(null);
	const name = typedName ?? suggestedName;
	const folderName = name.trim();
	const [color, setColor] = useState<string>(DEFAULT_WORKSPACE_IDENTITY_COLOR);
	const [chosenLocation, setChosenLocation] = useState<string | null>(null);
	const location = chosenLocation ?? services.defaultLocation;
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<{ title: string; message: string } | null>(null);
	const canSubmit = ready && folderName !== "" && location !== null && !pending;
	useReportDraft(services.onDraft, {
		name: folderName,
		color,
		folders: location && folderName ? [joinFolderPath(location, folderName)] : [],
	});

	const chooseLocation = async () => {
		setError(null);
		try {
			const picked = await services.pickLocation(location);
			if (picked) setChosenLocation(picked);
		} catch (reason) {
			setError({
				title: "Couldn't open the folder picker",
				message: errorMessage(reason, "Try again, or restart the app."),
			});
		}
	};

	const submit = async () => {
		if (!canSubmit || location === null) return;
		setPending(true);
		setError(null);
		try {
			const workspace = await create({ name: folderName, color, parentPath: location });
			services.onCreated(workspace);
		} catch (reason) {
			setError({ title: errorTitle, message: errorMessage(reason, "Something went wrong.") });
			setPending(false);
		}
	};

	return services.present({
		...(description ? { description } : {}),
		...(choice ? { choice } : {}),
		busy: pending,
		primary: {
			label: pending ? pendingLabel : "Create workspace",
			disabled: !canSubmit,
			onClick: () => void submit(),
		},
		body: (
			<div className="flex flex-col gap-6">
				{summary}
				<FieldGroup>
					{leadingField}
					<Field>
						<FieldLabel htmlFor={nameId}>Workspace name</FieldLabel>
						<Input
							id={nameId}
							value={name}
							onChange={(event) => setTypedName(event.target.value)}
							placeholder="e.g. My project"
							className={cn(filled && FILLED_INPUT_CLASS)}
							data-qa-id="new-folder-workspace-name"
						/>
						<FieldDescription>Also used as the new folder&apos;s name.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel>Identity color</FieldLabel>
						<WorkspaceIdentityColorPicker
							value={color}
							onChange={setColor}
							className={cn(filled && FILLED_SWATCH_CLASS)}
						/>
					</Field>
					<Field>
						<FieldLabel>Location</FieldLabel>
						<LocationPicker
							location={location}
							canPickDirectories={services.canPickDirectories}
							disabled={pending}
							appearance={services.appearance}
							onChoose={() => void chooseLocation()}
						/>
					</Field>
					{error ? <WorkspaceErrorAlert title={error.title} message={error.message} /> : null}
				</FieldGroup>
			</div>
		),
	});
}
