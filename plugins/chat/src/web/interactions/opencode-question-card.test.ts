import { describe, expect, it } from "vitest";
import { questionsOfForm } from "@kilo-desktop/react-opencode";

import { questionForm } from "../../test/kilo2/fixtures";

import { encodeAnswersFromFormData } from "./opencode-question-card";

const form = questionForm("ses_1", [
	{
		question: "Which database?",
		header: "Database",
		options: [{ label: "SQLite", description: "Embedded database" }],
	},
	{
		question: "Which features?",
		header: "Features",
		options: [
			{ label: "Search", description: "Full-text search" },
			{ label: "Backups", description: "Scheduled backups" },
		],
		multiple: true,
	},
]);

describe("encodeAnswersFromFormData", () => {
	it("trims custom answers without changing their text", () => {
		const formData = new FormData();
		formData.set("question-0", "  PostgreSQL  ");
		formData.append("question-1", "Search");
		formData.append("question-1", "  Point-in-time recovery  ");

		expect(encodeAnswersFromFormData(questionsOfForm(form), formData)).toEqual([
			["PostgreSQL"],
			["Search", "Point-in-time recovery"],
		]);
	});
});
