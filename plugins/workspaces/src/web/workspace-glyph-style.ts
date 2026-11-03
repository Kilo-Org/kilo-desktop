import type { CSSProperties } from "react";

import { normalizeWorkspaceIdentityColor } from "../contracts";

/** Normalized `#RRGGBB` for Lucide `color` (stroke). Undefined leaves currentColor. */
export function workspaceGlyphColor(color: string | undefined): string | undefined {
	return normalizeWorkspaceIdentityColor(color) ?? undefined;
}

/** Inline `color` for folder/list glyphs. Undefined leaves the current text color. */
export function workspaceGlyphStyle(color: string | undefined): CSSProperties | undefined {
	const hex = workspaceGlyphColor(color);
	if (!hex) return undefined;
	return { color: hex };
}
