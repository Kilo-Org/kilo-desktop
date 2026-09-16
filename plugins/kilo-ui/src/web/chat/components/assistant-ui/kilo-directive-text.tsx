import type { TextMessagePartComponent } from "@assistant-ui/react";
import { FileIcon } from "lucide-react";
import { useMemo, type FC } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { useChatMarkdownContext } from "../../ChatMarkdownContext.js";
import { useChatConnection } from "../../connection/ChatConnectionContext.js";
import { useWorkspaceDirectory } from "../../use-workspace-directory.js";
import { slashDisplayText } from "../../slash-commands/kilo-slash-command.js";
import { SLASH_CATEGORY_ICONS } from "../../slash-commands/kilo-slash-icons.js";
import { useKiloCommandCatalog } from "../../slash-commands/use-kilo-command-catalog.js";
import { useKiloSlashFormatter } from "../../slash-commands/use-kilo-slash-formatter.js";
import { createDirectiveText } from "./elements/directive-text.aui.js";
import { resolveFileMention, withFileMentions } from "./kilo-file-mention-formatter.js";

type FileMentionCapabilities = {
	readonly fileMentions?: {
		readonly Icon: FC<{ readonly path: string; readonly className?: string }>;
	};
	readonly fileViewer?: {
		openFile(options: {
			readonly sessionId: string;
			readonly workspaceDirectory: string;
			readonly relativePath: string;
		}): void;
	};
};

export const KiloDirectiveText: TextMessagePartComponent = (props) => {
	const formatter = useKiloSlashFormatter();
	const sdk = useSdk("kilo-ui");
	const files = sdk.plugins.get<FileMentionCapabilities>("files");
	const FileTypeIcon = files?.fileMentions?.Icon;
	const markdownContext = useChatMarkdownContext();
	const { connection } = useChatConnection();
	const workspaceDirectory = useWorkspaceDirectory();
	const directory = workspaceDirectory ?? connection?.globalDirectory;
	const catalog = useKiloCommandCatalog(connection, directory);
	const text = useMemo(
		() => slashDisplayText(props.text, catalog.data ?? []),
		[catalog.data, props.text],
	);
	const Text = useMemo(
		() =>
			createDirectiveText(withFileMentions(formatter), {
				iconMap: { ...SLASH_CATEGORY_ICONS, file: FileIcon },
				renderIcon: (segment) =>
					segment.type === "file" && FileTypeIcon ? <FileTypeIcon path={segment.id} /> : undefined,
				getAction: (segment) => {
					if (segment.type !== "file" || !files?.fileViewer || !markdownContext?.sessionId) {
						return undefined;
					}
					const target = resolveFileMention(segment.id, markdownContext.workspaceFolders);
					return target
						? () => files.fileViewer?.openFile({ sessionId: markdownContext.sessionId, ...target })
						: undefined;
				},
			}),
		[FileTypeIcon, files?.fileViewer, formatter, markdownContext],
	);
	return <Text {...props} text={text} />;
};
