import { useEffect, useSyncExternalStore } from "react";

import { locateQuote } from "@kilo-desktop/ui/lib/reading/text-anchor";

import type { RevealRequests } from "./reveal-requests";
import { parseTextAnchor, replySurfaces } from "./saved-anchor";

const SETTLE_TRIES = 20;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Takes the window's reveal request for this transcript's chat and scrolls
 * to it: for saved text, the reply (a placeholder mounts once in view), then
 * the passage centred and flashed; for a bookmark, the latest message.
 * Answers how precisely it was found.
 */
export function useRevealRequests(
	requests: RevealRequests | undefined,
	chatId: string | null,
	viewport: () => Element | null,
	/** The transcript shows its messages, older history included (or given up on). */
	ready = true,
): void {
	const version = useSyncExternalStore(requests?.subscribe ?? noSubscribe, () =>
		requests ? requests : null,
	);
	useEffect(() => {
		if (!requests) return;
		const check = () => {
			// Not before the transcript has mounted (the lookups below call this
			// render's `viewport`, which would stay null for the whole search) or
			// shows every message: an older one arrives after the newest page.
			if (!ready || !viewport()) return;
			const request = requests.take(chatId);
			if (!request) return;
			const { target } = request;
			if (target === "latest") {
				void scrollToLatest(viewport).then((found) =>
					request.resolve(found ? "exact" : "unavailable"),
				);
				return;
			}
			void (async () => {
				const selector = (id: string) => `[data-message-id="${CSS.escape(id)}"]`;
				let message: HTMLElement | null = null;
				for (let tries = 0; tries < SETTLE_TRIES && !message; tries += 1) {
					message = viewport()?.querySelector<HTMLElement>(selector(target.messageId)) ?? null;
					if (!message) await nextFrame();
				}
				if (!message) return request.resolve("unavailable");
				centerIn(message, viewport);
				const anchor = parseTextAnchor(target.anchor);
				if (!anchor) {
					holdInView(message, viewport);
					return request.resolve("message");
				}
				let range: Range | null = null;
				for (let tries = 0; tries < SETTLE_TRIES && !range; tries += 1) {
					await nextFrame();
					const mounted = viewport()?.querySelector<HTMLElement>(selector(target.messageId));
					const surfaces = mounted ? replySurfaces(mounted) : [];
					range = surfaces.length > 0 ? locateQuote(surfaces, anchor.selector) : null;
				}
				if (!range) {
					holdInView(message, viewport);
					return request.resolve("message");
				}
				const passage = range.startContainer.parentElement;
				if (passage) {
					centerIn(passage, viewport);
					holdInView(passage, viewport);
				}
				flash(passage);
				request.resolve("exact");
			})();
		};
		check();
		return requests.subscribe(check);
	}, [chatId, ready, requests, version, viewport]);
}

const noSubscribe = () => () => {};

/**
 * Centres an element in the transcript at once. Not `scrollIntoView`: the
 * viewport scrolls smoothly by default, so that would only start an
 * animation (which autoscroll then cuts short), and it moves every
 * scrollable ancestor, not just the transcript.
 */
function centerIn(element: HTMLElement, viewport: () => Element | null): void {
	const area = viewport();
	if (!area) return;
	const box = area.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	const centre = rect.top - box.top - (area.clientHeight - rect.height) / 2;
	area.scrollTo({ top: area.scrollTop + centre, behavior: "instant" });
}

/** How long a revealed passage is held in place while the transcript settles. */
const HOLD_MS = 1_500;
const READER_INPUT = ["wheel", "pointerdown", "touchstart", "keydown"] as const;

/**
 * Keeps a revealed element where the reveal put it while the transcript
 * settles. Messages mounting around it grow the transcript, and
 * assistant-ui's autoscroll, which didn't take the reveal's scroll up (made
 * while the transcript shrank) as leaving the bottom, would follow that
 * growth back to the end. Each drift is scrolled back; one made at a settled
 * height also tells autoscroll the bottom was left. Stops at the reader's
 * first scroll, click or key.
 */
function holdInView(element: HTMLElement, viewport: () => Element | null): void {
	const area = viewport();
	if (!area) return;
	const offset = () => element.getBoundingClientRect().top - area.getBoundingClientRect().top;
	const target = offset();
	const until = performance.now() + HOLD_MS;
	let frame = 0;
	const stop = () => {
		cancelAnimationFrame(frame);
		for (const type of READER_INPUT) area.removeEventListener(type, stop);
	};
	const hold = () => {
		if (!element.isConnected || performance.now() > until) return stop();
		const drift = offset() - target;
		if (Math.abs(drift) > 1) area.scrollTo({ top: area.scrollTop + drift, behavior: "instant" });
		frame = requestAnimationFrame(hold);
	};
	for (const type of READER_INPUT) area.addEventListener(type, stop, { passive: true });
	frame = requestAnimationFrame(hold);
}

/**
 * Scrolls the transcript to its end once it shows messages, again while
 * windowed messages mounting near the end still grow it. Instant: the
 * viewport scrolls smoothly by default.
 */
async function scrollToLatest(viewport: () => Element | null): Promise<boolean> {
	for (let tries = 0; tries < SETTLE_TRIES; tries += 1) {
		const area = viewport();
		if (area?.querySelector("[data-message-id]")) {
			area.scrollTo({ top: area.scrollHeight, behavior: "instant" });
			await nextFrame();
			if (area.scrollHeight - area.clientHeight - area.scrollTop < 2) return true;
		} else {
			await nextFrame();
		}
	}
	return false;
}

function flash(element: HTMLElement | null): void {
	const block =
		element?.closest<HTMLElement>("p, li, h1, h2, h3, h4, h5, h6, blockquote, td") ?? element;
	block?.animate?.(
		[
			{ backgroundColor: "color-mix(in oklch, var(--foreground) 12%, transparent)" },
			{ backgroundColor: "transparent" },
		],
		{ duration: 1200, easing: "ease-out" },
	);
}
