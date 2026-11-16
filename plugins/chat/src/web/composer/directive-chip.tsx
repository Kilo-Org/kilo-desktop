import type { DirectiveChipProps } from "@assistant-ui/react-lexical";
import type { FC } from "react";

import { slashCategoryIcon } from "../slash-commands/kilo-slash-icons";
import { useMentionIcon } from "./mention-triggers";

/** A chip in the rich input: a slash command's category icon, or its mention source's. */
export const KiloDirectiveChip: FC<DirectiveChipProps> = ({
	directiveId,
	directiveType,
	label,
}) => {
	const Icon = useMentionIcon(directiveType) ?? slashCategoryIcon(directiveType);
	return (
		<span
			data-slot="directive-text-chip"
			data-directive-type={directiveType}
			data-directive-id={directiveId}
			aria-label={`${directiveType}: ${label}`}
			className="aui-directive-chip"
		>
			<Icon />
			{label}
		</span>
	);
};
