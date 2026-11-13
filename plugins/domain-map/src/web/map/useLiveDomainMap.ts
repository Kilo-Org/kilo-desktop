import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKernel, useSdk } from "@kilo-desktop/kernel/web";

import type { Activity } from "./activity";
import { ActivityLog, type ActivityEntry } from "./activity-log";
import { DomainMapScene } from "./DomainMapScene";
import { usersOf, type DomainMap } from "./model";
import { useMapPreferences } from "./preferences";
import { useDomainMap } from "./useDomainMap";

/** How often the live log re-renders while activity streams in. */
const LOG_REFRESH_MS = 150;

const LABEL_CLASS =
	"px-1 text-[10px] font-medium text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]";
const PLANE_LABEL_CLASS = "text-[11px] font-semibold tracking-widest text-white/45 uppercase";
const TOOLTIP_CLASS =
	"rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md";

/** A scene for as long as its canvas is mounted. */
function useScene(canvas: HTMLCanvasElement | null, onSelect: (domainId: string | null) => void) {
	const [scene, setScene] = useState<DomainMapScene | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;
	useEffect(() => {
		if (!canvas) return;
		let created: DomainMapScene;
		try {
			created = new DomainMapScene(canvas, {
				onSelect: (id) => onSelectRef.current(id),
				labelClassName: LABEL_CLASS,
				planeLabelClassName: PLANE_LABEL_CLASS,
				tooltipClassName: TOOLTIP_CLASS,
			});
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
			return;
		}
		setFailure(null);
		setScene(created);
		return () => {
			created.dispose();
			setScene(null);
		};
	}, [canvas]);
	return { scene, failure };
}

/**
 * Follows every domain object provided in this window (main's through their
 * mirrors): its state changes and each of its events, as a plain listener of
 * this plugin. The kernel doesn't tell plugins who else listens, so this is
 * what the domain objects do, not who receives it.
 */
function useDomainActivity(map: DomainMap, onActivity: (activity: Activity) => void) {
	const kernel = useKernel();
	const sdk = useSdk();
	const latest = useRef(onActivity);
	latest.current = onActivity;
	const watched = map.domains
		.filter((domain) => domain.provided)
		.map((domain) => domain.id)
		.join("\n");
	useEffect(() => {
		const stops: (() => void)[] = [];
		for (const id of watched ? watched.split("\n") : []) {
			const record = kernel.discovery.domainObjects.get(id as never);
			if (!record) continue;
			const handle = sdk.domainObjects.get(record.definition);
			if (!handle) continue;
			stops.push(handle.subscribe(() => latest.current({ kind: "state", domainId: id })));
			for (const event of Object.keys(record.definition.events)) {
				stops.push(
					handle.on(event as never, (payload: unknown) =>
						latest.current({ kind: "event", domainId: id, event, payload }),
					),
				);
			}
		}
		return () => {
			for (const stop of stops) stop();
		};
	}, [kernel, sdk, watched]);
}

export interface LiveDomainMap {
	readonly canvasRef: (canvas: HTMLCanvasElement | null) => void;
	readonly scene: DomainMapScene | null;
	/** Why the 3D view couldn't start (no WebGL 2), if it couldn't. */
	readonly failure: string | null;
	readonly map: DomainMap;
	/** Latest activity, newest first. */
	readonly entries: readonly ActivityEntry[];
}

/**
 * The Domain Map kept live: the map from what plugins declare, a scene
 * drawing it on the attached canvas, and every state change and event of the
 * domain objects this window can see, animated and logged as this window's
 * preferences allow.
 */
export function useLiveDomainMap({
	selected,
	onSelect,
}: {
	readonly selected: string | null;
	readonly onSelect: (domainId: string | null) => void;
}): LiveDomainMap {
	const preferences = useMapPreferences();
	const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
	const canvasRef = useCallback((element: HTMLCanvasElement | null) => setCanvas(element), []);
	const map = useDomainMap({
		includeUnprovided: preferences.includeUnprovided,
		includePoints: preferences.showPoints,
	});
	const { scene, failure } = useScene(canvas, onSelect);
	const log = useMemo(() => new ActivityLog(), []);
	const [entries, setEntries] = useState<readonly ActivityEntry[]>([]);

	useEffect(() => scene?.show(map), [scene, map]);
	useEffect(() => scene?.select(selected), [scene, selected]);
	useEffect(() => {
		if (scene) scene.paused = !preferences.live;
	}, [scene, preferences.live]);
	useEffect(() => {
		if (scene) scene.autoRotate = preferences.rotate;
	}, [scene, preferences.rotate]);
	useEffect(() => {
		if (scene) scene.showPlugins = preferences.showPlugins;
	}, [scene, preferences.showPlugins]);
	useEffect(() => {
		if (scene) scene.onlyActive = preferences.onlyActive;
	}, [scene, preferences.onlyActive]);

	const latest = useRef({ map, scene, preferences });
	latest.current = { map, scene, preferences };
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	useDomainActivity(map, (activity) => {
		const current = latest.current;
		if (!current.preferences.live) return;
		if (activity.kind === "state" && !current.preferences.showState) return;
		const users = current.scene
			? current.scene.deliver(activity)
			: usersOf(current.map, activity.domainId).length;
		log.add(activity, users);
		timer.current ??= setTimeout(() => {
			timer.current = undefined;
			setEntries(log.entries());
		}, LOG_REFRESH_MS);
	});

	return { canvasRef, scene, failure, map, entries };
}
