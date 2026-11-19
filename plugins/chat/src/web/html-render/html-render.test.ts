import { describe, expect, it } from "vitest";

import { HTML_RENDER_TOOL_NAME, htmlPageFileStem, isHtmlRenderToolName } from "../../contracts";
import {
	htmlRenderContentSecurityPolicy,
	injectHtmlRenderBootstrap,
	readHtmlRenderContentHeight,
	readHtmlRenderLinkUrl,
	type HtmlRenderTheme,
} from "./html-render-bootstrap";

const theme: HtmlRenderTheme = {
	appearance: "dark",
	variables: { "--foreground": "white", "--chart-1": "#60a5fa" },
};

const BOOTSTRAP_MARKER = 'id="kilo-html-render-theme"';

describe("HTML_RENDER_TOOL_NAME", () => {
	it("still recognises origin's name in recorded chats", () => {
		expect(isHtmlRenderToolName("desktop_kilo_ui_html_render")).toBe(true);
		expect(isHtmlRenderToolName(HTML_RENDER_TOOL_NAME)).toBe(true);
		expect(isHtmlRenderToolName("bash")).toBe(false);
	});
});

describe("htmlPageFileStem", () => {
	it("keeps titles that are safe file names", () => {
		expect(htmlPageFileStem("Sales chart")).toBe("Sales chart");
	});

	it("drops separators, reserved characters, leading dots and trailing dots", () => {
		expect(htmlPageFileStem("../a/b:c*?.")).toBe("a b c");
		expect(htmlPageFileStem("...")).toBe("Page");
	});

	it("renames Windows device names", () => {
		expect(htmlPageFileStem("NUL")).toBe("NUL page");
		expect(htmlPageFileStem("con.report")).toBe("con page.report");
	});
});

describe("injectHtmlRenderBootstrap", () => {
	it("puts the theme and bootstrap first in an existing head, before the page's styles", () => {
		const page = injectHtmlRenderBootstrap(
			"<!doctype html><html><head><style>:root{--foreground:red}</style></head><body>x</body></html>",
			theme,
		);
		expect(page.indexOf(BOOTSTRAP_MARKER)).toBeGreaterThan(page.indexOf("<head>"));
		expect(page.indexOf(BOOTSTRAP_MARKER)).toBeLessThan(page.indexOf("--foreground:red"));
		expect(page).toContain(":root{color-scheme:dark;--foreground:white;--chart-1:#60a5fa;}");
	});

	it("creates a head for fragments, bare documents, and doctype-only pages", () => {
		for (const html of ["<div>chart</div>", "<html><body>x</body></html>", "<!DOCTYPE html><p>x"]) {
			const page = injectHtmlRenderBootstrap(html, theme);
			expect(page).toMatch(/<head><meta charset="utf-8">/);
			expect(page).toContain(BOOTSTRAP_MARKER);
		}
	});

	it("ignores a <head> inside comments, scripts, and templates", () => {
		const html =
			'<!-- <head> --><script>const s = "<head>";</script><template><head></template><html><head><title>t</title></head></html>';
		const page = injectHtmlRenderBootstrap(html, theme);
		expect(page.indexOf(BOOTSTRAP_MARKER)).toBeGreaterThan(page.lastIndexOf("<html><head>"));
		expect(page.match(new RegExp(BOOTSTRAP_MARKER, "g"))).toHaveLength(1);
	});

	it("strips characters that could break out of the theme rule", () => {
		const page = injectHtmlRenderBootstrap("<p>x</p>", {
			appearance: "light",
			variables: { "--foreground": "red;}</style><script>alert(1)</script>", "bad name": "x" },
		});
		expect(page).toContain("--foreground:red/stylescriptalert(1)/script;");
		expect(page).not.toContain("bad name");
	});

	it("gives a saved copy the theme and its own background but no frame script", () => {
		const page = injectHtmlRenderBootstrap("<p>x</p>", theme, { standalone: true });
		expect(page).toContain("--foreground:white;");
		expect(page).toContain("html{background:var(--background)}");
		expect(page).not.toContain("<script>");
		expect(page).not.toContain("scrollbar-width:none");
	});

	it("leads a saved copy with the html-render CSP, ahead of any page markup", () => {
		const page = injectHtmlRenderBootstrap(
			"<!DOCTYPE html><html><script>early()</script><head></head><body>x</body></html>",
			theme,
			{ standalone: true },
		);
		const policy = htmlRenderContentSecurityPolicy();
		expect(
			page.startsWith(
				`<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`,
			),
		).toBe(true);
		expect(policy).toContain("connect-src 'none'");
		expect(policy).toContain("img-src data: blob:");
		expect(policy).not.toContain("localhost");
		expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("early()"));
		expect(page.match(/charset/g)).toHaveLength(1);
	});

	it("keeps an existing charset and viewport", () => {
		const page = injectHtmlRenderBootstrap(
			'<head><meta charset="utf-8"><meta name="viewport" content="width=500"></head>',
			theme,
		);
		expect(page.match(/charset/g)).toHaveLength(1);
		expect(page.match(/name="viewport"/g)).toHaveLength(1);
	});
});

describe("page messages", () => {
	it("reads a positive finite content height only", () => {
		const size = (height: unknown) => ({
			jsonrpc: "2.0",
			method: "ui/notifications/size-changed",
			params: { height },
		});
		expect(readHtmlRenderContentHeight(size(512))).toBe(512);
		expect(readHtmlRenderContentHeight(size(0))).toBeUndefined();
		expect(readHtmlRenderContentHeight(size(Number.POSITIVE_INFINITY))).toBeUndefined();
		expect(
			readHtmlRenderContentHeight({ method: "ui/notifications/size-changed" }),
		).toBeUndefined();
	});

	it("accepts only http(s) link requests", () => {
		const link = (url: unknown) => ({
			jsonrpc: "2.0",
			id: "kilo-link-1",
			method: "ui/open-link",
			params: { url },
		});
		expect(readHtmlRenderLinkUrl(link("https://example.com/a"))).toBe("https://example.com/a");
		expect(readHtmlRenderLinkUrl(link("javascript:alert(1)"))).toBeUndefined();
		expect(readHtmlRenderLinkUrl(link("file:///etc/passwd"))).toBeUndefined();
		expect(readHtmlRenderLinkUrl(link("not a url"))).toBeUndefined();
	});
});
