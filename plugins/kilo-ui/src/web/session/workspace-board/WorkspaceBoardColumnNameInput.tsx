import { useEffect, useRef, useState } from "react";

import { Input } from "@kilo-desktop/ui/components/input";

import { WORKSPACE_BOARD_COLUMN_LABEL_MAX } from "../../../contracts/workspace-board/schemas.js";

/**
 * Inline column-name editor. Enter or leaving the field saves a non-blank,
 * changed name; Escape cancels. Settles once, so blur after Enter is ignored.
 */
export function WorkspaceBoardColumnNameInput({
	id,
	label: initialValue,
	onSubmit,
	onCancel,
}: {
	/** Takes over the heading's id while renaming, so the column keeps its name. */
	id: string;
	/** The column's current name. */
	label: string;
	onSubmit: (label: string, restoreFocus: boolean) => void;
	onCancel: (restoreFocus: boolean) => void;
}) {
	const [value, setValue] = useState(initialValue);
	const inputRef = useRef<HTMLInputElement>(null);
	const settledRef = useRef(false);

	useEffect(() => {
		inputRef.current?.select();
	}, []);

	const settle = (save: boolean, restoreFocus: boolean) => {
		if (settledRef.current) return;
		settledRef.current = true;
		const label = value.trim();
		if (save && label && label !== initialValue) onSubmit(label, restoreFocus);
		else onCancel(restoreFocus);
	};

	return (
		<Input
			ref={inputRef}
			autoFocus
			id={id}
			data-qa-id="workspace-board-column-rename"
			aria-label={`Rename column ${initialValue}`}
			value={value}
			maxLength={WORKSPACE_BOARD_COLUMN_LABEL_MAX}
			className="h-7 min-w-0 flex-1 px-1 text-sm"
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => settle(true, false)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					settle(true, true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					settle(false, true);
				}
			}}
		/>
	);
}
