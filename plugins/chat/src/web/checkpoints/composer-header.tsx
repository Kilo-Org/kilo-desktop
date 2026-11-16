import type { FC } from "react";

import { useRevertBoundaryId } from "./checkpoint-revert";
import { CheckpointRestoreControls } from "./checkpoint-restore-controls";

/** Renders checkpoint restore controls above the composer while a revert is pending. */
export const ComposerHeader: FC = () => {
	const boundaryId = useRevertBoundaryId();
	if (boundaryId === undefined) return null;

	return (
		<div
			data-slot="aui_composer-header"
			data-qa-id="kilo-composer-header"
			className="relative z-0 mb-2 flex w-full"
		>
			<CheckpointRestoreControls />
		</div>
	);
};
