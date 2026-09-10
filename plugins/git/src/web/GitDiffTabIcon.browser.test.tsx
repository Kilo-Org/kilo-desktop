import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GitDiffTabIcon } from "./GitDiffTabIcon.js";

describe("GitDiffTabIcon", () => {
	it("renders the tab icon with and without a class", () => {
		const { container: withClass } = render(
			<div>
				<GitDiffTabIcon className="size-4" />
			</div>,
		);
		expect(withClass.querySelector("svg")?.getAttribute("class")).toContain("size-4");

		const { container: bare } = render(<GitDiffTabIcon />);
		expect(bare.querySelector("svg")).not.toBeNull();
	});
});
