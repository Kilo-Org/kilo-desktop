import { getPage } from "@anaconda/playwright-utils/page-utils";
import type { ElectronApplication } from "playwright";

type ThemeSource = "system" | "light" | "dark";

/**
 * Theme is renderer-owned and persisted in localStorage, so the page object
 * drives it through storage + reload rather than a UI toggle.
 */
export class ThemePage {
	constructor(private readonly app: ElectronApplication) {}

	async setStoredThemeSource(source: ThemeSource): Promise<void> {
		await getPage().evaluate((value) => {
			localStorage.setItem("theme:v1", value);
		}, source);
	}

	async reload(): Promise<void> {
		await getPage().reload({ waitUntil: "domcontentloaded" });
	}

	/**
	 * The pre-paint bootstrap (index.html inline script) must apply data-theme
	 * at domcontentloaded — before React mounts, so there is no light paint.
	 */
	async verifyEarlyDataTheme(expected: "dark" | "light"): Promise<void> {
		const actual = await getPage().evaluate(
			() => document.documentElement.dataset.theme ?? "light",
		);
		if (actual !== expected) {
			throw new Error(`Expected pre-paint data-theme "${expected}", got "${actual}"`);
		}
	}

	/**
	 * After theme:sync, native window chrome should match the page background
	 * (avoids hardcoding paint tokens in e2e).
	 */
	async verifyWindowBackgroundMatchesPage(): Promise<void> {
		const deadline = Date.now() + 5000;
		let last = { window: "", page: "" };
		while (Date.now() < deadline) {
			const pageBackground = await getPage().evaluate(() => {
				const value = getComputedStyle(document.documentElement).backgroundColor;
				// normalize rgb(r, g, b) → comparable form
				return value;
			});
			const windowBackground = await this.app.evaluate(({ BrowserWindow }) => {
				const hex = BrowserWindow.getAllWindows()[0]?.getBackgroundColor() ?? "";
				return hex;
			});
			last = { window: windowBackground, page: pageBackground };
			if (hexMatchesCssColor(windowBackground, pageBackground)) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(
			`Expected window background to match page. window="${last.window}" page="${last.page}"`,
		);
	}
}

function hexMatchesCssColor(hex: string, cssColor: string): boolean {
	const normalizedHex = hex.replace(/^#/, "").toLowerCase();
	if (!/^[0-9a-f]{6}$/.test(normalizedHex) && !/^[0-9a-f]{8}$/.test(normalizedHex)) {
		return false;
	}
	const r = Number.parseInt(normalizedHex.slice(0, 2), 16);
	const g = Number.parseInt(normalizedHex.slice(2, 4), 16);
	const b = Number.parseInt(normalizedHex.slice(4, 6), 16);
	return (
		cssColor === `rgb(${r}, ${g}, ${b})` ||
		cssColor === `rgba(${r}, ${g}, ${b}, 1)` ||
		cssColor.toLowerCase() === `#${normalizedHex.slice(0, 6)}`
	);
}
