import type { FileTreeIcons } from "@pierre/trees";

export const NOTEBOOK_FILE_ICON_NAME = "file-tree-icon-notebook";

export const FILE_ICON_CUSTOM_SPRITE_SHEET = `<svg data-icon-sprite aria-hidden="true" width="0" height="0" xmlns="http://www.w3.org/2000/svg">
	<symbol id="${NOTEBOOK_FILE_ICON_NAME}" viewBox="0 0 16 16">
		<path fill="currentColor" d="M5 1h7.5A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2m0 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5z"/>
		<path fill="currentColor" d="M1.5 3.5h4v1h-4zm0 4h4v1h-4zm0 4h4v1h-4z"/>
	</symbol>
</svg>`;

export const FILE_ICONS = {
	set: "complete",
	spriteSheet: FILE_ICON_CUSTOM_SPRITE_SHEET,
	byFileExtension: {
		ipynb: { name: NOTEBOOK_FILE_ICON_NAME, viewBox: "0 0 16 16" },
	},
} as const satisfies FileTreeIcons;
