import { afterEach } from "vitest";
import { page } from "vitest/browser";

import "./globals.css";

// Tests that resize the viewport would otherwise leave the next test, in
// whatever order the file runs, laid out at their size.
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
	await page.viewport(initialViewport.width, initialViewport.height);
});
