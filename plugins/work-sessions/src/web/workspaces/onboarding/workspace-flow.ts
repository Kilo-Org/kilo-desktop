const PILL_WIDTH = 128;
const WIRE = 44;
const TILE_WIDTH = 104;

/**
 * Geometry for the workspace showcase diagram (folders → workspace → Kilo).
 * Fixed px coordinates so the HTML pills and the SVG connectors share one
 * coordinate space. Mirror-symmetric — folder pills, wire, tile, wire, a Kilo
 * pill of the same width — so the workspace tile sits at the exact centre of
 * the diagram, which is centred in the showcase panel. At the narrowest split
 * layout the 448px width spills into the panel's padding rather than clipping.
 */
export const FLOW = {
	width: PILL_WIDTH * 2 + WIRE * 2 + TILE_WIDTH,
	height: 216,
	pillWidth: PILL_WIDTH,
	pillHeight: 34,
	pillGap: 12,
	tileX: PILL_WIDTH + WIRE,
	tileWidth: TILE_WIDTH,
	tileHeight: 104,
	kiloX: PILL_WIDTH + WIRE * 2 + TILE_WIDTH,
	maxPills: 4,
} as const;

export type FlowPill = {
	key: string;
	label: string;
	/** The empty-state stand-in ("Add a folder") or the overflow summary. */
	placeholder: boolean;
	y: number;
	connector: string;
};

export type WorkspaceFlow = {
	pills: FlowPill[];
	/** No real folders yet: connectors render dashed. */
	pending: boolean;
};

function labels(folders: readonly string[]): { label: string; placeholder: boolean }[] {
	if (folders.length === 0) return [{ label: "Add a folder", placeholder: true }];
	if (folders.length <= FLOW.maxPills)
		return folders.map((label) => ({ label, placeholder: false }));
	const shown = folders.slice(0, FLOW.maxPills - 1).map((label) => ({ label, placeholder: false }));
	return [...shown, { label: `+${folders.length - shown.length} more`, placeholder: true }];
}

export function workspaceFlow(folders: readonly string[]): WorkspaceFlow {
	const items = labels(folders);
	const column = items.length * FLOW.pillHeight + (items.length - 1) * FLOW.pillGap;
	const top = (FLOW.height - column) / 2;
	const tileY = FLOW.height / 2;
	const bend = (FLOW.pillWidth + FLOW.tileX) / 2;
	return {
		pending: folders.length === 0,
		pills: items.map((item, index) => {
			const y = top + index * (FLOW.pillHeight + FLOW.pillGap);
			const pillY = y + FLOW.pillHeight / 2;
			return {
				key: item.placeholder ? `placeholder-${item.label}` : `${index}-${item.label}`,
				...item,
				y,
				connector: `M ${FLOW.pillWidth} ${pillY} C ${bend} ${pillY}, ${bend} ${tileY}, ${FLOW.tileX} ${tileY}`,
			};
		}),
	};
}
