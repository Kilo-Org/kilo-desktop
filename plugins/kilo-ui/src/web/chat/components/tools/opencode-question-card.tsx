import { type FormEvent, useMemo, useState } from "react";
import {
	type OpenCodeQuestionRequest,
	type QuestionAnswer,
	useOpenCodeRuntimeExtras,
} from "@assistant-ui/react-opencode";
import { AlertCircleIcon, LoaderIcon } from "lucide-react";

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
import { cn } from "@kilo-desktop/ui/lib/utils";

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

export const OpenCodeQuestionQuestionnaire = ({
	request,
}: {
	request: OpenCodeQuestionRequest;
}) => {
	const { replyToQuestion, rejectQuestion } = useOpenCodeRuntimeExtras();
	const [submissionState, setSubmissionState] = useState<"reply" | "reject" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const items = useMemo(() => buildQuestionnaireItems(request), [request]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (submissionState !== null) return;

		const answers = encodeAnswersFromFormData(request, new FormData(event.currentTarget));
		if (answers.some((answer) => answer.length === 0)) return;

		setSubmissionState("reply");
		setError(null);

		void (async () => {
			try {
				await replyToQuestion(request.id, answers);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to submit answers.");
				setSubmissionState(null);
			}
		})();
	};

	const rejectRequest = async () => {
		setSubmissionState("reject");
		setError(null);

		try {
			await rejectQuestion(request.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to reject request.");
			setSubmissionState(null);
		}
	};

	const isBusy = submissionState !== null;

	return (
		<div
			data-slot="aui_composer-shell"
			data-qa-id="kilo-question-questionnaire"
			className={cn(
				"border-border dark:border-muted-foreground/15 chat-composer-glass chat-composer-surface flex w-full flex-col gap-4 rounded-(--composer-radius) border p-4 shadow-[0_12px_28px_-18px_rgba(0,0,0,0.40)] dark:shadow-none",
			)}
		>
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
									<LoaderIcon className="animate-spin" data-icon="inline-start" />
								) : null}
								Dismiss
							</Button>
							<QuestionnairePrevious disabled={isBusy} />
						</div>
						<div className="flex items-center gap-2">
							<QuestionnaireNext disabled={isBusy} />
							<QuestionnaireSubmit disabled={isBusy}>
								{submissionState === "reply" ? (
									<LoaderIcon className="animate-spin" data-icon="inline-start" />
								) : null}
								Submit
							</QuestionnaireSubmit>
						</div>
					</div>
					{error ? (
						<div className="text-destructive-foreground flex min-w-0 items-center gap-2 text-xs">
							<AlertCircleIcon className="size-3.5 shrink-0" />
							<span className="truncate">{error}</span>
						</div>
					) : null}
				</div>
			</Questionnaire>
		</div>
	);
};
