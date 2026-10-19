"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo, type ComponentType, type FC } from "react";

import { useSdkContributions } from "@kilo-desktop/sdk-react";

import { useSessionActivity } from "../../session-activity/SessionActivityProvider.js";
import {
	sessionGitStatusId,
	type SessionActivity,
} from "../../session-activity/session-activity-logic.js";

type SessionMetadataTarget = {
	id: string;
	directory: string;
	active: boolean;
	branch?: string;
};

/** One target per checkout: chats sharing a checkout share its metadata (e.g. its PR). */
function sessionMetadataTargets(
	activityBySessionId: Readonly<Record<string, SessionActivity>>,
	activeSessionId: string | undefined,
): SessionMetadataTarget[] {
	const byId = new Map<string, SessionMetadataTarget>();
	for (const [sessionId, activity] of Object.entries(activityBySessionId)) {
		const id = sessionGitStatusId(activity);
		if (!activity.directory || !id) continue;
		const current = byId.get(id);
		byId.set(id, {
			id,
			directory: activity.directory,
			active: current?.active === true || sessionId === activeSessionId,
			...(activity.worktreeBranch ? { branch: activity.worktreeBranch } : {}),
		});
	}
	return [...byId.values()];
}

/**
 * Tells `chat-session-metadata-provider` contributions which checkouts this
 * window's chats use, so they can fetch what `chat-session-row-metadata`
 * contributions show (the git plugin polls each checkout's pull request).
 * Mount exactly one per window: a contribution keeps one window-wide target
 * set, which a second mount would overwrite and clear on unmount. A window
 * showing another window's chats passes their activity instead of its own.
 */
export const SessionMetadataProviders: FC<{
	activityBySessionId?: Readonly<Record<string, SessionActivity>>;
}> = ({ activityBySessionId: shown }) => {
	const own = useSessionActivity((s) => s.sessions);
	const activityBySessionId = shown ?? own;
	const activeSessionId = useAuiState(
		(s) => s.threads.threadItems.find((item) => item.id === s.threads.mainThreadId)?.remoteId,
	);
	const providers = useSdkContributions("kilo-ui/chat-session-metadata-provider");
	const targets = useMemo(
		() => sessionMetadataTargets(activityBySessionId, activeSessionId),
		[activityBySessionId, activeSessionId],
	);
	return providers.map((contribution) => {
		const Component = contribution.component as ComponentType<{
			targets: readonly SessionMetadataTarget[];
		}>;
		return <Component key={`${contribution.featureId}.${contribution.id}`} targets={targets} />;
	});
};
