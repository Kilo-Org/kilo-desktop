import { ChevronDownIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { ButtonGroup } from "@kilo-desktop/ui/components/button-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import {
	EXTERNAL_EDITORS,
	type ExternalEditorId,
	type FilesServiceContract,
} from "../../../contracts/schemas.js";
import { EXTERNAL_EDITOR_ICONS } from "./ExternalEditorIcons.js";

const PREFERRED_EXTERNAL_EDITOR_STORAGE_KEY = "files.preferredExternalEditor";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "The file operation failed.";
}

function preferredExternalEditor(
	availableEditors: readonly ExternalEditorId[],
): ExternalEditorId | null {
	try {
		const stored = localStorage.getItem(PREFERRED_EXTERNAL_EDITOR_STORAGE_KEY);
		const storedEditor = EXTERNAL_EDITORS.find(({ id }) => id === stored)?.id;
		if (storedEditor && availableEditors.includes(storedEditor)) return storedEditor;
	} catch {
		// An unavailable storage backend should not prevent launching an editor.
	}
	return EXTERNAL_EDITORS.find(({ id }) => availableEditors.includes(id))?.id ?? null;
}

export interface ExternalEditorActionsModel {
	readonly availableEditors: readonly ExternalEditorId[] | null;
	readonly preferredEditor: ExternalEditorId | null;
	readonly error: string | null;
	open(editor: ExternalEditorId): Promise<void>;
}

export function useExternalEditorActions({
	workspaceDirectory,
	relativePath,
}: {
	readonly workspaceDirectory?: string;
	readonly relativePath?: string | null;
}): ExternalEditorActionsModel {
	const sdk = useSdk<FilesServiceContract>("files");
	const [actionError, setActionError] = useState<string | null>(null);
	const [preferredEditorOverride, setPreferredEditorOverride] = useState<ExternalEditorId | null>(
		null,
	);
	const editorsQuery = useQuery({
		queryKey: [sdk.featureId, "external-editors"],
		queryFn: () => sdk.client.listExternalEditors(),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 5 * 60_000,
	});
	const availableEditors = editorsQuery.data?.editors ?? null;
	const preferredEditor =
		preferredEditorOverride ??
		(availableEditors ? preferredExternalEditor(availableEditors) : null);
	const error = actionError ?? (editorsQuery.error ? errorMessage(editorsQuery.error) : null);

	const open = async (editor: ExternalEditorId) => {
		if (!workspaceDirectory || !relativePath) return;
		setActionError(null);
		try {
			await sdk.client.openExternalEditor({ workspaceDirectory, relativePath, editor });
			try {
				localStorage.setItem(PREFERRED_EXTERNAL_EDITOR_STORAGE_KEY, editor);
			} catch {
				// Launch success does not depend on remembering the preference.
			}
			setPreferredEditorOverride(editor);
		} catch (launchError) {
			setActionError(errorMessage(launchError));
		}
	};

	return { availableEditors, preferredEditor, error, open };
}

export function ExternalEditorActions({
	model: { availableEditors, preferredEditor, open },
}: {
	readonly model: ExternalEditorActionsModel;
}) {
	const PreferredEditorIcon = preferredEditor ? EXTERNAL_EDITOR_ICONS[preferredEditor] : null;
	const openLabel = preferredEditor
		? `Open file in ${EXTERNAL_EDITORS.find(({ id }) => id === preferredEditor)?.label ?? "preferred editor"}`
		: "Open file in preferred editor";

	return (
		<ButtonGroup aria-label="Open in external editor">
			<Tooltip disableHoverablePopup>
				<TooltipTrigger
					render={
						<Button
							aria-label={openLabel}
							data-qa-id="files-open-external-editor"
							disabled={!preferredEditor}
							onClick={() => {
								if (preferredEditor) void open(preferredEditor);
							}}
							size="sm"
							variant="outline"
						/>
					}
				>
					{PreferredEditorIcon ? (
						<PreferredEditorIcon
							aria-hidden="true"
							data-editor-icon={preferredEditor ?? undefined}
							data-icon="inline-start"
						/>
					) : null}
					<span className="sr-only">Open</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{openLabel}</TooltipContent>
			</Tooltip>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label="Choose external editor"
							data-qa-id="files-external-editor-menu"
							disabled={availableEditors === null}
							size="icon-sm"
							variant="outline"
						/>
					}
				>
					<ChevronDownIcon aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-48">
					<DropdownMenuGroup>
						{availableEditors?.length === 0 ? (
							<DropdownMenuItem disabled>No installed editors found</DropdownMenuItem>
						) : null}
						{EXTERNAL_EDITORS.filter(({ id }) => availableEditors?.includes(id)).map(
							({ id, label }) => {
								const EditorIcon = EXTERNAL_EDITOR_ICONS[id];
								return (
									<DropdownMenuItem
										key={id}
										data-qa-id={`files-external-editor-${id}`}
										onClick={() => void open(id)}
									>
										<EditorIcon aria-hidden="true" data-editor-icon={id} />
										{label}
									</DropdownMenuItem>
								);
							},
						)}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</ButtonGroup>
	);
}
