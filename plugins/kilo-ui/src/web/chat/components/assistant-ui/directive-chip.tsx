import type { DirectiveChipProps } from "@assistant-ui/react-lexical";
import { FileIcon } from "lucide-react";
import type { FC } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { slashCategoryIcon } from "../../slash-commands/kilo-slash-icons.js";

type FileMentionCapabilities = {
	readonly fileMentions?: {
		readonly Icon: FC<{ readonly path: string; readonly className?: string }>;
	};
};

export const KiloDirectiveChip: FC<DirectiveChipProps> = ({
	directiveId,
	directiveType,
	label,
}) => {
	const sdk = useSdk("kilo-ui");
	const FileTypeIcon = sdk.plugins.get<FileMentionCapabilities>("files")?.fileMentions?.Icon;
	const Icon = slashCategoryIcon(directiveType);
	return (
		<span
			data-slot="directive-text-chip"
			data-directive-type={directiveType}
			data-directive-id={directiveId}
			aria-label={`${directiveType}: ${label}`}
			className="aui-directive-chip"
		>
			{directiveType === "file" ? (
				FileTypeIcon ? (
					<FileTypeIcon path={directiveId} />
				) : (
					<FileIcon />
				)
			) : (
				<Icon />
			)}
			{label}
		</span>
	);
};
