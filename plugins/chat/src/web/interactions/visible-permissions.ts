import type { OpenCodePermissionRequest } from "@assistant-ui/react-opencode";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useContextKey, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { SIGNED_IN_KEY, Tool, toolWireName } from "@kilo-desktop/plugin-core/contracts";

import {
	AUTO_APPROVE_REVEAL_MS,
	AutoApprove,
	needsPerson,
	neverAutoReplied,
	type ApprovalMode,
} from "../../contracts";
import { useOptionalExtensions } from "../optional-extensions";

const NOTHING_HELD: readonly string[] = [];

const selectHolding = (state: DomainObjectState<typeof AutoApprove>) => state.holding;
const selectMode = (state: DomainObjectState<typeof AutoApprove>) => state.mode;

export interface AutoAnswerRules {
	readonly mode: ApprovalMode | undefined;
	readonly signedIn: boolean;
	readonly signInTools: ReadonlySet<string>;
}

/** Whether main's auto-approver will take this request (mirrors its rules). */
export function autoAnswers(request: OpenCodePermissionRequest, rules: AutoAnswerRules): boolean {
	if (rules.mode === "auto") return !needsPerson(request.metadata);
	return (
		!rules.signedIn &&
		rules.signInTools.has(request.permission) &&
		!neverAutoReplied(request.metadata) &&
		request.metadata["skillShell"] !== true
	);
}

/**
 * The pending requests the cards keep hidden: those main is answering
 * (`holding`), and those it will answer but has not reported yet, for
 * `AUTO_APPROVE_REVEAL_MS` after they were asked — unless main already held
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
	return pending.filter(
		(request) =>
			state.holding.includes(request.id) ||
			(!state.released.has(request.id) &&
				state.now - request.askedAt < AUTO_APPROVE_REVEAL_MS &&
				autoAnswers(request, state.rules)),
	);
}

/**
 * Pending permissions as the cards should show them. Requests main's
 * auto-approver is answering (`holding`) stay hidden until it resolves them,
 * fails, or lets them go after `AUTO_APPROVE_REVEAL_MS`. A request it will
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
	const signInTools = useMemo(
		() =>
			new Set(
				tools.filter((tool) => tool.metadata.requiresSignIn).map((tool) => toolWireName(tool.key)),
			),
		[tools],
	);
	const released = useRef(new Set<string>());
	const held = useRef(new Set<string>());
	for (const id of held.current) if (!holding.includes(id)) released.current.add(id);
	held.current = new Set(holding);
	const [now, setNow] = useState(() => Date.now());

	const hidden = useMemo(
		() =>
			hiddenPermissions(pending, {
				holding,
				released: released.current,
				now,
				rules: { mode, signedIn, signInTools },
			}),
		[holding, mode, now, pending, signInTools, signedIn],
	);
	const unreported = hidden.filter((request) => !holding.includes(request.id));
	const nextRevealAt = unreported.length
		? Math.min(...unreported.map((request) => request.askedAt)) + AUTO_APPROVE_REVEAL_MS
		: undefined;
	useEffect(() => {
		if (nextRevealAt === undefined) return;
		const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextRevealAt - Date.now()));
		return () => clearTimeout(timer);
	}, [nextRevealAt]);

	const hiddenKey = hidden.map((request) => request.id).join("\n");
	return useMemo(
		() =>
			hiddenKey
				? pending.filter((request) => !hiddenKey.split("\n").includes(request.id))
				: pending,
		[hiddenKey, pending],
	);
}
