import type { ThemedToken } from "@pierre/diffs";
import { describe, expect, it } from "vitest";

import { tokenStyle } from "./token-style";

const FOREGROUND = "#0a0a0a";

function token(fields: Partial<ThemedToken>): ThemedToken {
	return { content: "x", offset: 0, ...fields };
}

describe("tokenStyle", () => {
	it("styles a token the way file previews do", () => {
		expect(
			tokenStyle(
				token({ color: "#D568EA", bgColor: "#FFF5CC", fontStyle: 1 | 2 | 4 | 8 }),
				FOREGROUND,
			),
		).toEqual({
			color: "#D568EA",
			backgroundColor: "#FFF5CC",
			fontStyle: "italic",
			fontWeight: "bold",
			textDecoration: "underline line-through",
		});
	});

	it("uses a token's inline style, keeping custom properties as they are", () => {
		expect(
			tokenStyle(
				token({ color: "#111111", htmlStyle: { color: "#D568EA", "--shiki-dark": "#68CDF2" } }),
				FOREGROUND,
			),
		).toEqual({ color: "#D568EA", "--shiki-dark": "#68CDF2" });
	});

	it("leaves the theme's plain-text color to inherit", () => {
		expect(tokenStyle(token({ color: "#0A0A0A" }), FOREGROUND)).toBeUndefined();
		expect(tokenStyle(token({ color: "#0A0A0A", fontStyle: 1 }), FOREGROUND)).toEqual({
			fontStyle: "italic",
		});
	});

	it("gives an unstyled token no style", () => {
		expect(tokenStyle(token({ content: "\n" }), FOREGROUND)).toBeUndefined();
	});
});
