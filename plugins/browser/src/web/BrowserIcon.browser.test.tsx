import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserIcon } from "./BrowserIcon.js";

const FAVICON_A = "data:image/png;base64,AAAA";
const FAVICON_B = "data:image/png;base64,BBBB";

afterEach(cleanup);

describe("BrowserIcon", () => {
	it("falls back to the globe when the favicon fails, and retries it after the icon changes", () => {
		const { container, rerender } = render(<BrowserIcon iconKey={FAVICON_A} />);
		const favicon = () => container.querySelector("img");
		expect(favicon()?.getAttribute("src")).toBe(FAVICON_A);

		fireEvent.error(favicon()!);
		expect(favicon()).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();

		rerender(<BrowserIcon iconKey={FAVICON_B} />);
		expect(favicon()?.getAttribute("src")).toBe(FAVICON_B);

		rerender(<BrowserIcon iconKey={FAVICON_A} />);
		expect(favicon()?.getAttribute("src")).toBe(FAVICON_A);
	});

	it("shows the globe for icons that aren't data images", () => {
		const { container } = render(<BrowserIcon iconKey="https://example.com/favicon.ico" />);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});
});
