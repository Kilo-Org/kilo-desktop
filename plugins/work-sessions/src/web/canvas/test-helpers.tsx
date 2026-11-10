import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import type { Arrangement, PaneLayout } from "@kilo-desktop/pane-layout";
import { PaneCanvas } from "./PaneCanvas";

export function renderDragCanvas(
	initial: PaneLayout,
	{
		arrangement = "tiles",
		width = 1000,
		topPadding = 0,
	}: { arrangement?: Arrangement; width?: number; topPadding?: number } = {},
) {
	const commit = vi.fn<(layout: PaneLayout) => void>();
	function Harness() {
		const [layout, setLayout] = useState(initial);
		return (
			<div style={{ display: "flex", width, height: 500, paddingTop: topPadding }}>
				<PaneCanvas
					layout={layout}
					arrangement={arrangement}
					kinds={[]}
					onLayoutChange={(next) => {
						commit(next);
						setLayout(next);
					}}
					onSelectPane={vi.fn()}
					onLaunch={vi.fn()}
					renderPane={(id) => <textarea aria-label={id} defaultValue="Unsaved work" />}
				/>
			</div>
		);
	}
	return { ...render(<Harness />), commit };
}

// Synthetic events exercise geometry deterministically; pointer capture requires
// a native pointer and is covered separately by the browser interaction test.
export function startPaneDrag(source: HTMLElement) {
	const pointerId = 1;
	const box = source.getBoundingClientRect();
	source.setPointerCapture = vi.fn();
	source.hasPointerCapture = vi.fn(() => false);
	fireEvent.pointerDown(source, {
		button: 0,
		pointerId,
		clientX: box.left + 8,
		clientY: box.top + 8,
	});
	return {
		move: (x: number, y: number) =>
			fireEvent.pointerMove(source, { pointerId, clientX: x, clientY: y }),
		drop: () => fireEvent.pointerUp(source, { pointerId }),
	};
}
