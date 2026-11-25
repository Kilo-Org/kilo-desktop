import { type FormEvent, useState } from "react";
import type { FormInfo, OpenCodeFormRequest } from "@kilo-desktop/react-opencode-v2";
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

type FormField = FormInfo["fields"][number];

/** A field's choices: a string or multiselect field's options. */
const optionsOf = (field: FormField) =>
	(field.type === "string" || field.type === "multiselect" ? field.options : undefined) ?? [];

const isMultiple = (field: FormField) => field.type === "multiselect";

/** Whether a typed answer is offered: any field that doesn't refuse one. */
const allowsCustom = (field: FormField) => !("custom" in field) || field.custom !== false;

/** What the field asks, as Kilo's question tool puts it in a form. */
const questionText = (field: FormField, request: OpenCodeFormRequest) =>
	field.description ?? field.title ?? request.title;

const buildQuestionnaireItems = (request: OpenCodeFormRequest) =>
	request.fields.map((field, index) => ({
		name: questionName(index),
		required: true as const,
		choices: optionsOf(field).map((option) => ({ value: option.value })),
	}));

/**
 * The form's answers as kilo.core's chats take them: one list per field, in
 * order (an option's value, or what was typed).
 */
export const encodeAnswersFromFormData = (
	request: OpenCodeFormRequest,
	formData: FormData,
): string[][] =>
	request.fields.map((field, index) => {
		const name = questionName(index);
		const rawValues = isMultiple(field) ? formData.getAll(name) : [formData.get(name)];

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
	request: OpenCodeFormRequest;
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
				{request.fields.map((field, index) => {
					const name = questionName(index);
					const customAllowed = allowsCustom(field);
					const options = optionsOf(field);

					return (
						<QuestionnaireItem key={name} name={name} required multiple={isMultiple(field)}>
							<QuestionnaireTitle>{questionText(field, request)}</QuestionnaireTitle>
							{options.length > 0 || customAllowed ? (
								<QuestionnaireChoices>
									{options.map((option) => (
										<QuestionnaireChoice key={option.value} value={option.value}>
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
