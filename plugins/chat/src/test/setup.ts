import { afterEach } from "vitest";

import "./globals.css";

afterEach(() => {
	document.querySelector('style[data-test="shell"]')?.remove();
});
