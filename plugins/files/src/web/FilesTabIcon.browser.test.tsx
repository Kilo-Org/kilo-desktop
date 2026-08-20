import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FilesTabIcon } from "./FilesTabIcon.js";

afterEach(cleanup);

describe("FilesTabIcon", () => {
	it("interprets the contributed icon key as a file path", () => {
		render(<FilesTabIcon className="size-3" iconKey="src/index.ts" />);

		const icon = document.querySelector<SVGElement>("[data-pierre-file-icon]");
		expect(icon?.getAttribute("data-icon-token")).toBe("typescript");
		expect(icon?.querySelector("use")?.getAttribute("href")).toBe("#file-tree-builtin-typescript");
	});
});
