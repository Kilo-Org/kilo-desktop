import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { OpenCodeQuestionRequest } from "@assistant-ui/react-opencode";

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeRuntimeExtras: () => ({ replyToQuestion: vi.fn(), rejectQuestion: vi.fn() }),
}));

import { LOCAL_CONDA_FILE_INSTALL_WARNING } from "./conda-local-file-warning.js";
import { OpenCodeQuestionQuestionnaire } from "./opencode-question-card.js";

afterEach(cleanup);

const questionRequest = (): OpenCodeQuestionRequest =>
	({
		id: "question-1",
		sessionID: "session-1",
		askedAt: 1,
		questions: [
			{
				question: "How should I install pandas 3.0.6 into test-2?",
				header: "Install",
				options: [
					{
						label: "From channel (Recommended)",
						description:
							"Install the identical pandas 3.0.6 from the configured channel (conda-forge/main). " +
							"No security guardrail bypass. Same package contents as the local file.",
					},
					{
						label: "From the local .tar.bz2 file",
						description:
							"Install /Users/amorais/Downloads/pandas-3.0.6-py314heb7d0cc_0.tar.bz2 via the conda CLI.",
					},
				],
				custom: false,
			},
		],
	}) as OpenCodeQuestionRequest;

describe("OpenCodeQuestionQuestionnaire", () => {
	it("flags the option that installs a local conda file", async () => {
		const { baseElement } = render(<OpenCodeQuestionQuestionnaire request={questionRequest()} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(LOCAL_CONDA_FILE_INSTALL_WARNING)).toBeVisible();
	});

	it("does not flag the safe channel option that mentions the local file", async () => {
		const { baseElement } = render(<OpenCodeQuestionQuestionnaire request={questionRequest()} />);
		const occurrences =
			baseElement.textContent?.split(LOCAL_CONDA_FILE_INSTALL_WARNING).length ?? 0;

		// Rendered once — only the local-file option carries the warning.
		expect(occurrences - 1).toBe(1);
	});
});
