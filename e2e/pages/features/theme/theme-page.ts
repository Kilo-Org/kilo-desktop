import { getPage } from "@anaconda/playwright-utils/page-utils";

type ThemeSource = "system" | "light" | "dark";

export class ThemePage {
	async setStoredThemeSource(source: ThemeSource): Promise<void> {
		await getPage().evaluate((value) => {
			localStorage.setItem("theme:v1", value);
		}, source);
	}

	async reload(): Promise<void> {
		await getPage().reload({ waitUntil: "domcontentloaded" });
	}

	async verifyResolvedTheme(expected: "dark" | "light"): Promise<void> {
		const actual = await getPage().evaluate(
			() => document.documentElement.dataset.theme ?? "light",
		);
		if (actual !== expected) {
			throw new Error(`Expected resolved data-theme "${expected}", got "${actual}"`);
		}
	}
}
