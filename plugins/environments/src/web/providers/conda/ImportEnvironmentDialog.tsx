import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

import { useSdk, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Field, FieldError, FieldLabel } from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import { Spinner } from "@anaconda-agentic-desktop/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import { CircleHelpIcon, FileUpIcon, XIcon } from "lucide-react";

import type {
	CondaEnvsPickFileResult,
	CondaEnvsReadFileResult,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { validateEnvironmentName } from "./environment-display.js";
import { showEnvironmentsErrorToast, trackBackgroundCreateToast } from "./environments-toasts.js";

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
			<span className="text-muted-foreground/70 italic">
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
				<span className="text-primary/80 font-medium">{key}</span>
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

	const mutation = useSdkMutation(sdk, "conda.envs.createFromFile", {
		invalidates: ["conda.envs.list"],
	});

	// Fetch file content when a file is selected and extract the env name.
	useEffect(() => {
		if (!filePath) {
			setFileContent(null);
			return;
		}
		let cancelled = false;
		sdk
			.invoke("conda.envs.readFile", { filePath })
			.then((result) => {
				if (cancelled) return;
				const content = (result as CondaEnvsReadFileResult).content;
				setFileContent(content);
				// Extract the top-level `name:` key from the YAML. Without `/m`,
				// `^` anchors to the start of the string so nested or indented
				// `name:` keys inside mappings are not matched.
				const nameMatch = content.match(/^name:\s*(.+)/);
				if (nameMatch?.[1]) {
					setName(nameMatch[1].trim());
				}
			})
			.catch(() => {
				if (!cancelled) setFileContent(null);
			});
		return () => {
			cancelled = true;
		};
	}, [filePath, sdk]);

	function resetForm() {
		setFilePath(null);
		setFileName(null);
		setFileContent(null);
		setName("");
		setValidationError(null);
	}

	function validate(): boolean {
		if (!filePath) {
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
		const promise = mutation.mutateAsync({
			file: filePath!,
			...(trimmedName ? { name: trimmedName } : {}),
		});
		const pending = { promise, envName: envDisplayName, backgrounded: false };
		pendingImportRef.current = pending;
		promise.then(
			() => {
				if (pending.backgrounded) return;
				resetForm();
				onClose();
			},
			(reason) => {
				if (pending.backgrounded) return;
				showEnvironmentsErrorToast(
					`Failed to create ${envDisplayName}`,
					reason,
					"Could not create environment from file.",
				);
			},
		);
	}

	function handleRunInBackground() {
		const pending = pendingImportRef.current;
		if (!pending) return;
		pending.backgrounded = true;
		trackBackgroundCreateToast(
			pending.promise,
			pending.envName,
			"Could not create environment from file.",
		);
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
	}

	return (
		<TooltipProvider>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				{/*
				 * max-h rather than a fixed height: this form is short, so the modal
				 * sizes to its content and only caps on a small viewport, where the
				 * body scrolls inside the second grid row.
				 */}
				<DialogContent
					data-qa-id="environments-import-dialog"
					className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
				>
					<DialogHeader className="shrink-0 gap-1 border-b px-6 py-4">
						<DialogTitle>Import from file</DialogTitle>
						<DialogDescription>
							Create an environment from a YAML environment file (.yml / .yaml).
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
						<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
							{/* Drop zone / file display */}
							{filePath ? (
								<div
									className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2"
									data-qa-id="environments-import-file-display"
								>
									<FileUpIcon className="text-muted-foreground size-4 shrink-0" />
									<span className="min-w-0 flex-1 truncate text-sm" title={filePath}>
										{fileName}
									</span>
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
								</div>
							) : (
								<div
									className={cn(
										"flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
										isDragging
											? "border-primary bg-primary/5"
											: "border-muted-foreground/25 hover:border-muted-foreground/50",
									)}
									onDragOver={(e) => {
										e.preventDefault();
										setIsDragging(true);
									}}
									onDragLeave={() => setIsDragging(false)}
									onDrop={handleDrop}
									data-qa-id="environments-import-dropzone"
								>
									<FileUpIcon className="text-muted-foreground size-8" />
									<p className="text-muted-foreground text-sm">
										Drag and drop a .yml or .yaml file here
									</p>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleBrowse}
										data-qa-id="environments-import-browse"
									>
										Browse
									</Button>
								</div>
							)}

							{/* Name override */}
							<div className="flex gap-3">
								<Field className="flex-1">
									<FieldLabel className="inline-flex items-center gap-1">
										Name override
										<span className="text-muted-foreground text-xs font-normal">(optional)</span>
										<Tooltip>
											<TooltipTrigger render={<span className="inline-flex" />}>
												<CircleHelpIcon className="text-muted-foreground size-3.5" />
											</TooltipTrigger>
											<TooltipContent>
												Override the environment name declared in the YAML file.
											</TooltipContent>
										</Tooltip>
									</FieldLabel>
									<Input
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="From file"
										data-qa-id="environments-import-name"
									/>
								</Field>
							</div>

							{/* File content preview */}
							{filePath && fileContent && (
								<div
									className="bg-muted/30 min-h-0 flex-1 overflow-auto rounded-lg border"
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

						{mutation.isPending && (
							<div className="bg-muted/50 mx-6 mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
								<div className="flex items-center gap-2">
									<Spinner size="sm" />
									<span className="text-muted-foreground">
										Resolving dependencies — this may take a few minutes…
									</span>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleRunInBackground}
									data-qa-id="environments-import-background"
								>
									Run in background
								</Button>
							</div>
						)}

						{/* Footer */}
						<div className="bg-muted/40 flex items-center justify-end gap-2 border-t px-6 py-4">
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
								disabled={mutation.isPending || !filePath}
								data-qa-id="environments-import-submit"
							>
								{mutation.isPending ? "Importing…" : "Import"}
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</TooltipProvider>
	);
}
