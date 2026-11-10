import { afterEach, describe, expect, it } from "vitest";

import { isInteractiveTarget } from "./DotGrid";

afterEach(() => {
	document.body.replaceChildren();
});

function mount(html: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = html;
	document.body.append(host);
	return host;
}

describe("isInteractiveTarget", () => {
	it("treats a checkbox, its label text, and links inside the label as interactive", () => {
		const host = mount(
			'<label><span role="checkbox" id="box"></span><span id="text">I agree to the <a id="link" href="#">Terms</a></span></label>',
		);

		for (const id of ["box", "text", "link"]) {
			expect(isInteractiveTarget(host.querySelector(`#${id}`))).toBe(true);
		}
	});

	it("lets clicks on plain background through so they ripple", () => {
		const host = mount('<div id="background"><p id="copy">Welcome</p></div>');

		expect(isInteractiveTarget(host.querySelector("#background"))).toBe(false);
		expect(isInteractiveTarget(host.querySelector("#copy"))).toBe(false);
		expect(isInteractiveTarget(null)).toBe(false);
	});
});
