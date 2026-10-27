import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

import { useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { FileUpIcon, XIcon } from "lucide-react";

import type {
	CondaEnvsPickFileResult,
	CondaEnvsReadFileResult,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { validateEnvironmentName } from "./environment-display.js";
import {
	importEnvironmentJob,
	jobToastOptions,
	showJobError,
	showJobSuccess,
} from "./environments-toasts.js";

const ACCEPTED_EXTENSIONS = [".yml", ".yaml"];

function hasAcceptedExtension(name: string): boolean {
	const lower = name.toLowerCase();
	return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Lightweight YAML syntax coloring for the file preview. */
function YamlLine({ line }: { line: string }) {
	// Comment lines
	if (/^\s*#/.test(line)) {
		return (
			<span className="text-muted-foreground italic">
				{line}
				{"\n"}
			</span>
		);
	}
	// Key: value lines
	const keyMatch = line.match(/^(\s*)(- )?([A-Za-z_][\w.-]*)(:\s?)(.*)/);
	if (keyMatch) {
		const [, indent, dash, key, colon, value] = keyMatch;
		return (
			<span>
				{indent}
				{dash && <span className="text-muted-foreground">{dash}</span>}
				<span className="text-primary-ink font-medium">{key}</span>
				<span className="text-muted-foreground">{colon}</span>
				{value && <span>{value}</span>}
				{"\n"}
			</span>
		);
	}
	// List items (- value)
	const listMatch = line.match(/^(\s*)(- )(.*)/);
	if (listMatch) {
		const [, indent, dash, value] = listMatch;
		return (
			<span>
				{indent}
				<span className="text-muted-foreground">{dash}</span>
				{value}
				{"\n"}
			</span>
		);
	}
	return (
		<span>
			{line}
			{"\n"}
		</span>
	);
}

interface ImportEnvironmentDialogProps {
	open: boolean;
	onClose: () => void;
}

export function ImportEnvironmentDialog({ open, onClose }: ImportEnvironmentDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const [filePath, setFilePath] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [fileContent, setFileContent] = useState<string | null>(null);
	const [stagedHandle, setStagedHandle] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [isDragging, setIsDragging] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	// The in-flight import job, so "Run in background" can adopt it instead
	// of enqueueing a duplicate. `backgrounded` mutes the foreground handlers.
	const pendingImportRef = useRef<{
		promise: Promise<unknown>;
		envName: string;
		backgrounded: boolean;
	} | null>(null);
	// Latest selected path, read at submit time so a re-stage targets the
	// current selection, not a stale closure value.
	const filePathRef = useRef<string | null>(null);
	// Invalidates in-flight reads when the selection changes or a newer stage starts.
	const stageTokenRef = useRef(0);

	const mutation = useSdkMutation(sdk, "conda.envs.createFromFile", {
		invalidates: ["conda.envs.list"],
	});

	// Fetch file content when a file is selected and extract the env name.
	useEffect(() => {
		filePathRef.current = filePath;
		const token = ++stageTokenRef.current;
		if (!filePath) {
			setFileContent(null);
			setStagedHandle(null);
			return;
		}
		setStagedHandle(null);
		sdk
			.invoke("conda.envs.readFile", { filePath })
			.then((result) => {
				if (token !== stageTokenRef.current) return;
				const { content, stagedHandle: handle } = result as CondaEnvsReadFileResult;
				setFileContent(content);
				setStagedHandle(handle);
				// Extract the top-level `name:` key from the YAML. Without `/m`,
				// `^` anchors to the start of the string so nested or indented
				// `name:` keys inside mappings are not matched.
				const nameMatch = content.match(/^name:\s*(.+)/);
				if (nameMatch?.[1]) {
					setName(nameMatch[1].trim());
				}
			})
			.catch(() => {
				if (token !== stageTokenRef.current) return;
				failStage();
			});
		return () => {
			stageTokenRef.current += 1;
		};
	}, [filePath, sdk]);

	// Re-stage after a failed import, whose handle the main side already released.
	async function restageFile(path: string): Promise<void> {
		const token = ++stageTokenRef.current;
		setStagedHandle(null);
		try {
			const { content, stagedHandle: handle } = (await sdk.invoke("conda.envs.readFile", {
				filePath: path,
			})) as CondaEnvsReadFileResult;
			if (token !== stageTokenRef.current) return;
			setFileContent(content);
			setStagedHandle(handle);
		} catch {
			if (token !== stageTokenRef.current) return;
			failStage();
		}
	}

	// A failed read leaves no usable file, so drop the selection and explain.
	function failStage(): void {
		resetForm();
		setValidationError("Could not read the selected file. Select it again.");
	}

	function resetForm() {
		setFilePath(null);
		setFileName(null);
		setFileContent(null);
		setStagedHandle(null);
		setName("");
		setValidationError(null);
	}

	function validate(): boolean {
		if (!filePath || !stagedHandle) {
			setValidationError("An environment file is required.");
			return false;
		}
		const trimmedName = name.trim();
		if (trimmedName) {
			const nameError = validateEnvironmentName(trimmedName);
			if (nameError) {
				setValidationError(nameError);
				return false;
			}
		}
		setValidationError(null);
		return true;
	}

	const handleDrop = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			setIsDragging(false);

			const file = e.dataTransfer.files[0];
			if (!file || !hasAcceptedExtension(file.name)) {
				setValidationError("Only .yml and .yaml files are accepted.");
				return;
			}

			const resolvedPath = sdk.shell.getPathForFile(file);
			if (!resolvedPath) {
				setValidationError(
					"Could not resolve file path. Import from file requires the desktop app.",
				);
				return;
			}
			setValidationError(null);
			setFilePath(resolvedPath);
			setFileName(file.name);
		},
		[sdk.shell],
	);

	async function handleBrowse() {
		setValidationError(null);
		try {
			const result = (await sdk.invoke("conda.envs.pickFile", {})) as CondaEnvsPickFileResult;
			if (result.filePath) {
				setFilePath(result.filePath);
				const segments = result.filePath.split(/[/\\]/);
				setFileName(segments[segments.length - 1] ?? result.filePath);
			}
		} catch (err) {
			setValidationError(err instanceof Error ? err.message : "Could not open file picker.");
		}
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!validate()) return;

		const trimmedName = name.trim();
		const envDisplayName = trimmedName || fileName || "environment";
		const job = importEnvironmentJob(envDisplayName);
		const promise = mutation.mutateAsync({
			stagedHandle: stagedHandle!,
			...(trimmedName ? { name: trimmedName } : {}),
		});
		const pending = { promise, envName: envDisplayName, backgrounded: false };
		pendingImportRef.current = pending;
		promise.then(
			() => {
				if (pending.backgrounded) return;
				showJobSuccess(job);
				resetForm();
				onClose();
			},
			(reason) => {
				if (pending.backgrounded) return;
				showJobError(job, reason);
				const current = filePathRef.current;
				if (current) void restageFile(current);
			},
		);
	}

	function handleRunInBackground() {
		const pending = pendingImportRef.current;
		if (!pending) return;
		pending.backgrounded = true;
		toast.promise(pending.promise, jobToastOptions(importEnvironmentJob(pending.envName)));
		resetForm();
		onClose();
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			resetForm();
			onClose();
		}
	}

	function clearFile() {
		setFilePath(null);
		setFileName(null);
		setFileContent(null);
		setStagedHandle(null);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				data-qa-id="environments-import-dialog"
				className="max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl"
			>
				<DialogHeader>
					<DialogTitle>Import from file</DialogTitle>
					<DialogDescription>
						Create an environment from a YAML environment file (.yml or .yaml).
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
					<div className="scroll-fade-y -mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4">
						{filePath ? (
							<Item variant="outline" size="sm" data-qa-id="environments-import-file-display">
								<ItemMedia variant="icon">
									<FileUpIcon aria-hidden="true" />
								</ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle className="truncate" title={filePath}>
										{fileName}
									</ItemTitle>
								</ItemContent>
								<ItemActions>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										onClick={clearFile}
										aria-label="Remove file"
										disabled={mutation.isPending}
									>
										<XIcon />
									</Button>
								</ItemActions>
							</Item>
						) : (
							<Empty
								className={cn("border", isDragging && "border-primary-ink")}
								data-dragging={isDragging || undefined}
								onDragOver={(e) => {
									e.preventDefault();
									setIsDragging(true);
								}}
								onDragLeave={() => setIsDragging(false)}
								onDrop={handleDrop}
								data-qa-id="environments-import-dropzone"
							>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<FileUpIcon aria-hidden="true" />
									</EmptyMedia>
									<EmptyTitle>Drop an environment file here</EmptyTitle>
									<EmptyDescription>Accepts .yml and .yaml files.</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleBrowse}
										data-qa-id="environments-import-browse"
									>
										Browse
									</Button>
								</EmptyContent>
							</Empty>
						)}

						<Field>
							<FieldLabel htmlFor="environments-import-name">Name override</FieldLabel>
							<Input
								id="environments-import-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="From file"
								data-qa-id="environments-import-name"
							/>
							<FieldDescription>
								Optional. Replaces the environment name declared in the file.
							</FieldDescription>
						</Field>

						{filePath && fileContent && (
							<div
								className="border-border bg-muted/50 min-h-0 shrink-0 overflow-auto rounded-lg border"
								data-qa-id="environments-import-file-preview"
							>
								<pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
									{fileContent.split("\n").map((line, i) => (
										<YamlLine key={i} line={line} />
									))}
								</pre>
							</div>
						)}

						{validationError ? <FieldError>{validationError}</FieldError> : null}
					</div>

					<DialogFooter className="sm:items-center">
						{mutation.isPending ? (
							<Button
								type="button"
								variant="ghost"
								className="sm:mr-auto"
								onClick={handleRunInBackground}
								data-qa-id="environments-import-background"
							>
								Run in background
							</Button>
						) : null}
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={mutation.isPending || !filePath || !stagedHandle}
							data-qa-id="environments-import-submit"
						>
							{mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{mutation.isPending ? "Importing…" : "Import"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
