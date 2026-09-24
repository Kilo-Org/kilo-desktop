import { useEffect, useState, type RefObject } from "react";

export interface PaneVisibility {
	/**
	 * Resolves once the pane is visible: immediately when it already is, on
	 * the transition to visible, or when `signal` aborts. Never rejects.
	 */
	whenVisible(signal: AbortSignal): Promise<void>;
}

/**
 * Tracks whether the pane rooted at `ref` can be seen, without React state
 * (visibility changes never re-render the view).
 *
 * Visible means the pane's document is visible AND its root intersects the
 * viewport. The second half covers what focus and document visibility
 * cannot: kilo-ui keeps parked tabs mounted and hides other groups and
 * columns with `hidden`, so a hidden Changes pane sits in a visible,
 * focused window. VS Code's SCM waits for window focus instead; this
 * follows its agent host's "only while observed" model and keeps updating
 * a window that is visible but unfocused (a second monitor).
 *
 * The observer is created from the root's own `ownerDocument.defaultView`,
 * so popped-out panes (portaled into another window) track that window.
 * Until the first observation the pane counts as visible.
 */
export function usePaneVisibility(ref: RefObject<HTMLElement | null>): PaneVisibility {
	const [tracker] = useState(createVisibilityTracker);

	useEffect(() => {
		const element = ref.current;
		if (element == null) {
			return;
		}
		return tracker.attach(element);
	}, [ref, tracker]);

	return tracker;
}

function createVisibilityTracker(): PaneVisibility & {
	attach(element: HTMLElement): () => void;
} {
	let ownerDocument: Document | null = null;
	let intersecting = true;
	const waiters = new Set<() => void>();

	const isVisible = () =>
		intersecting && (ownerDocument == null || ownerDocument.visibilityState === "visible");

	const releaseWaitersIfVisible = () => {
		if (!isVisible()) {
			return;
		}
		for (const release of [...waiters]) {
			release();
		}
	};

	return {
		attach(element) {
			const doc = element.ownerDocument;
			ownerDocument = doc;
			const view = doc.defaultView;
			const observer =
				view == null
					? undefined
					: new view.IntersectionObserver((entries) => {
							const latest = entries.at(-1);
							if (latest != null) {
								intersecting = latest.isIntersecting;
								releaseWaitersIfVisible();
							}
						});
			observer?.observe(element);
			doc.addEventListener("visibilitychange", releaseWaitersIfVisible);
			return () => {
				observer?.disconnect();
				doc.removeEventListener("visibilitychange", releaseWaitersIfVisible);
				ownerDocument = null;
				intersecting = true;
				releaseWaitersIfVisible();
			};
		},
		whenVisible(signal) {
			if (signal.aborted || isVisible()) {
				return Promise.resolve();
			}
			return new Promise((resolve) => {
				const release = () => {
					waiters.delete(release);
					signal.removeEventListener("abort", release);
					resolve();
				};
				waiters.add(release);
				signal.addEventListener("abort", release, { once: true });
			});
		},
	};
}
