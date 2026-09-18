import { useQueries } from "@tanstack/react-query";
import { FileIcon } from "lucide-react";
import { useMemo, type ComponentType, type FC, type ReactNode } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import type { FilesServiceContract } from "../../../contracts/schemas.js";
import { PierreFileIcon } from "../file-icons/PierreFileIcon.js";
import {
	fileMentionFormatter,
	fileMentionItems,
	workspaceFileMentionItems,
	type FileMentionFormatter,
	type FileMentionItem,
} from "./file-mention.js";

export type TriggerPopoverProps = {
	char: string;
	adapter?: {
		categories(): readonly { id: string; label: string }[];
		categoryItems(categoryId: string): readonly FileMentionItem[];
		search?(query: string): readonly FileMentionItem[];
	};
	directive: { formatter?: FileMentionFormatter };
	iconMap?: Record<string, FC<{ className?: string }>>;
	fallbackIcon?: FC<{ className?: string }>;
	renderItemIcon?: (item: FileMentionItem) => ReactNode;
	isLoading?: boolean;
	emptyItemsLabel?: string;
	loadingLabel?: string;
};

export interface FilesComposerTriggerProps {
	readonly workspaceDirectory?: string;
	readonly workspaceFolders?: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
	readonly TriggerPopover: ComponentType<TriggerPopoverProps>;
}

export function FilesComposerTrigger({
	workspaceDirectory,
	workspaceFolders,
	TriggerPopover,
}: FilesComposerTriggerProps) {
	const sdk = useSdk<FilesServiceContract>("files");
	const directories = useMemo(
		() =>
			workspaceFolders?.map((folder) => folder.path) ??
			(workspaceDirectory ? [workspaceDirectory] : []),
		[workspaceDirectory, workspaceFolders],
	);
	const files = useQueries({
		queries: directories.map((directory) => ({
			queryKey: [sdk.featureId, "file-mentions", directory],
			queryFn: () => sdk.client.list({ workspaceDirectory: directory }),
			staleTime: 30_000,
			gcTime: 5 * 60_000,
		})),
	});
	const items = useMemo(() => {
		if (directories.length === 1) return fileMentionItems(files[0]?.data?.paths ?? []);
		return workspaceFileMentionItems(
			directories.map((directory, index) => ({
				workspaceDirectory: directory,
				paths: files[index]?.data?.paths ?? [],
			})),
		);
	}, [directories, files]);
	const adapter = useMemo(
		() => ({
			categories: () => [],
			categoryItems: () => items,
			search: (query: string) => {
				const normalized = query.toLocaleLowerCase();
				return items.filter((item) => item.id.toLocaleLowerCase().includes(normalized));
			},
		}),
		[items],
	);

	if (directories.length === 0) return null;
	return (
		<TriggerPopover
			char="@"
			adapter={adapter}
			directive={{ formatter: fileMentionFormatter }}
			iconMap={{ file: FileIcon }}
			fallbackIcon={FileIcon}
			renderItemIcon={(item) => <PierreFileIcon className="size-3.5 shrink-0" path={item.id} />}
			isLoading={files.some((query) => query.isPending)}
			emptyItemsLabel="No matching files"
			loadingLabel="Loading files..."
		/>
	);
}
