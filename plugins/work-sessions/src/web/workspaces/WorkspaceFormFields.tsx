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
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { useWorkspaceForm } from "./useWorkspaceForm";
import { WorkspaceIdentityColorPicker } from "./WorkspaceIdentityColorPicker";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

type WorkspaceFormFieldsProps = ReturnType<typeof useWorkspaceForm> & {
	unavailablePaths?: ReadonlySet<string>;
	nameId?: string;
	/** `filled` drops the outlines for tinted surfaces (the onboarding card). */
	appearance?: "outlined" | "filled";
};

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
					className={cn(
						// The dark: fill is not redundant: it replaces Input's own dark:bg-input/30.
						filled &&
							"bg-foreground/5 dark:bg-foreground/5 h-9 rounded-xl border-transparent focus-visible:border-transparent",
					)}
					data-qa-id="workspace-name"
				/>
			</Field>
			<Field>
				<FieldLabel>Identity color</FieldLabel>
				<WorkspaceIdentityColorPicker
					value={color}
					onChange={setColor}
					// On a filled surface the stock pressed wash (bg-muted) all but vanishes,
					// so mark the selected swatch with a foreground ring instead.
					className={cn(
						filled &&
							"[&_[aria-pressed=true]]:bg-transparent [&_[aria-pressed=true]>span]:outline-2 [&_[aria-pressed=true]>span]:outline-offset-2 [&_[aria-pressed=true]>span]:outline-foreground",
					)}
				/>
			</Field>
			<Field>
				<FieldLabel>Folders</FieldLabel>
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
							<div className={cn("border-t p-1", filled ? "border-foreground/5" : "border-border")}>
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
			</Field>
			{error ? <FieldError>{error}</FieldError> : null}
		</FieldGroup>
	);
}
