import { homedir } from "node:os";

import type { makeElectronTransport } from "@sentry/electron/main";

import { FILTERED_VALUE, isSensitiveKey, redactSecretValues } from "./sentry-secret-patterns.js";

/**
 * Client-side scrubbing for Sentry events.
 *
 * With no `beforeSend`, Sentry sends whatever it captures by default. `dataCollection`
 * is pinned to the restrictive v10 baseline (no user info/IP, cookies, bodies or stack
 * frame variables), but these leaks remain and are NOT covered by Sentry's built-in
 * scrubbers:
 *
 * 1. The **OS username**, embedded in absolute file paths in stack frames, exception
 *    messages, and breadcrumbs (`/Users/<name>/…`, `/home/<name>/…`, `\Users\<name>\…`).
 * 2. The **machine hostname**, attached as `server_name` (and possibly `contexts.device.name`).
 * 3. **Credentials in text**: an error, log line or URL can quote an API key, a
 *    Bearer token, a JWT or a database URL with its password (`sentry-secret-patterns.ts`),
 *    and a value under a key such as `authorization` or `apiKey` is one by name.
 *    Console breadcrumbs are dropped whole, because their formatted log text is
 *    free-form; the local log file keeps that text.
 *
 * This module removes them before data leaves the process. Errors are scrubbed in
 * `beforeSend` and breadcrumbs in `beforeBreadcrumb`: renderer errors are forwarded to
 * the main-process client (IPCMode.Classic) and re-captured there, so these hooks cover
 * them too. The transport scrubs every envelope item again via `scrubEnvelope` (deny by
 * default), which covers transactions (SDK v11 streams spans and ignores
 * `beforeSendTransaction`) and the spans, logs and metrics @sentry/electron forwards
 * from renderers straight to the transport without running main's `beforeSendSpan` /
 * `beforeSendLog` / `beforeSendMetric`.
 *
 * This is data minimization only — it does NOT grant collection consent. Gating Sentry
 * on `allowDataCollection` is a separate concern.
 */

const USER_PATH_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
	// POSIX home roots: /Users/<name>/…, /home/<name>/…
	[/(\/Users\/)[^/\\]+/gi, "$1<redacted>"],
	[/(\/home\/)[^/\\]+/gi, "$1<redacted>"],
	// Windows: C:\Users\<name>\… or \Users\<name>\…
	[/((?:[A-Za-z]:)?\\Users\\)[^\\/]+/gi, "$1<redacted>"],
];

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The home dir is the same for every string of a process, so its pattern is
// compiled once and reused until another home is passed.
let compiledHome: { readonly home: string; readonly pattern: RegExp | undefined } | undefined;

function homePattern(home: string): RegExp | undefined {
	if (compiledHome?.home !== home) {
		compiledHome = {
			home,
			pattern:
				home.length > 1 ? new RegExp(String.raw`${escapeRegExp(home)}(?=[/\\]|$)`, "g") : undefined,
		};
	}
	return compiledHome.pattern;
}

/** Replace the current home directory and any user-home path segment with placeholders. */
export function redactPiiString(value: string, home: string = homedir()): string {
	let out = value;
	// Redact the literal home dir, but only when it ends on a path boundary. A plain
	// substring match would also hit a *different* user whose name merely starts with
	// the current one (home `/Users/alice` vs path `/Users/alicesmith/…`), turning it
	// into `<home>smith/…` — which no longer carries the `/Users/` prefix the
	// per-segment patterns below rely on, leaking the `smith` fragment. Leaving the
	// non-boundary case untouched lets those patterns redact it in full instead.
	const pattern = homePattern(home);
	if (pattern) out = out.replace(pattern, "<home>");
	for (const [userPath, replacement] of USER_PATH_PATTERNS) {
		out = out.replace(userPath, replacement);
	}
	return out;
}

const MAX_DEPTH = 12;

/**
 * A value under a credential key is filtered whole. A span or log attribute
 * (`{ type, value, … }`) stays an attribute: a string one holding `[Filtered]`.
 */
function filterSensitiveValue(value: unknown): unknown {
	if (value !== null && typeof value === "object" && "value" in value) {
		return { type: "string", value: FILTERED_VALUE };
	}
	return FILTERED_VALUE;
}

/** The redacted form of one value; containers are redacted in place, and past the depth limit filtered. */
function redactValue(value: unknown, home: string, seen: WeakSet<object>, depth: number): unknown {
	if (typeof value === "string") return redactPiiString(redactSecretValues(value), home);
	if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
	if (depth > MAX_DEPTH) return FILTERED_VALUE;
	deepRedact(value, home, seen, depth);
	return value;
}

function deepRedact(node: object, home: string, seen: WeakSet<object>, depth: number): void {
	if (seen.has(node)) return;
	seen.add(node);

	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			node[i] = redactValue(node[i], home, seen, depth + 1);
		}
		return;
	}

	const record = node as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		const value = record[key];
		// An attribute (`{ type, value }`) is judged by its inner value: a token count stays readable.
		const plain =
			value !== null && typeof value === "object" && "value" in value ? value.value : value;
		record[key] = isSensitiveKey(key, plain)
			? filterSensitiveValue(value)
			: redactValue(value, home, seen, depth + 1);
	}
}

type ScrubbedBreadcrumb = { category?: unknown };

function isConsoleBreadcrumb(breadcrumb: unknown): boolean {
	return (
		breadcrumb !== null &&
		typeof breadcrumb === "object" &&
		(breadcrumb as ScrubbedBreadcrumb).category === "console"
	);
}

/**
 * The `beforeBreadcrumb` hook: drops console breadcrumbs and redacts credentials
 * and the OS username from the rest, in place.
 */
export function scrubSentryBreadcrumb<T extends object>(
	breadcrumb: T,
	home: string = homedir(),
): T | null {
	if (isConsoleBreadcrumb(breadcrumb)) return null;
	deepRedact(breadcrumb, home, new WeakSet<object>(), 0);
	return breadcrumb;
}

type ScrubbedStacktrace = { stacktrace?: { frames?: Array<Record<string, unknown>> } };

/** Local variables of a frame can hold any value in scope, credentials included. */
function dropFrameVariables(container: unknown): void {
	const values = (container as { values?: ScrubbedStacktrace[] } | undefined)?.values;
	if (!Array.isArray(values)) return;
	for (const value of values) {
		for (const frame of value?.stacktrace?.frames ?? []) {
			delete frame.vars;
		}
	}
}

/**
 * Scrub a Sentry event in place and return it:
 * - drops the machine hostname (`server_name`, `contexts.device.name`);
 * - strips identifying `user` fields, keeping only the anonymous `id`;
 * - drops console breadcrumbs and stack frame variables;
 * - redacts credentials and the home dir / OS username from every string value
 *   (paths, messages, exception values, breadcrumbs).
 */
export function scrubSentryEvent<T>(event: T, home: string = homedir()): T {
	if (event === null || typeof event !== "object") return event;
	const record = event as Record<string, unknown>;

	// Machine hostname — we already correlate installs via the anonymous user.id.
	if ("server_name" in record) record.server_name = undefined;
	const contexts = record.contexts as Record<string, unknown> | undefined;
	const device = contexts?.device as Record<string, unknown> | undefined;
	if (device && "name" in device) device.name = undefined;

	// Keep only the anonymous install id on `user`.
	const user = record.user as Record<string, unknown> | undefined;
	if (user) {
		for (const key of ["ip_address", "email", "username", "name"]) {
			if (key in user) delete user[key];
		}
	}

	if (Array.isArray(record.breadcrumbs)) {
		record.breadcrumbs = record.breadcrumbs.filter((crumb) => !isConsoleBreadcrumb(crumb));
	}
	dropFrameVariables(record.exception);
	dropFrameVariables(record.threads);

	deepRedact(record, home, new WeakSet<object>(), 0);
	return event;
}

/** Sentry's `Envelope`, reached via an export we depend on (`@sentry/core` is not a direct dependency). */
export type SentryEnvelope = Parameters<ReturnType<typeof makeElectronTransport>["send"]>[0];

/** Item types that hold a whole event, scrubbed like `beforeSend` does. */
const EVENT_ITEM_TYPES: ReadonlySet<string> = new Set(["event", "transaction", "feedback"]);

/**
 * Redact credentials and the home dir / OS username from every item of an
 * envelope, in place, and return it. Deny by default: every JSON or text item
 * is scrubbed, because renderers forward spans, logs and metrics straight to
 * the transport, past main's hooks; only binary attachments (minidumps,
 * screenshots) pass as they are. The trace header's transaction name is a span
 * name and is redacted too.
 */
export function scrubEnvelope(envelope: SentryEnvelope, home: string = homedir()): SentryEnvelope {
	const trace = (envelope?.[0] as { trace?: { transaction?: unknown } } | undefined)?.trace;
	if (typeof trace?.transaction === "string") {
		trace.transaction = redactPiiString(redactSecretValues(trace.transaction), home);
	}
	const items: unknown = envelope?.[1];
	if (!Array.isArray(items)) return envelope;
	for (const item of items as Array<[{ type?: string } | undefined, unknown]>) {
		const [itemHeader, payload] = item;
		if (typeof payload === "string") {
			item[1] = redactPiiString(redactSecretValues(payload), home);
		} else if (EVENT_ITEM_TYPES.has(itemHeader?.type ?? "")) {
			scrubSentryEvent(payload, home);
		} else {
			item[1] = redactValue(payload, home, new WeakSet<object>(), 0);
		}
	}
	return envelope;
}
