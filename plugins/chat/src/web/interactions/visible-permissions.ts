import type { PermissionRequest } from "@kilo-desktop/react-opencode";
import { useEffect, useState } from "react";

import type { Contribution, DomainObjectState, PluginSdk } from "@kilo-desktop/kernel";
import { useContextKey, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { SIGNED_IN_KEY, Tool, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import { useStableValue } from "@kilo-desktop/ui/hooks/use-stable";
import {
	PERMISSION_AUTO_ANSWER_TIMEOUT_MS,
	PermissionAutoAnswer,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AutoApprove,
	needsPerson,
	type ApprovalMode,
	type AutoReplyCandidate,
} from "../../contracts";
import { useOptionalExtensions } from "../optional-extensions";

const NOTHING_HELD: readonly string[] = [];

const sameRequests = (a: readonly PermissionRequest[], b: readonly PermissionRequest[]) =>
	a.length === b.length && a.every((request, index) => request === b[index]);

function sameIds(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const inB = new Set(b);
	return a.every((id) => inB.has(id));
}

const selectHolding = (state: DomainObjectState<typeof AutoApprove>) => state.holding;
const selectMode = (state: DomainObjectState<typeof AutoApprove>) => state.mode;

export interface AutoAnswerRules {
	readonly mode: ApprovalMode | undefined;
	readonly signedIn: boolean;
	readonly signInTools: ReadonlySet<string>;
}

/** Whether main's auto-approver will take this request (mirrors its rules). */
export function autoAnswers(request: AutoReplyCandidate, rules: AutoAnswerRules): boolean {
	if (needsPerson(request)) return false;
	return rules.mode === "auto" || (!rules.signedIn && rules.signInTools.has(request.action));
}

/** A transcript permission request as the auto-approver's rules read it. */
const candidateOf = (request: PermissionRequest): AutoReplyCandidate => ({
	action: request.action,
	metadata: request.metadata ?? {},
});

/**
 * Tells kilo.work-sessions' notifier which requests main's auto-approver
 * answers, so "Kilo needs you" sounds only for those a person must answer.
 */
export function implementPermissionAutoAnswer(sdk: PluginSdk): void {
	sdk.extensions.implement(PermissionAutoAnswer, "auto-approve", (request) =>
		autoAnswers(request, {
			mode: sdk.domainObjects.get(AutoApprove)?.getState().mode,
			signedIn: sdk.context.get(SIGNED_IN_KEY) === true,
			signInTools: signInToolNames(sdk.extensions.list(Tool)),
		}),
	);
}

/**
 * The pending requests the cards keep hidden: those main is answering
 * (`holding`), and those it will answer but has not reported yet, for
 * `PERMISSION_AUTO_ANSWER_TIMEOUT_MS` after the window first saw them
 * (`seenAt`; v2 requests carry no time, and one not seen yet counts as just
 * asked) — unless main already held and `released` them.
 */
export function hiddenPermissions(
	pending: readonly PermissionRequest[],
	state: {
		readonly holding: readonly string[];
		readonly released: ReadonlySet<string>;
		readonly seenAt: ReadonlyMap<string, number>;
		readonly now: number;
		readonly rules: AutoAnswerRules;
	},
): PermissionRequest[] {
	const holding = new Set(state.holding);
	const withinWindow = (request: PermissionRequest) => {
		const seenAt = state.seenAt.get(request.id);
		return seenAt === undefined || state.now - seenAt < PERMISSION_AUTO_ANSWER_TIMEOUT_MS;
	};
	return pending.filter(
		(request) =>
			holding.has(request.id) ||
			(!state.released.has(request.id) &&
				withinWindow(request) &&
				autoAnswers(candidateOf(request), state.rules)),
	);
}

function signInToolNames(tools: readonly Contribution<typeof Tool>[]): ReadonlySet<string> {
	return new Set(
		tools.filter((tool) => tool.metadata.requiresSignIn).map((tool) => toolWireName(tool.key)),
	);
}

/** `pending` without the requests in `hiddenKey` (newline-joined ids), or `pending` itself. */
function withoutHidden(
	pending: readonly PermissionRequest[],
	hiddenKey: string,
): readonly PermissionRequest[] {
	if (!hiddenKey) return pending;
	const hiddenIds = new Set(hiddenKey.split("\n"));
	return pending.filter((request) => !hiddenIds.has(request.id));
}

/**
 * Pending permissions as the cards should show them. Requests main's
 * auto-approver is answering (`holding`) stay hidden until it resolves them,
 * fails, or lets them go after `PERMISSION_AUTO_ANSWER_TIMEOUT_MS`. A request it will
 * take but has not reported yet (the window can hear of it first) is hidden
 * for that long too, unless main already held and released it. Returns
 * `pending` itself when nothing is hidden.
 */
export function useVisiblePermissionRequests(
	pending: readonly PermissionRequest[],
): readonly PermissionRequest[] {
	const holding = useDomainObjectState(AutoApprove, selectHolding) ?? NOTHING_HELD;
	const mode = useDomainObjectState(AutoApprove, selectMode);
	const signedIn = useContextKey(SIGNED_IN_KEY);
	const tools = useOptionalExtensions(Tool);
	const [held, setHeld] = useState(holding);
	const [released, setReleased] = useState<ReadonlySet<string>>(() => new Set());
	const [now, setNow] = useState(() => Date.now());
	const [seenAt, setSeenAt] = useState<ReadonlyMap<string, number>>(() => new Map());
	const holdingIds = new Set(holding);
	if (!sameIds(held, holding)) {
		setHeld(holding);
		const letGo = held.filter((id) => !holdingIds.has(id));
		if (letGo.length > 0) setReleased(new Set([...released, ...letGo]));
	}

	const hidden = hiddenPermissions(pending, {
		holding,
		released,
		seenAt,
		now,
		rules: { mode, signedIn, signInTools: signInToolNames(tools) },
	});
	const unreported = hidden.filter((request) => !holdingIds.has(request.id));
	const unseenKey = pending
		.filter((request) => !seenAt.has(request.id))
		.map((request) => request.id)
		.join("\n");
	const seenTimes = unreported.flatMap((request) => {
		const time = seenAt.get(request.id);
		return time === undefined ? [] : [time];
	});
	const nextRevealAt = seenTimes.length
		? Math.min(...seenTimes) + PERMISSION_AUTO_ANSWER_TIMEOUT_MS
		: undefined;
	const visible = withoutHidden(pending, hidden.map((request) => request.id).join("\n"));
	// The clock is read in a timer, not in render: at once to start each new
	// request's window from when this window first saw it, else when the next
	// hidden request's window ends.
	useEffect(() => {
		if (!unseenKey && nextRevealAt === undefined) return;
		const delay = unseenKey ? 0 : Math.max(0, nextRevealAt! - Date.now());
		const timer = setTimeout(() => {
			const time = Date.now();
			if (unseenKey) {
				setSeenAt((current) => {
					const next = new Map(current);
					for (const id of unseenKey.split("\n")) if (!next.has(id)) next.set(id, time);
					return next;
				});
			}
			setNow(time);
		}, delay);
		return () => clearTimeout(timer);
	}, [unseenKey, nextRevealAt]);

	// Kept while the same requests show, so a reveal timer firing changes nothing downstream.
	return useStableValue(visible, sameRequests);
}
