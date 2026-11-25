import { describe, expect, it } from "vitest";
import type { OpenCodeFormRequest } from "@kilo-desktop/react-opencode-v2";

import { encodeAnswersFromFormData } from "./opencode-question-card";

const request: OpenCodeFormRequest = {
	id: "question-1",
	sessionID: "session-1",
	askedAt: 1,
	title: "Questions",
	fields: [
		{
			key: "q0",
			type: "string",
			title: "Database",
			description: "Which database?",
			options: [{ value: "SQLite", label: "SQLite", description: "Embedded database" }],
			custom: true,
		},
		{
			key: "q1",
			type: "multiselect",
			title: "Features",
			description: "Which features?",
			options: [
				{ value: "Search", label: "Search", description: "Full-text search" },
				{ value: "Backups", label: "Backups", description: "Scheduled backups" },
			],
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
