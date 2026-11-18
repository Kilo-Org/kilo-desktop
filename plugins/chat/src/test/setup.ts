import { afterEach } from "vitest";
import { page } from "vitest/browser";

import { toast } from "@kilo-desktop/ui/components/sonner";

import "./globals.css";

afterEach(() => {
	document.querySelector('style[data-test="shell"]')?.remove();
	// Sonner keeps toasts in a module-level store that outlives a test's render,
	// so a toast raised by one test would still be on screen for the next.
	toast.dismiss();
});

// Tests that resize the viewport would otherwise leave the next test, in
// whatever order the file runs, laid out at their size.
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
	await page.viewport(initialViewport.width, initialViewport.height);
});
