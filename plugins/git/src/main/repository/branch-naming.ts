import { objects, predicates } from "friendly-words";

const MAX_ATTEMPTS = 10;
const FALLBACK_MAX_SUFFIX = 100;

/** The random source `generateBranchName` draws from; injectable for tests. */
export type BranchNameRandom = () => number;

/**
 * Sanitize a string into a valid git branch name segment (ported from
 * kilocode): lowercase alphanumeric and hyphens, runs collapsed, edges
 * stripped, capped at `maxLength`.
 */
export function sanitizeBranchName(name: string, maxLength = 50): string {
	return name
		.slice(0, maxLength)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

/**
 * A semantic branch name: the sanitized `prefix` path (`kilo` → `kilo/`)
 * plus the sanitized title, capped at `maxLength` overall. Resolves `""`
 * when nothing survives sanitizing.
 */
export function semanticBranchName(title: string, prefix = "", maxLength = 50): string {
	const parts = prefix
		.split("/")
		.map((part) => sanitizeBranchName(part))
		.filter(Boolean);
	const head = parts.length > 0 ? `${parts.join("/")}/` : "";
	const slug = sanitizeBranchName(title, Math.max(0, maxLength - head.length));
	return slug ? `${head}${slug}` : "";
}

/**
 * Generate a natural two-word slug (e.g. "ambitious-keyboard") using the
 * friendly-words package, deduped against `existing` (kilocode's flow):
 * unique pairs first, then `-0`…`-99` suffixes, then a timestamp.
 */
export function generateBranchName(
	_prompt: string | undefined,
	existing: readonly string[] = [],
	random: BranchNameRandom = Math.random,
): string {
	const taken = new Set(existing.map((name) => name.toLowerCase()));

	const draw = () => {
		const predicate = predicates[Math.floor(random() * predicates.length)];
		const object = objects[Math.floor(random() * objects.length)];
		return `${predicate}-${object}`;
	};

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const candidate = draw();
		if (!taken.has(candidate)) return candidate;
	}

	const base = draw();
	for (let suffix = 0; suffix < FALLBACK_MAX_SUFFIX; suffix++) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}

	return `${base}-${Date.now()}`;
}

/**
 * The first available variant of `base`: itself when free, else `-2`, `-3`,
 * … (kilocode's `availableBranch` — the on-disk and branch-list dedupe).
 */
export function availableBranchName(base: string, existing: readonly string[]): string {
	const taken = new Set(existing);
	if (!taken.has(base)) return base;
	for (let suffix = 2; ; suffix++) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
}
