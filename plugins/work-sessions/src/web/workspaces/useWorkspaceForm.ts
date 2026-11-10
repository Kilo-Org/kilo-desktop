import { useEffect, useState, type DragEvent } from "react";

import {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	type Workspace,
	type WorkspaceFolderInput,
} from "../../contracts";
import { KernelDialogs } from "@kilo-desktop/kernel";
import { useContextKey, useDomainObject, useKernel } from "@kilo-desktop/kernel/web";

/** The folder picking a workspace form needs from the host. */
export interface WorkspaceFormShell {
	readonly canPickDirectories: boolean;
	showOpenDialog(options: {
		kind: "directory";
		multiple: boolean;
	}): Promise<{ canceled: boolean; paths: string[] }>;
	getPathForFile(file: File): string | null;
}

/** Folder picking through the kernel: the OS picker and dropped folders, desktop only. */
export function useFolderPicking(): WorkspaceFormShell {
	const dialogs = useDomainObject(KernelDialogs);
	const kernel = useKernel();
	const desktop = useContextKey("kernel/desktop");
	return {
		canPickDirectories: desktop && dialogs !== null,
		showOpenDialog: async () => {
			const { paths } = await dialogs!.methods.open({ directory: true, multiple: true });
			return { canceled: paths.length === 0, paths };
		},
		getPathForFile: (file) => kernel.pathForFile(file),
	};
}

export function useWorkspaceForm(options: {
	workspace?: Workspace | undefined;
	shell: WorkspaceFormShell;
}) {
	const workspace = options.workspace;
	const [name, setName] = useState(workspace?.name ?? "");
	const [color, setColor] = useState(workspace?.color ?? DEFAULT_WORKSPACE_IDENTITY_COLOR);
	const [folders, setFolders] = useState<WorkspaceFolderInput[]>(
		workspace?.folders.map(({ path, isPrimary }) => ({ path, isPrimary })) ?? [],
	);
	const [error, setError] = useState<string | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const canPickDirectories = options.shell.canPickDirectories;

	useEffect(() => {
		setName(workspace?.name ?? "");
		setColor(workspace?.color ?? DEFAULT_WORKSPACE_IDENTITY_COLOR);
		setFolders(workspace?.folders.map(({ path, isPrimary }) => ({ path, isPrimary })) ?? []);
		setError(null);
		setIsDragging(false);
	}, [workspace]);

	const addPaths = (paths: string[]) => {
		setFolders((current) => {
			const known = new Set(current.map((folder) => folder.path));
			const additions = paths.filter((folderPath) => folderPath && !known.has(folderPath));
			return [
				...current,
				...additions.map((path, index) => ({
					path,
					isPrimary: current.length === 0 && index === 0,
				})),
			];
		});
	};

	const chooseFolders = async () => {
		setError(null);
		if (!canPickDirectories) {
			setError("Folder selection requires the desktop app.");
			return;
		}
		try {
			const result = await options.shell.showOpenDialog({ kind: "directory", multiple: true });
			if (!result.canceled) addPaths(result.paths);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Could not open the folder picker.");
		}
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		if (!canPickDirectories) return;
		const paths: string[] = [];
		let hasInvalidEntry = false;
		for (const item of event.dataTransfer.items) {
			const entry = item.webkitGetAsEntry();
			if (!entry?.isDirectory) {
				hasInvalidEntry = true;
				continue;
			}
			const file = item.getAsFile();
			if (file) {
				const path = options.shell.getPathForFile(file);
				if (path) paths.push(path);
			}
		}
		if (hasInvalidEntry) setError("Only folders can be added to a workspace.");
		else if (paths.length === 0) setError("Dropped folders could not be resolved.");
		else setError(null);
		addPaths(paths);
	};

	const removeFolder = (path: string) => {
		setFolders((current) => {
			const remaining = current.filter((folder) => folder.path !== path);
			if (remaining.length > 0 && !remaining.some((folder) => folder.isPrimary)) {
				return remaining.map((folder, index) => ({ ...folder, isPrimary: index === 0 }));
			}
			return remaining;
		});
	};

	const makePrimary = (path: string) => {
		setFolders((current) => {
			const selected = current.find((folder) => folder.path === path);
			if (!selected) return current;
			return [selected, ...current.filter((folder) => folder.path !== path)].map(
				(folder, index) => ({ ...folder, isPrimary: index === 0 }),
			);
		});
	};

	const validate = (): boolean => {
		setError(null);
		if (folders.length === 0) {
			setError("Add at least one folder.");
			return false;
		}
		return true;
	};

	return {
		name,
		setName,
		color,
		setColor,
		folders,
		error,
		setError,
		isDragging,
		setIsDragging,
		canPickDirectories,
		chooseFolders,
		onDrop,
		removeFolder,
		makePrimary,
		validate,
	};
}
