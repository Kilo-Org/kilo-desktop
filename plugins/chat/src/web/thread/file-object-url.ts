import { useSyncExternalStore } from "react";

/*
 * Object URLs for local files, shared by everything showing the same file.
 * A URL exists while at least one subscriber holds it: the first subscriber
 * creates it, the last one to leave revokes it. Subscribing happens after
 * commit, so a render that never commits creates nothing and leaks nothing.
 * Each file keeps one subscribe function so React never resubscribes (which
 * would revoke and recreate the URL) just because a component re-rendered.
 */

const held = new Map<File, { readonly url: string; holders: number }>();
const subscribers = new WeakMap<File, (onChange: () => void) => () => void>();

function hold(file: File): void {
	const entry = held.get(file);
	if (entry) entry.holders += 1;
	else held.set(file, { url: URL.createObjectURL(file), holders: 1 });
}

function release(file: File): void {
	const entry = held.get(file);
	if (!entry) return;
	entry.holders -= 1;
	if (entry.holders > 0) return;
	held.delete(file);
	URL.revokeObjectURL(entry.url);
}

function subscribeTo(file: File): (onChange: () => void) => () => void {
	let subscribe = subscribers.get(file);
	if (!subscribe) {
		subscribe = (onChange) => {
			hold(file);
			onChange();
			return () => release(file);
		};
		subscribers.set(file, subscribe);
	}
	return subscribe;
}

const subscribeToNothing = () => () => undefined;

/** An object URL for `file` while the calling component is mounted. */
export function useFileObjectUrl(file: File | undefined): string | undefined {
	const read = () => (file ? held.get(file)?.url : undefined);
	return useSyncExternalStore(file ? subscribeTo(file) : subscribeToNothing, read, read);
}
