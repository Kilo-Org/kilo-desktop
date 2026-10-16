import { homedir } from "node:os";

import type { makeElectronTransport } from "@sentry/electron/main";

/**
 * Client-side PII scrubbing for Sentry events.
 *
 * With no `beforeSend`, Sentry sends whatever it captures by default. `dataCollection`
 * is pinned to the restrictive v10 baseline (no user info/IP, cookies, or bodies), but
 * two identifying leaks remain and are NOT covered by Sentry's built-in secret scrubbers:
 *
 * 1. The **OS username**, embedded in absolute file paths in stack frames, exception
 *    messages, and breadcrumbs (`/Users/<name>/…`, `/home/<name>/…`, `\Users\<name>\…`).
 * 2. The **machine hostname**, attached as `server_name` (and possibly `contexts.device.name`).
 *
 * This module removes both before data leaves the process. Errors are scrubbed in
 * `beforeSend`: renderer errors are forwarded to the main-process client
 * (IPCMode.Classic) and re-captured there, so that hook covers them too. Streamed spans
 * (SDK v11 has no transactions), logs and metrics are scrubbed at the transport via
 * `scrubEnvelope`, because @sentry/electron forwards those from renderers straight to
 * the transport without running main's `beforeSendSpan` / `beforeSendLog` /
 * `beforeSendMetric`.
 *
 * This is data minimization only — it does NOT grant collection consent. Gating Sentry
 * on `allowDataCollection` is a separate concern (threat-model Privacy 2).
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

/** Replace the current home directory and any user-home path segment with placeholders. */
export function redactPiiString(value: string, home: string = homedir()): string {
	let out = value;
	// Redact the literal home dir, but only when it ends on a path boundary. A plain
	// substring match would also hit a *different* user whose name merely starts with
	// the current one (home `/Users/alice` vs path `/Users/alicesmith/…`), turning it
	// into `<home>smith/…` — which no longer carries the `/Users/` prefix the
	// per-segment patterns below rely on, leaking the `smith` fragment. Leaving the
	// non-boundary case untouched lets those patterns redact it in full instead.
	if (home.length > 1) {
		out = out.replace(new RegExp(String.raw`${escapeRegExp(home)}(?=[/\\]|$)`, "g"), "<home>");
	}
	for (const [pattern, replacement] of USER_PATH_PATTERNS) {
		out = out.replace(pattern, replacement);
	}
	return out;
}

function deepRedact(node: unknown, home: string, seen: WeakSet<object>, depth: number): void {
	if (node === null || typeof node !== "object" || depth > 12) return;
	if (seen.has(node)) return;
	seen.add(node);

	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const value = node[i];
			if (typeof value === "string") node[i] = redactPiiString(value, home);
			else deepRedact(value, home, seen, depth + 1);
		}
		return;
	}

	const record = node as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		const value = record[key];
		if (typeof value === "string") record[key] = redactPiiString(value, home);
		else deepRedact(value, home, seen, depth + 1);
	}
}

/**
 * Scrub a Sentry event (or transaction) in place and return it:
 * - drops the machine hostname (`server_name`, `contexts.device.name`);
 * - strips identifying `user` fields, keeping only the anonymous `id`;
 * - redacts the home dir / OS username from every string value (paths, messages,
 *   breadcrumbs, span descriptions).
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

	deepRedact(record, home, new WeakSet<object>(), 0);
	return event;
}

/** Sentry's `Envelope`, reached via an export we depend on (`@sentry/core` is not a direct dependency). */
export type SentryEnvelope = Parameters<ReturnType<typeof makeElectronTransport>["send"]>[0];

/** Item types renderers forward straight to the transport, bypassing main's `beforeSend*` hooks. */
const TRANSPORT_SCRUBBED_ITEM_TYPES: ReadonlySet<string> = new Set(["span", "log", "trace_metric"]);

/**
 * Redact the home dir / OS username from every span, log and metric item in an
 * envelope, in place, and return it. Other items (errors, already scrubbed in
 * `beforeSend`; binary attachments) are left untouched.
 */
export function scrubEnvelope(envelope: SentryEnvelope, home: string = homedir()): SentryEnvelope {
	const items: unknown = envelope?.[1];
	if (!Array.isArray(items)) return envelope;
	for (const [itemHeader, payload] of items as SentryEnvelope[1]) {
		if (
			TRANSPORT_SCRUBBED_ITEM_TYPES.has(itemHeader?.type) &&
			payload !== null &&
			typeof payload === "object"
		) {
			deepRedact(payload, home, new WeakSet<object>(), 0);
		}
	}
	return envelope;
}
