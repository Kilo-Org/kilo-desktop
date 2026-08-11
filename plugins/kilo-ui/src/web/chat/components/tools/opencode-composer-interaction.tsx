import { type ReactNode, useMemo } from "react";
import {
	type OpenCodePermissionRequest,
	type OpenCodeQuestionRequest,
	useOpenCodePermissions,
	useOpenCodeQuestions,
} from "@assistant-ui/react-opencode";

import { OpenCodePermissionCard } from "./opencode-permission-card.js";
import { OpenCodeQuestionQuestionnaire } from "./opencode-question-card.js";

type PendingComposerInteraction =
	| { kind: "permission"; request: OpenCodePermissionRequest }
	| { kind: "question"; request: OpenCodeQuestionRequest };

export const OpenCodeComposerInteraction = ({ fallback }: { fallback: ReactNode }) => {
	const { pending: pendingPermissions } = useOpenCodePermissions();
	const pendingQuestions = useOpenCodeQuestions();
	const activeInteraction = useMemo(() => {
		const interactions: PendingComposerInteraction[] = [
			...pendingPermissions.map((request) => ({ kind: "permission" as const, request })),
			...pendingQuestions.map((request) => ({ kind: "question" as const, request })),
		];

		return interactions.toSorted((a, b) => a.request.askedAt - b.request.askedAt)[0] ?? null;
	}, [pendingPermissions, pendingQuestions]);

	if (activeInteraction?.kind === "permission") {
		return (
			<OpenCodePermissionCard
				key={activeInteraction.request.id}
				request={activeInteraction.request}
			/>
		);
	}

	if (activeInteraction?.kind === "question") {
		return (
			<OpenCodeQuestionQuestionnaire
				key={activeInteraction.request.id}
				request={activeInteraction.request}
			/>
		);
	}

	return fallback;
};
