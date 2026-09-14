import { describe, expect, it } from "vitest";

import { NOTEBOOK_THEME_MESSAGE_TYPE } from "../../contracts/notebook-theme.js";

import { notebookThemeMessage, notebookThemeTokensFrom } from "./notebook-theme.js";

describe("notebookThemeTokensFrom", () => {
	it("copies host semantic tokens and skips empty values", () => {
		expect(
			notebookThemeTokensFrom((name) =>
				name === "--background" ? " #111111 " : name === "--foreground" ? "#fafafa" : "",
			),
		).toEqual({
			background: "#111111",
			foreground: "#fafafa",
		});
	});
});

describe("notebookThemeMessage", () => {
	it("packages the resolved appearance for the notebook iframe", () => {
		expect(notebookThemeMessage({ mode: "dark" }, { background: "rgb(17, 17, 17)" })).toEqual({
			type: NOTEBOOK_THEME_MESSAGE_TYPE,
			mode: "dark",
			tokens: { background: "rgb(17, 17, 17)" },
		});
	});
});
