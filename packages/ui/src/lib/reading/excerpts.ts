/**
 * Text copied while reading in Focus, remembered only as a 32-bit hash for a
 * few minutes so telemetry can tell that an excerpt was pasted into a prompt
 * without ever keeping or sending the text. One store per window (module
 * state); nothing persists.
 */

const KEEP_MS = 5 * 60_000;

interface Excerpt {
	readonly hash: number;
	readonly copiedAt: number;
	readonly surface: string;
}

let excerpts: Excerpt[] = [];

/** FNV-1a over the normalized text (whitespace collapsed, trimmed). */
export function excerptHash(text: string): number {
	const normalized = text.replace(/\s+/gu, " ").trim();
	let hash = 0x811c9dc5;
	for (let index = 0; index < normalized.length; index += 1) {
		hash ^= normalized.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

const prune = (now: number) => {
	excerpts = excerpts.filter((excerpt) => now - excerpt.copiedAt < KEEP_MS);
};

export function rememberExcerpt(text: string, surface: string, now = Date.now()): void {
	if (!text.trim()) return;
	prune(now);
	excerpts = [...excerpts, { hash: excerptHash(text), copiedAt: now, surface }];
}

export interface ExcerptMatch {
	readonly secondsSinceCopy: number;
	readonly surface: string;
}

/** Whether `text` (e.g. pasted into a composer) is an excerpt copied in Focus in the last few minutes. */
export function matchExcerpt(text: string, now = Date.now()): ExcerptMatch | null {
	prune(now);
	const hash = excerptHash(text);
	const match = excerpts.findLast((excerpt) => excerpt.hash === hash);
	return match
		? { secondsSinceCopy: Math.round((now - match.copiedAt) / 1000), surface: match.surface }
		: null;
}

export function forgetExcerpts(): void {
	excerpts = [];
}
