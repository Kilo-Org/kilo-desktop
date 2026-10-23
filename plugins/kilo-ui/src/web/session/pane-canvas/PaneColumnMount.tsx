import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

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
		host.dataset.columnOrder = String(order);
		const next =
			Array.from(container.children).find(
				(element) =>
					element !== host && Number((element as HTMLElement).dataset.columnOrder) > order,
			) ?? null;
		if (host.parentElement !== container || host.nextElementSibling !== next) {
			if (host.isConnected) container.moveBefore(host, next);
			else container.insertBefore(host, next);
		}
		setReady(true);
	}, [containerRef, host, order]);

	useLayoutEffect(() => {
		if (ready) onReady();
	}, [ready, onReady]);

	useLayoutEffect(
		() => () => {
			onBeforeRemove?.(host);
			host.remove();
		},
		[host, onBeforeRemove],
	);

	// Mount children in a connected host so autofocus and initial measurements work.
	return ready ? createPortal(children, host) : null;
}
