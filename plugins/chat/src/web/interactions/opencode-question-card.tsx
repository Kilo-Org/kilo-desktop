import { type FormEvent, useState } from "react";
import type { OpenCodeQuestionRequest, QuestionAnswer } from "@assistant-ui/react-opencode";
import { CircleAlertIcon, ShieldAlertIcon } from "lucide-react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Questionnaire,
	QuestionnaireChoice,
	QuestionnaireChoiceDescription,
	QuestionnaireChoices,
	QuestionnaireError,
	QuestionnaireInput,
	QuestionnaireItem,
	QuestionnaireNext,
	QuestionnairePrevious,
	QuestionnaireProgress,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "@kilo-desktop/ui/components/questionnaire";

import { ComposerShell } from "../thread/composer-shelf";
import { questionOptionWarnings, usePermissionRenderers } from "./permission-renderers";
import type { SubagentOrigin } from "./pending-interactions";

const questionName = (index: number) => `question-${index}`;

const buildQuestionnaireItems = (request: OpenCodeQuestionRequest) =>
	request.questions.map((question, index) => ({
		name: questionName(index),
		required: true as const,
		choices: question.options.map((option) => ({ value: option.label })),
	}));

export const encodeAnswersFromFormData = (
	request: OpenCodeQuestionRequest,
	formData: FormData,
): QuestionAnswer[] =>
	request.questions.map((question, index) => {
		const name = questionName(index);
		const rawValues = question.multiple ? formData.getAll(name) : [formData.get(name)];

		return rawValues.flatMap((value) => {
			if (typeof value !== "string") return [];
			const trimmed = value.trim();
			if (!trimmed) return [];
			return [trimmed];
		});
	});

const NO_CHATS = "Kilo isn't available right now.";

/** An agent question, answered or dismissed through kilo.core's chats. */
export const OpenCodeQuestionQuestionnaire = ({
	request,
	origin,
}: {
	request: OpenCodeQuestionRequest;
	/** Set when a subagent, not the chat's own session, asked the question. */
	origin?: SubagentOrigin | undefined;
}) => {
	const chats = useDomainObject(Chats);
	const [submissionState, setSubmissionState] = useState<"reply" | "reject" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const renderers = usePermissionRenderers();
	const items = buildQuestionnaireItems(request);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (submissionState !== null) return;

		const answers = encodeAnswersFromFormData(request, new FormData(event.currentTarget));
		if (answers.some((answer) => answer.length === 0)) return;

		if (!chats) {
			setError(NO_CHATS);
			return;
		}
		setSubmissionState("reply");
		setError(null);

		void (async () => {
			try {
				await chats.methods.replyQuestion({
					chatId: request.sessionID,
					questionId: request.id,
					answers,
				});
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not submit answers.");
				setSubmissionState(null);
			}
		})();
	};

	const rejectRequest = async () => {
		if (!chats) {
			setError(NO_CHATS);
			return;
		}
		setSubmissionState("reject");
		setError(null);

		try {
			await chats.methods.rejectQuestion({ chatId: request.sessionID, questionId: request.id });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not reject the request.");
			setSubmissionState(null);
		}
	};

	const isBusy = submissionState !== null;

	return (
		<ComposerShell data-qa-id="kilo-question-questionnaire" className="gap-4 p-4">
			{origin ? (
				<p className="text-muted-foreground truncate text-xs font-medium">
					{origin.title ? `Question from subagent: ${origin.title}` : "Question from a subagent"}
				</p>
			) : null}
			<Questionnaire
				items={items}
				onSubmit={handleSubmit}
				className="gap-4"
				aria-label="Agent questions"
			>
				<QuestionnaireProgress />
				{request.questions.map((question, index) => {
					const name = questionName(index);
					const customAllowed = question.custom !== false;
					const hasChoices = question.options.length > 0;

					return (
						<QuestionnaireItem
							key={name}
							name={name}
							required
							multiple={question.multiple === true}
						>
							<QuestionnaireTitle>{question.question}</QuestionnaireTitle>
							{hasChoices || customAllowed ? (
								<QuestionnaireChoices>
									{question.options.map((option) => (
										<QuestionnaireChoice key={option.label} value={option.label}>
											<span className="font-medium">{option.label}</span>
											{option.description ? (
												<QuestionnaireChoiceDescription>
													{option.description}
												</QuestionnaireChoiceDescription>
											) : null}
											{questionOptionWarnings(renderers, option).map((warning) => (
												<span
													key={warning}
													data-slot="questionnaire-choice-warning"
													className="text-destructive flex items-start gap-1.5 text-xs font-medium"
												>
													<ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
													<span>{warning}</span>
												</span>
											))}
										</QuestionnaireChoice>
									))}
									{customAllowed ? (
										<QuestionnaireInput
											aria-label="Other answer"
											placeholder="Type another answer…"
											disabled={isBusy}
										/>
									) : null}
								</QuestionnaireChoices>
							) : null}
							<QuestionnaireError />
						</QuestionnaireItem>
					);
				})}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => void rejectRequest()}
								disabled={isBusy}
							>
								{submissionState === "reject" ? (
									<Spinner data-icon="inline-start" aria-hidden="true" />
								) : null}
								Dismiss
							</Button>
							<QuestionnairePrevious disabled={isBusy} />
						</div>
						<div className="flex items-center gap-2">
							<QuestionnaireNext disabled={isBusy} />
							<QuestionnaireSubmit disabled={isBusy}>
								{submissionState === "reply" ? (
									<Spinner data-icon="inline-start" aria-hidden="true" />
								) : null}
								Submit
							</QuestionnaireSubmit>
						</div>
					</div>
					{error ? (
						<div className="text-destructive flex min-w-0 items-center gap-2 text-xs">
							<CircleAlertIcon className="size-3.5 shrink-0" />
							<span className="truncate">{error}</span>
						</div>
					) : null}
				</div>
			</Questionnaire>
		</ComposerShell>
	);
};
