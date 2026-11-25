import { describe, expect, it } from "vitest";
import type { OpenCodeQuestionRequest } from "@kilo-desktop/react-opencode";

import { encodeAnswersFromFormData } from "./opencode-question-card";

const request: OpenCodeQuestionRequest = {
	id: "question-1",
	sessionID: "session-1",
	askedAt: 1,
	questions: [
		{
			question: "Which database?",
			header: "Database",
			options: [{ label: "SQLite", description: "Embedded database" }],
			custom: true,
		},
		{
			question: "Which features?",
			header: "Features",
			options: [
				{ label: "Search", description: "Full-text search" },
				{ label: "Backups", description: "Scheduled backups" },
			],
			multiple: true,
			custom: true,
		},
	],
};

describe("encodeAnswersFromFormData", () => {
	it("trims custom answers without changing their text", () => {
		const formData = new FormData();
		formData.set("question-0", "  PostgreSQL  ");
		formData.append("question-1", "Search");
		formData.append("question-1", "  Point-in-time recovery  ");

		expect(encodeAnswersFromFormData(request, formData)).toEqual([
			["PostgreSQL"],
			["Search", "Point-in-time recovery"],
		]);
	});
});
