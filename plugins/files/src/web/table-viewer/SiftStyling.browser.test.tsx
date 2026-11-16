import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Button } from "@kilo-desktop/ui/components/button";

import { loadSiftRuntime, type SiftLoadState } from "./sift-runtime.js";

/*
 * Sift's stylesheet arrives only with the lazily loaded adapter chunk, so this
 * file can measure the host before and after it is injected. Host tokens use
 * Kilo's real DOM contract (`html[data-theme="dark"]`) and the shadcn names
 * Sift falls back to; the values here are stand-ins, not an app theme.
 */
const HOST_TOKENS = `
:root {
	--background: rgb(250, 250, 250); --foreground: rgb(10, 10, 10);
	--card: rgb(244, 244, 245); --card-foreground: rgb(10, 10, 10);
	--popover: rgb(255, 255, 255); --popover-foreground: rgb(10, 10, 10);
	--primary: rgb(0, 90, 200); --primary-foreground: rgb(255, 255, 255);
	--secondary: rgb(235, 235, 235); --secondary-foreground: rgb(20, 20, 20);
	--muted: rgb(240, 240, 240); --muted-foreground: rgb(110, 110, 110);
	--accent: rgb(230, 230, 230); --accent-foreground: rgb(20, 20, 20);
	--destructive: rgb(200, 30, 30); --border: rgb(200, 200, 200);
	--input: rgb(210, 210, 210); --ring: rgb(120, 120, 120);
	--radius: 6px; --font-sans: "Host Sans", sans-serif; --font-mono: "Host Mono", monospace;
}
[data-theme="dark"] {
	--background: rgb(20, 20, 20); --foreground: rgb(230, 230, 230);
	--card: rgb(32, 32, 36); --card-foreground: rgb(230, 230, 230);
	--popover: rgb(28, 28, 30); --popover-foreground: rgb(230, 230, 230);
	--primary: rgb(90, 160, 255); --primary-foreground: rgb(0, 0, 0);
	--secondary: rgb(45, 45, 45); --secondary-foreground: rgb(230, 230, 230);
	--muted: rgb(40, 40, 40); --muted-foreground: rgb(160, 160, 160);
	--accent: rgb(50, 50, 50); --accent-foreground: rgb(230, 230, 230);
	--destructive: rgb(240, 80, 80); --border: rgb(60, 60, 60);
	--input: rgb(70, 70, 70); --ring: rgb(140, 140, 140);
}
body { background: var(--background); color: var(--foreground); margin: 8px; line-height: 1.25; }
.host-button { background: var(--primary); color: var(--primary-foreground); border: 1px solid var(--border); padding: 3px 9px; }
`;

type Theme = "light" | "dark";

interface HostSnapshot {
	readonly rootBackground: string;
	readonly bodyBackground: string;
	readonly bodyColor: string;
	readonly bodyMargin: string;
	readonly bodyLineHeight: string;
	readonly button: Record<string, string>;
	readonly kiloButton: Record<string, string>;
}

function setTheme(theme: Theme): void {
	if (theme === "dark") document.documentElement.dataset.theme = "dark";
	else delete document.documentElement.dataset.theme;
}

function pick(element: Element, properties: readonly string[]): Record<string, string> {
	const style = getComputedStyle(element);
	return Object.fromEntries(
		properties.map((property) => [property, style.getPropertyValue(property)]),
	);
}

const BUTTON_PROPERTIES = [
	"background-color",
	"color",
	"border-top-width",
	"border-top-color",
	"padding-left",
	"font-family",
	"line-height",
	"box-sizing",
] as const;

function hostSnapshot(): HostSnapshot {
	const root = getComputedStyle(document.documentElement);
	const body = getComputedStyle(document.body);
	return {
		rootBackground: root.getPropertyValue("--background").trim(),
		bodyBackground: body.backgroundColor,
		bodyColor: body.color,
		bodyMargin: body.margin,
		bodyLineHeight: body.lineHeight,
		button: pick(document.querySelector(".host-button")!, BUTTON_PROPERTIES),
		kiloButton: pick(document.querySelector('[data-qa-id="kilo-button"]')!, BUTTON_PROPERTIES),
	};
}

function mountHost() {
	const style = document.createElement("style");
	style.textContent = HOST_TOKENS;
	document.head.append(style);
	render(
		<div>
			<button className="host-button" type="button">
				Host
			</button>
			<Button data-qa-id="kilo-button">Kilo</Button>
		</div>,
	);
	return style;
}

function opaque(color: string): boolean {
	return color !== "" && color !== "transparent" && !/rgba\(.*,\s*0\)$/u.test(color);
}

afterEach(() => {
	cleanup();
	setTheme("light");
	document.head.querySelectorAll("style[data-host-tokens]").forEach((node) => node.remove());
	document
		.querySelectorAll(".foreign-popper-content")
		.forEach((node) => node.parentElement?.remove());
});

const FOREIGN_POPPER_PROPERTIES = [
	"--background",
	"--foreground",
	"--sift-panel",
	"background-color",
	"color",
	"font-family",
	"line-height",
	"box-sizing",
	"border-top-style",
] as const;

/** A Radix popper that is not Sift's (Radix is in Kilo's dependency tree). */
function mountForeignPopper(): Element {
	const wrapper = document.createElement("div");
	wrapper.setAttribute("data-radix-popper-content-wrapper", "");
	wrapper.innerHTML = '<div class="foreign-popper-content">Kilo menu</div>';
	document.body.append(wrapper);
	return wrapper;
}

function foreignSnapshot(wrapper: Element) {
	return {
		wrapper: pick(wrapper, FOREIGN_POPPER_PROPERTIES),
		content: pick(wrapper.firstElementChild!, FOREIGN_POPPER_PROPERTIES),
	};
}

function surfaceByTheme(element: Element): Record<Theme, { background: string; color: string }> {
	const result = {} as Record<Theme, { background: string; color: string }>;
	for (const theme of ["light", "dark"] as const) {
		setTheme(theme);
		const style = getComputedStyle(element);
		result[theme] = { background: style.backgroundColor, color: style.color };
	}
	setTheme("light");
	return result;
}

function expectThemedSurface(element: Element): void {
	const surface = surfaceByTheme(element);
	expect(opaque(surface.light.background)).toBe(true);
	expect(opaque(surface.dark.background)).toBe(true);
	expect(surface.light.background).not.toBe(surface.dark.background);
	expect(surface.light.color).not.toBe(surface.dark.color);
}

function touch(target: Element, type: "pointerdown" | "pointerup"): void {
	const rect = target.getBoundingClientRect();
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			pointerType: "touch",
			clientX: rect.left + 4,
			clientY: rect.top + 4,
		}),
	);
}

describe("scoped Sift styling", () => {
	it("isolates host and non-Sift portals in both themes while theming every Sift body root", async () => {
		const hostStyle = mountHost();
		hostStyle.dataset.hostTokens = "";
		const foreign = mountForeignPopper();
		const before = {} as Record<
			Theme,
			{ host: HostSnapshot; foreign: ReturnType<typeof foreignSnapshot> }
		>;
		for (const theme of ["light", "dark"] as const) {
			setTheme(theme);
			before[theme] = { host: hostSnapshot(), foreign: foreignSnapshot(foreign) };
		}
		setTheme("light");

		const { TableView } = await loadSiftRuntime();
		const states: SiftLoadState[] = [];
		render(
			<div style={{ display: "flex", height: 420, width: 900 }}>
				<TableView
					ariaLabel="styled"
					onError={() => undefined}
					onLoadStateChange={(state) => states.push(state)}
					source={{ kind: "csv", text: "city,score\nA,1\nB,2\nA,3\n", delimiter: "," }}
				/>
			</div>,
		);
		await vi.waitFor(() => expect(states).toContain("complete"), { timeout: 10_000 });

		const expectIsolated = () => {
			for (const theme of ["light", "dark"] as const) {
				setTheme(theme);
				expect(hostSnapshot()).toEqual(before[theme].host);
				expect(foreignSnapshot(foreign)).toEqual(before[theme].foreign);
			}
			setTheme("light");
		};
		expectIsolated();

		// Sift's palette resolves to the host theme in both modes: the table
		// surface, ink, rules and font are the host's tokens, not Sift's own.
		const table = document.querySelector(".sift-root.sift-table-container")!;
		const token = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();
		for (const theme of ["light", "dark"] as const) {
			setTheme(theme);
			const host = getComputedStyle(document.documentElement);
			const sift = getComputedStyle(table);
			expect(token(sift, "--sift-bg")).toBe(token(host, "--background"));
			expect(token(sift, "--sift-panel")).toBe(token(host, "--card"));
			expect(token(sift, "--sift-ink")).toBe(token(host, "--foreground"));
			expect(token(sift, "--sift-muted")).toBe(token(host, "--muted-foreground"));
			expect(token(sift, "--sift-rule")).toBe(token(host, "--border"));
			expect(token(sift, "--sift-font")).toBe(token(host, "--font-sans"));
			expect(getComputedStyle(table).backgroundColor).toBe(token(host, "--card"));
		}
		setTheme("light");

		// Category filter popover (Radix portal holding .sift-cat-popover).
		await page.getByRole("button", { name: "Open category filter editor" }).first().click();
		let popover: Element | null = null;
		await vi.waitFor(() => {
			popover = document.querySelector("[data-radix-popper-content-wrapper] .sift-cat-popover");
			expect(popover).not.toBeNull();
		});
		expectThemedSurface(
			popover!.closest("[data-radix-popper-content-wrapper]")!.firstElementChild!,
		);
		expectIsolated();
		await userEvent.keyboard("{Escape}");

		// Column context menu (#column-context-menu-root in body).
		const header = document.querySelector(".sift-th")!;
		const rect = header.getBoundingClientRect();
		header.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				clientX: rect.left + 8,
				clientY: rect.top + 8,
			}),
		);
		let menu: Element | null = null;
		await vi.waitFor(() => {
			menu = document.querySelector("body > #column-context-menu-root .sift-overlay-surface");
			expect(menu).not.toBeNull();
		});
		expectThemedSurface(menu!);
		expectIsolated();
		await userEvent.keyboard("{Escape}");

		// Narrow-viewport row detail sheet (.sift-detail-sheet in body).
		expect(window.innerWidth).toBeLessThan(768);
		const cell = document.querySelector(".sift-row .sift-cell")!;
		touch(cell, "pointerdown");
		touch(cell, "pointerup");
		let sheet: Element | null = null;
		await vi.waitFor(() => {
			sheet = document.querySelector("body > .sift-detail-sheet");
			expect(sheet).not.toBeNull();
		});
		expectThemedSurface(sheet!);
		expect(
			opaque(
				getComputedStyle(document.querySelector("body > .sift-detail-backdrop")!).backgroundColor,
			),
		).toBe(true);
		expectIsolated();
	});
});
