import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";

import {
	Workspaces,
	type WorkspaceSourceImplementation,
	type WorkspaceSourceProps,
} from "../../contracts";
import { folderNameProblem, joinFolderPath } from "./folder-path";
import { useNewFolderServices } from "./new-folder-context";
import { useFolderPicking, useWorkspaceForm } from "./useWorkspaceForm";
import { useReportDraft } from "./workspace-source-host";
import { errorMessage } from "./WorkspaceErrorAlert";
import { WorkspaceFormFields, type FolderMode } from "./WorkspaceFormFields";

/**
 * kilo.work-sessions' own workspace source: folders already on this computer,
 * or one new empty folder named after the workspace. The new folder is made
 * by main only on save, so going back or cancelling leaves nothing behind.
 */
function LocalFolderSource({ onCreated, appearance, children }: WorkspaceSourceProps) {
	const workspaces = useDomainObject(Workspaces);
	const services = useNewFolderServices();
	const form = useWorkspaceForm({ shell: useFolderPicking() });
	const [mode, setMode] = useState<FolderMode>("existing");
	const [chosenLocation, setChosenLocation] = useState<string | null>(null);
	const location = chosenLocation ?? services.defaultLocation;
	const [pending, setPending] = useState(false);
	const creatingFolder = mode === "new";
	const folderName = form.name.trim();
	const nameProblem = creatingFolder && folderName ? folderNameProblem(folderName) : null;
	const newFolder =
		location !== null && folderName && !nameProblem ? joinFolderPath(location, folderName) : null;
	const canSubmit = creatingFolder ? newFolder !== null : form.folders.length > 0;
	useReportDraft(services.onDraft, {
		name: form.name.trim(),
		color: form.color,
		folders: creatingFolder
			? newFolder
				? [newFolder]
				: []
			: [...form.folders]
					.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
					.map((folder) => folder.path),
	});

	const chooseLocation = async () => {
		form.setError(null);
		try {
			const picked = await services.pickLocation(location);
			if (picked) setChosenLocation(picked);
		} catch (reason) {
			form.setError(errorMessage(reason, "Could not open the folder picker."));
		}
	};

	const save = async () => {
		form.setError(null);
		if (!workspaces || (creatingFolder ? newFolder === null : !form.validate())) return;
		setPending(true);
		try {
			onCreated(
				await workspaces.methods.create(
					creatingFolder && newFolder
						? {
								name: folderName,
								color: form.color,
								folders: [{ path: newFolder, isPrimary: true }],
								createFolders: [newFolder],
								source: `${services.origin}-new-folder`,
							}
						: {
								name: form.name,
								color: form.color,
								folders: form.folders,
								source: services.origin,
							},
				),
			);
		} catch (reason) {
			form.setError(errorMessage(reason, "Could not save workspace."));
			// Only a failure unlocks the form: on success the host moves on (closes or
			// advances) and the form stays locked until then, so it can't be resubmitted.
			// react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
			setPending(false);
		}
	};

	return children({
		description: "Use folders on this computer, or make a new one.",
		busy: pending,
		primary: {
			label: pending ? "Saving…" : "Create workspace",
			disabled: !canSubmit,
			onClick: () => void save(),
		},
		body: (
			<WorkspaceFormFields
				{...form}
				error={form.error ?? nameProblem}
				appearance={appearance}
				folderChoice={{
					mode,
					onModeChange: (next) => {
						form.setError(null);
						setMode(next);
					},
					location,
					onChooseLocation: () => void chooseLocation(),
				}}
			/>
		),
	});
}

export const localFolderSource: WorkspaceSourceImplementation = {
	icon: FolderOpenIcon,
	Component: LocalFolderSource,
};
