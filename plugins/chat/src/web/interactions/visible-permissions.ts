import type { OpenCodePermissionRequest } from "@kilo-desktop/react-opencode";
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

const sameRequests = (
	a: readonly OpenCodePermissionRequest[],
	b: readonly OpenCodePermissionRequest[],
) => a.length === b.length && a.every((request, index) => request === b[index]);

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
const candidateOf = (request: OpenCodePermissionRequest): AutoReplyCandidate => ({
	action: request.permission,
	metadata: request.metadata,
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
 * `PERMISSION_AUTO_ANSWER_TIMEOUT_MS` after they were asked — unless main already held
 * and `released` them.
 */
export function hiddenPermissions(
	pending: readonly OpenCodePermissionRequest[],
	state: {
		readonly holding: readonly string[];
		readonly released: ReadonlySet<string>;
		readonly now: number;
		readonly rules: AutoAnswerRules;
	},
): OpenCodePermissionRequest[] {
	const holding = new Set(state.holding);
	return pending.filter(
		(request) =>
			holding.has(request.id) ||
			(!state.released.has(request.id) &&
				state.now - request.askedAt < PERMISSION_AUTO_ANSWER_TIMEOUT_MS &&
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
	pending: readonly OpenCodePermissionRequest[],
	hiddenKey: string,
): readonly OpenCodePermissionRequest[] {
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
	pending: readonly OpenCodePermissionRequest[],
): readonly OpenCodePermissionRequest[] {
	const holding = useDomainObjectState(AutoApprove, selectHolding) ?? NOTHING_HELD;
	const mode = useDomainObjectState(AutoApprove, selectMode);
	const signedIn = useContextKey(SIGNED_IN_KEY);
	const tools = useOptionalExtensions(Tool);
	const [held, setHeld] = useState(holding);
	const [released, setReleased] = useState<ReadonlySet<string>>(() => new Set());
	const [now, setNow] = useState(() => Date.now());
	const holdingIds = new Set(holding);
	if (!sameIds(held, holding)) {
		setHeld(holding);
		const letGo = held.filter((id) => !holdingIds.has(id));
		if (letGo.length > 0) setReleased(new Set([...released, ...letGo]));
	}

	const hidden = hiddenPermissions(pending, {
		holding,
		released,
		now,
		rules: { mode, signedIn, signInTools: signInToolNames(tools) },
	});
	const unreported = hidden.filter((request) => !holdingIds.has(request.id));
	const nextRevealAt = unreported.length
		? Math.min(...unreported.map((request) => request.askedAt)) + PERMISSION_AUTO_ANSWER_TIMEOUT_MS
		: undefined;
	const visible = withoutHidden(pending, hidden.map((request) => request.id).join("\n"));
	useEffect(() => {
		if (nextRevealAt === undefined) return;
		const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextRevealAt - Date.now()));
		return () => clearTimeout(timer);
	}, [nextRevealAt]);

	// Kept while the same requests show, so a reveal timer firing changes nothing downstream.
	return useStableValue(visible, sameRequests);
}
