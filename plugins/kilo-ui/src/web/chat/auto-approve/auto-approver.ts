import type { OpenCodeServerEvent } from "@assistant-ui/react-opencode";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";

/** How long an auto-approvable request stays hidden before it is shown anyway. */
export const AUTO_APPROVE_REVEAL_MS = 3_000;

/** A set of permission request ids the UI reacts to. */
export type RequestIdsStore = StoreApi<{ ids: ReadonlySet<string> }>;

/**
 * Prompts auto-approve never answers, so a person always sees them. Sandbox
 * escalation and protected-config prompts are never replied to; the server
 * ignores machine replies to skill-shell.
 */
export function needsPerson(metadata: unknown): boolean {
	return neverAutoReplied(metadata) || hasFlag(metadata, "skillShell");
}

/**
 * Skipped outright. Protected-config edits (Kilo's own config and rules) are
 * excluded, unlike VS Code: approving one "once" can persist new allow rules
 * that outlive Auto mode.
 */
function neverAutoReplied(metadata: unknown): boolean {
	return hasFlag(metadata, "sandboxEscalation") || hasFlag(metadata, "configProtected");
}

/**
 * Runtime auto-approve, mirroring the Kilo VS Code toggle
 * (`kilo-vscode/src/commands/toggle-auto-approve.ts`).
 *
 * Each `permission.asked` event is answered "once" as it arrives, straight from
 * the event payload. Enabling also drains requests that were already pending,
 * as does `resync` (startup, reconnect) while Auto is on, so requests that
 * arrived while nothing was listening still get answered. Sandbox escalation
 * and protected-config prompts are never answered here. Replies deliberately
 * omit `interactive`: the Kilo server refuses non-interactive approvals of
 * skill-shell and sandbox prompts, so they stay pending for a person.
 *
 * Unlike VS Code, the UI does not show a permission card while Auto is on
 * (see `useVisiblePermissionRequests`); it shows one only once the request is
 * `AUTO_APPROVE_REVEAL_MS` old or listed in `revealedIds`, which this module
 * fills when a reply fails or cannot be sent. Held-back `permission.asked`
 * events are likewise kept out of the session activity store (so the sidebar
 * never flashes "needs approval") and handed to `onReveal` if the request is
 * still pending when revealed.
 *
 * `generation` is bumped on every enable/disable so an in-flight drain stops as
 * soon as the mode changes.
 *
 * In manual mode one kind of request is still answered here: a call the tool
 * gateway will refuse for sign-in (`isRefusedForSignIn` — a sign-in tool while
 * the user is signed out). Asking permission for it is pointless, and makes
 * Kilo's permission prompt appear before the sign-in prompt (or, if denied,
 * instead of it). Such requests are held in `checkingIds` (hidden from the UI)
 * while the check runs; refused calls are answered "once", so the call reaches
 * the gateway and chat shows the sign-in prompt. Anything else — the user is
 * signed in, the check or reply fails, or it takes longer than
 * `revealAfterMs` — is shown to the user as usual.
 */
export type AutoApprover = {
	/**
	 * Handles `permission.asked` / `permission.replied` as they arrive. Returns
	 * true when an asked event is held back from the activity store; the caller
	 * must then leave it to `onReveal`.
	 */
	handleEvent: (event: OpenCodeServerEvent) => boolean;
	/** Records a mode change; enabling drains requests already pending. */
	setEnabled: (enabled: boolean) => Promise<void>;
	/** Drains requests already pending when Auto is on (startup, reconnect); otherwise a no-op. */
	resync: () => Promise<void>;
	/** Requests auto-approve could not answer; their cards show immediately. */
	revealedIds: RequestIdsStore;
	/** Manual-mode requests being checked for a sign-in refusal; hidden meanwhile. */
	checkingIds: RequestIdsStore;
	dispose: () => void;
};

export function createAutoApprover(options: {
	getConnection: () => Promise<KiloGlobalConnection>;
	isEnabled: () => boolean;
	resolveDirectory: (sessionId: string | undefined) => string | undefined;
	directories: () => Iterable<string>;
	onReveal: (event: OpenCodeServerEvent) => void;
	revealAfterMs?: number;
	/** Whether the gateway will refuse this permission's tool call for sign-in. */
	isRefusedForSignIn?: (permission: string) => Promise<boolean>;
}): AutoApprover {
	const revealAfterMs = options.revealAfterMs ?? AUTO_APPROVE_REVEAL_MS;
	const revealedIds: RequestIdsStore = createStore(() => ({
		ids: new Set<string>() as ReadonlySet<string>,
	}));
	const checkingIds: RequestIdsStore = createStore(() => ({
		ids: new Set<string>() as ReadonlySet<string>,
	}));
	const held = new Map<
		string,
		{ event: OpenCodeServerEvent; timer: ReturnType<typeof setTimeout> }
	>();
	let generation = 0;

	const setMember = (store: RequestIdsStore, requestID: string, member: boolean) => {
		const current = store.getState().ids;
		if (current.has(requestID) === member) return;
		const next = new Set(current);
		if (member) next.add(requestID);
		else next.delete(requestID);
		store.setState({ ids: next });
	};
	const setRevealed = (requestID: string, revealed: boolean) =>
		setMember(revealedIds, requestID, revealed);

	const release = (requestID: string) => {
		setMember(checkingIds, requestID, false);
		const entry = held.get(requestID);
		if (!entry) return undefined;
		clearTimeout(entry.timer);
		held.delete(requestID);
		return entry.event;
	};

	const reveal = (requestID: string) => {
		setRevealed(requestID, true);
		const event = release(requestID);
		if (event) options.onReveal(event);
	};

	/** Manual mode: answer a call the gateway will refuse for sign-in, show anything else. */
	const handleSignInRefusal = (
		event: OpenCodeServerEvent,
		isRefusedForSignIn: (permission: string) => Promise<boolean>,
	): boolean => {
		const requestID = event.properties["id"];
		const permission = event.properties["permission"];
		if (typeof requestID !== "string" || typeof permission !== "string") return false;
		if (needsPerson(event.properties["metadata"])) return false;
		const directory = event.directory ?? options.resolveDirectory(event.sessionId);
		if (!directory) return false;
		setMember(checkingIds, requestID, true);
		held.set(requestID, { event, timer: setTimeout(() => reveal(requestID), revealAfterMs) });
		void isRefusedForSignIn(permission)
			.then(async (refused) => {
				if (!held.has(requestID)) return;
				if (!refused) {
					// The call would run: the user decides, as usual.
					const asked = release(requestID);
					if (asked) options.onReveal(asked);
					return;
				}
				await reply(requestID, directory);
			})
			.catch((error: unknown) => {
				console.error("[kilo-ui] sign-in: failed to skip a pointless permission", error);
				reveal(requestID);
			});
		return true;
	};

	const reply = async (requestID: string, directory: string) => {
		const client = createKiloDirectoryClient(await options.getConnection(), directory);
		await client.permission.reply({ requestID, reply: "once" }, { throwOnError: true });
	};

	const handleEvent = (event: OpenCodeServerEvent) => {
		if (event.type === "permission.replied") {
			const requestID = event.properties["requestID"];
			if (typeof requestID === "string") {
				release(requestID);
				setRevealed(requestID, false);
			}
			return false;
		}
		if (event.type !== "permission.asked") return false;
		if (!options.isEnabled()) {
			return options.isRefusedForSignIn
				? handleSignInRefusal(event, options.isRefusedForSignIn)
				: false;
		}
		const requestID = event.properties["id"];
		const metadata = event.properties["metadata"];
		if (typeof requestID !== "string" || neverAutoReplied(metadata)) return false;
		const directory = event.directory ?? options.resolveDirectory(event.sessionId);
		if (!directory) {
			setRevealed(requestID, true);
			return false;
		}
		const holding = !hasFlag(metadata, "skillShell");
		if (holding) {
			held.set(requestID, { event, timer: setTimeout(() => reveal(requestID), revealAfterMs) });
		}
		void reply(requestID, directory).catch((error: unknown) => {
			console.error("[kilo-ui] auto-approve: failed to auto-reply", error);
			reveal(requestID);
		});
		return holding;
	};

	const drain = async (snapshot: number) => {
		for (const directory of new Set(options.directories())) {
			if (generation !== snapshot) return;
			try {
				const client = createKiloDirectoryClient(await options.getConnection(), directory);
				const { data: pending = [] } = await client.permission.list(undefined, {
					throwOnError: true,
				});
				for (const request of pending) {
					if (generation !== snapshot) return;
					if (neverAutoReplied(request.metadata)) continue;
					await reply(request.id, directory).catch((error: unknown) => {
						console.error("[kilo-ui] auto-approve: failed to drain pending", error);
						setRevealed(request.id, true);
					});
				}
			} catch (error) {
				console.error("[kilo-ui] auto-approve: failed to list pending permissions", error);
			}
		}
	};

	return {
		handleEvent,
		setEnabled: async (enabled) => {
			generation += 1;
			if (enabled) await drain(generation);
		},
		resync: async () => {
			if (options.isEnabled()) await drain(generation);
		},
		revealedIds,
		checkingIds,
		dispose: () => {
			generation += 1;
			for (const entry of held.values()) clearTimeout(entry.timer);
			held.clear();
		},
	};
}

function hasFlag(metadata: unknown, key: string): boolean {
	return (
		typeof metadata === "object" &&
		metadata !== null &&
		(metadata as Record<string, unknown>)[key] === true
	);
}
