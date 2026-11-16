import { useEffect, useState } from "react";
import { ActivityIcon, NotebookPenIcon } from "lucide-react";

import { definePlugin } from "@kilo-desktop/kernel";
import { RightSidebarPanel } from "@kilo-desktop/plugin-shell/contracts";

const NOTES_KEY = "example.right-panel.notes";
const TICK_MS = 2000;
const MAX_EVENTS = 50;

/** A panel that keeps what you type, across launches. */
function ScratchNotes() {
	const [text, setText] = useState(() => localStorage.getItem(NOTES_KEY) ?? "");
	return (
		<textarea
			value={text}
			onChange={(event) => {
				setText(event.target.value);
				localStorage.setItem(NOTES_KEY, event.target.value);
			}}
			aria-label="Scratch notes"
			placeholder="Jot something down…"
			className="placeholder:text-muted-foreground min-h-0 flex-1 resize-none bg-transparent p-3 text-sm outline-none"
		/>
	);
}

/**
 * A panel with live state: it only runs while open, since the shell mounts a
 * panel's component when it opens and unmounts it when it closes.
 */
function Activity() {
	const [events, setEvents] = useState<readonly string[]>([]);
	useEffect(() => {
		const timer = setInterval(() => {
			const at = new Date().toLocaleTimeString();
			setEvents((previous) => [`Tick at ${at}`, ...previous].slice(0, MAX_EVENTS));
		}, TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return (
		<ul aria-label="Activity" className="flex flex-col gap-1 p-3 text-sm">
			{events.length === 0 ? <li className="text-muted-foreground">Waiting for events…</li> : null}
			{events.map((event, index) => (
				<li key={events.length - index} className="bg-muted rounded px-2 py-1">
					{event}
				</li>
			))}
		</ul>
	);
}

/**
 * example.right-panel's renderer entry: binds a component and a rail icon to
 * each `kilo.shell/right-sidebar-panel` its manifest declares (by the same
 * local ids). Each panel's title, rail order (`priority`) and starting `width`
 * are metadata in the manifest; only the component and icon are code.
 */
export const rightPanelWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(RightSidebarPanel, "notes", {
			component: ScratchNotes,
			icon: NotebookPenIcon,
		});
		sdk.extensions.implement(RightSidebarPanel, "activity", {
			component: Activity,
			icon: ActivityIcon,
		});
	},
});
