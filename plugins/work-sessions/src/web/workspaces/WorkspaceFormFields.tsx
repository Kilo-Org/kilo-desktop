import { FolderIcon, FolderPlusIcon, FolderXIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import type { DragEvent, KeyboardEvent } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { FILLED_INPUT_CLASS, FILLED_SWATCH_CLASS } from "./filled-styles";
import { LocationPicker } from "./LocationPicker";
import type { useWorkspaceForm } from "./useWorkspaceForm";
import { WorkspaceIdentityColorPicker } from "./WorkspaceIdentityColorPicker";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

type WorkspaceFormFieldsProps = ReturnType<typeof useWorkspaceForm> & {
	unavailablePaths?: ReadonlySet<string>;
	nameId?: string;
	/** `filled` drops the outlines for tinted surfaces (the onboarding card). */
	appearance?: "outlined" | "filled";
	/**
	 * Offers one new folder, named after the workspace, instead of existing
	 * ones; only where saving can make it.
	 */
	folderChoice?: {
		mode: FolderMode;
		onModeChange(mode: FolderMode): void;
		location: string | null;
		onChooseLocation(): void;
	};
};

export type FolderMode = "existing" | "new";

/** Nested inside the track's 2px padding, so its radius is the track's minus that padding. */
const SEGMENT_CLASS_NAME = "flex-1 rounded-[calc(var(--radius-lg)-2px)]";

export function WorkspaceFormFields({
	name,
	setName,
	color,
	setColor,
	folders,
	unavailablePaths,
	error,
	isDragging,
	setIsDragging,
	canPickDirectories,
	chooseFolders,
	onDrop,
	removeFolder,
	makePrimary,
	nameId = "workspace-name",
	appearance = "outlined",
	folderChoice,
}: WorkspaceFormFieldsProps) {
	const filled = appearance === "filled";
	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor={nameId}>Workspace name</FieldLabel>
				<Input
					id={nameId}
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="e.g. My project"
					className={cn(filled && FILLED_INPUT_CLASS)}
					data-qa-id="workspace-name"
				/>
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
				<FieldLabel>Folders</FieldLabel>
				{folderChoice ? (
					<ToggleGroup
						aria-label="Folder source"
						value={[folderChoice.mode]}
						// Single-select still lets the pressed item unpress; one mode is always chosen.
						onValueChange={(next) => {
							const picked = next[0];
							if (picked === "existing" || picked === "new") folderChoice.onModeChange(picked);
						}}
						size="sm"
						className={cn(
							"w-full gap-0.5 p-0.5",
							filled
								? "bg-foreground/5 data-[size=sm]:rounded-xl"
								: "bg-muted/40 data-[size=sm]:rounded-lg",
						)}
						data-qa-id="workspace-folder-mode"
					>
						<ToggleGroupItem value="existing" className={SEGMENT_CLASS_NAME}>
							Existing folders
						</ToggleGroupItem>
						<ToggleGroupItem value="new" className={SEGMENT_CLASS_NAME}>
							New folder
						</ToggleGroupItem>
					</ToggleGroup>
				) : null}
				{folderChoice?.mode === "new" ? (
					<Field>
						<FieldLabel>Location</FieldLabel>
						<LocationPicker
							location={folderChoice.location}
							canPickDirectories={canPickDirectories}
							newFolderName={name.trim()}
							appearance={appearance}
							onChoose={folderChoice.onChooseLocation}
						/>
					</Field>
				) : (
					<div
						data-qa-id="workspace-folder-dropzone"
						onDragOver={(event) => {
							event.preventDefault();
							if (canPickDirectories) setIsDragging(true);
						}}
						onDragLeave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
								setIsDragging(false);
							}
						}}
						onDrop={(event: DragEvent) => {
							setIsDragging(false);
							onDrop(event);
						}}
						className={cn(
							"border transition-colors",
							filled ? "bg-foreground/3 rounded-xl" : "rounded-lg",
							folders.length === 0 && "border-dashed",
							isDragging
								? "border-primary-ink bg-primary/5 border-dashed"
								: filled
									? "border-transparent"
									: "border-border",
						)}
					>
						{folders.length === 0 && canPickDirectories ? (
							<div
								role="button"
								tabIndex={0}
								onClick={() => void chooseFolders()}
								onKeyDown={(event: KeyboardEvent) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										void chooseFolders();
									}
								}}
								className="hover:bg-muted flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[calc(var(--radius-lg)-1px)] text-center transition-colors"
							>
								<div className="bg-foreground/10 text-muted-foreground flex size-9 items-center justify-center rounded-full">
									<FolderPlusIcon className="size-4" />
								</div>
								<div className="flex flex-col gap-0.5">
									<span className="text-sm font-medium">Drop folders here</span>
									<span className="text-muted-foreground text-xs">or click to choose folders</span>
								</div>
							</div>
						) : folders.length === 0 ? (
							<div className="text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 rounded-[calc(var(--radius-lg)-1px)] px-6 text-center text-sm">
								<FolderIcon className="size-5" />
								Folder selection requires the desktop app.
							</div>
						) : (
							<div className="flex flex-col">
								<ItemGroup className="gap-0.5 p-1 has-data-[size=sm]:gap-0.5">
									{folders.map((folder) => {
										const unavailable = unavailablePaths?.has(folder.path) ?? false;
										return (
											<Item
												key={folder.path}
												size="sm"
												role="listitem"
												className="flex-nowrap gap-2 px-2 py-1"
												render={
													<motion.div
														layout="position"
														transition={{
															type: "spring",
															stiffness: 500,
															damping: 35,
															mass: 0.8,
														}}
													/>
												}
											>
												<ItemMedia
													variant="icon"
													className={cn(unavailable ? "text-warning" : "text-muted-foreground")}
												>
													{unavailable ? <FolderXIcon /> : <FolderIcon />}
												</ItemMedia>
												<ItemContent className="min-w-0">
													<Tooltip>
														<TooltipTrigger
															render={<ItemTitle className="max-w-full cursor-default" />}
														>
															{folderName(folder.path)}
														</TooltipTrigger>
														<TooltipContent className="max-w-sm font-mono break-all">
															{folder.path}
														</TooltipContent>
													</Tooltip>
													{unavailable ? (
														<p
															className="text-warning text-xs"
															data-qa-id="workspace-folder-unavailable"
														>
															This folder is unavailable. Select its new location or remove it.
														</p>
													) : null}
												</ItemContent>
												<ItemActions className="gap-1">
													{folder.isPrimary ? (
														<span className="bg-primary-soft text-primary-soft-foreground rounded-full px-2 py-0.5 text-xs font-medium">
															Primary
														</span>
													) : (
														<Button
															type="button"
															variant="ghost"
															size="xs"
															className="opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100"
															onClick={() => makePrimary(folder.path)}
														>
															Make primary
														</Button>
													)}
													<Button
														type="button"
														variant="ghost"
														size="icon-xs"
														aria-label={`Remove ${folder.path}`}
														className="-mr-1.5"
														disabled={!canPickDirectories && folders.length === 1}
														onClick={() => removeFolder(folder.path)}
													>
														<XIcon />
													</Button>
												</ItemActions>
											</Item>
										);
									})}
								</ItemGroup>
								<div
									className={cn("border-t p-1", filled ? "border-foreground/5" : "border-border")}
								>
									{canPickDirectories ? (
										<Item
											size="sm"
											render={<button type="button" onClick={() => void chooseFolders()} />}
											className="text-muted-foreground hover:bg-muted hover:text-foreground min-h-8 flex-nowrap gap-2 px-2 py-1"
										>
											<ItemMedia variant="icon" className="text-muted-foreground">
												<FolderPlusIcon />
											</ItemMedia>
											<ItemContent>
												<ItemTitle>Add folder</ItemTitle>
											</ItemContent>
										</Item>
									) : (
										<p className="text-muted-foreground px-2 py-1 text-xs">
											Adding folders requires the desktop app.
										</p>
									)}
								</div>
							</div>
						)}
					</div>
				)}
			</Field>
			{error ? <FieldError>{error}</FieldError> : null}
		</FieldGroup>
	);
}
