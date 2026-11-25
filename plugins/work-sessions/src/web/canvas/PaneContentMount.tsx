import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ContentHost = {
	readonly element: HTMLDivElement;
	readonly onTargetReady: () => void;
};

export type PaneContentMountRegistry = {
	/** The hidden element that holds hosts between targets; a callback ref. */
	readonly setParking: (element: HTMLDivElement | null) => void;
	readonly attachTarget: (paneId: string, target: HTMLDivElement) => void;
	/** Whether the pane still has a connected target, i.e. it was hidden, not removed. */
	readonly hasLiveTarget: (paneId: string) => boolean;
	readonly parkDescendants: (root: HTMLDivElement) => void;
	readonly parkPanes: (paneIds: Iterable<string>) => void;
	/** Moves the host into its pane's target, if one is connected, and reports it ready. */
	readonly registerHost: (paneId: string, host: ContentHost) => void;
	readonly restoreParked: () => void;
	readonly unregisterHost: (paneId: string, host: HTMLDivElement) => void;
};

function moveConnectedHost(host: HTMLDivElement, destination: HTMLDivElement) {
	if (host.parentElement === destination || !destination.isConnected) return;
	if (host.isConnected) destination.moveBefore(host, null);
	else destination.append(host);
}

// Pane content has a longer lifetime than its current group or column. Targets may
// be replaced by a layout move, so the registry parks each connected portal host
// before its old target is removed and transfers it into the next target without
// resetting iframe documents or React state.
export function createPaneContentMountRegistry(): PaneContentMountRegistry {
	let parkingElement: HTMLDivElement | null = null;
	const hosts = new Map<string, ContentHost>();
	const targets = new Map<string, HTMLDivElement>();
	const parked = new Set<string>();

	const parkPane = (paneId: string, parking: HTMLDivElement) => {
		const host = hosts.get(paneId)?.element;
		if (!host) return;
		moveConnectedHost(host, parking);
		parked.add(paneId);
	};

	return {
		setParking(element) {
			parkingElement = element;
		},
		attachTarget(paneId, target) {
			targets.set(paneId, target);
			const host = hosts.get(paneId);
			if (!host) return;
			moveConnectedHost(host.element, target);
			parked.delete(paneId);
			host.onTargetReady();
		},
		hasLiveTarget(paneId) {
			return targets.get(paneId)?.isConnected === true;
		},
		parkPanes(paneIds) {
			const parking = parkingElement;
			if (!parking) return;
			for (const paneId of paneIds) parkPane(paneId, parking);
		},
		parkDescendants(root) {
			const parking = parkingElement;
			if (!parking) return;
			for (const [paneId, host] of hosts) {
				if (root.contains(host.element)) parkPane(paneId, parking);
			}
		},
		registerHost(paneId, host) {
			hosts.set(paneId, host);
			const target = targets.get(paneId);
			if (!target?.isConnected) return;
			moveConnectedHost(host.element, target);
			host.onTargetReady();
		},
		restoreParked() {
			for (const paneId of parked) {
				const host = hosts.get(paneId)?.element;
				const target = targets.get(paneId);
				if (!host || !target?.isConnected) continue;
				moveConnectedHost(host, target);
				parked.delete(paneId);
			}
		},
		unregisterHost(paneId, host) {
			if (hosts.get(paneId)?.element === host) {
				hosts.delete(paneId);
				parked.delete(paneId);
			}
		},
	};
}

export function PaneContentMount({
	paneId,
	registry,
	children,
}: {
	paneId: string;
	registry: PaneContentMountRegistry;
	children: ReactNode;
}) {
	const [ready, setReady] = useState(false);
	const [host] = useState(() => {
		const element = document.createElement("div");
		element.style.display = "contents";
		return element;
	});

	useLayoutEffect(() => {
		registry.registerHost(paneId, {
			element: host,
			onTargetReady: () => setReady(true),
		});
		return () => registry.unregisterHost(paneId, host);
	}, [host, paneId, registry]);

	// `<Activity mode="hidden">` disconnects effects while the pane stays in the
	// page, and an idle tab of a kind without `keepAlive` can legitimately be an
	// empty host. Only a pane that is really gone takes its target with it, so the
	// target — not the host's emptiness — says whether this is an unmount.
	useEffect(
		() => () => {
			if (!registry.hasLiveTarget(paneId)) host.remove();
		},
		[host, paneId, registry],
	);

	return ready ? createPortal(children, host) : null;
}

export function PaneContentTarget({
	paneId,
	registry,
}: {
	paneId: string;
	registry: PaneContentMountRegistry;
}) {
	const targetRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const target = targetRef.current;
		if (target) registry.attachTarget(paneId, target);
	});

	return <div ref={targetRef} className="contents" />;
}
