import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Places `host` among `container`'s column hosts by ascending order. */
function placeHost(container: HTMLDivElement, host: HTMLDivElement, order: number) {
	host.dataset.columnOrder = String(order);
	const next =
		Array.from(container.children).find(
			(element) => element !== host && Number((element as HTMLElement).dataset.columnOrder) > order,
		) ?? null;
	if (host.parentElement !== container || host.nextElementSibling !== next) {
		if (host.isConnected) container.moveBefore(host, next);
		else container.insertBefore(host, next);
	}
}

/** Marks `host` as having committed portaled children so an empty host later means unmount. */
function markHostReady(host: HTMLDivElement) {
	host.dataset.columnReady = "true";
}

// A column owns one portal host for its lifetime. Both destination containers stay
// mounted; moveBefore transfers the connected host without resetting iframe documents
// or React state. Only removing the column tears down its content.
export function PaneColumnMount({
	containerRef,
	order,
	onReady,
	onBeforeRemove,
	children,
}: {
	containerRef: RefObject<HTMLDivElement | null>;
	order: number;
	onReady: () => void;
	onBeforeRemove?: (host: HTMLDivElement) => void;
	children: ReactNode;
}) {
	const [ready, setReady] = useState(false);
	const [host] = useState(() => {
		const element = document.createElement("div");
		element.style.display = "contents";
		return element;
	});

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		placeHost(container, host, order);
		// The container ref only exists after commit, so readiness cannot be derived during render.
		// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
		setReady(true);
	}, [containerRef, host, order]);

	// onReady must run after the commit that portals the children, so the parent sees mounted content.
	// react-doctor-disable-next-line react-doctor/no-effect-chain
	useLayoutEffect(() => {
		if (!ready) return;
		markHostReady(host);
		onReady();
	}, [host, ready, onReady]);

	useLayoutEffect(
		() => () => {
			onBeforeRemove?.(host);
		},
		[host, onBeforeRemove],
	);

	// Remove the portal host only once React has detached its children (real
	// unmount). Under `<Activity mode="hidden">` effects clean up while portaled
	// DOM stays attached; keeping `host` connected preserves descendant iframes.
	useEffect(
		() => () => {
			if (!host.hasChildNodes()) host.remove();
		},
		[host],
	);

	// Mount children in a connected host so autofocus and initial measurements work.
	return ready ? createPortal(children, host) : null;
}
