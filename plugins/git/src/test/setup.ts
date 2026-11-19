import { afterEach } from "vitest";

import { toast } from "@kilo-desktop/ui/components/sonner";

import "./globals.css";

// Sonner keeps toasts in a module-level store that outlives a test's render,
// so a toast raised by one test would still be on screen for the next.
afterEach(() => {
	toast.dismiss();
});
