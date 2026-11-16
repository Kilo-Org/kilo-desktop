import { describe, expect, it } from "vitest";

import {
	BROWSER_PANE_METADATA,
	FILE_OBJECT_TYPE,
	objectRefOfUrl,
	pageKey,
	paneUrl,
	titleOfObject,
	URL_OBJECT_TYPE,
} from "./index";
import {
	basename,
	isWebUrl,
	localFilePath,
	localFileUrl,
	normalizeBrowserUrl,
	normalizeWebUrl,
} from "./urls";

describe("normalizeBrowserUrl", () => {
	it("uses HTTP for loopback hosts and HTTPS for public hosts", () => {
		expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
		expect(normalizeBrowserUrl("127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
		expect(normalizeBrowserUrl("[::1]:8080")).toBe("http://[::1]:8080/");
		expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
	});

	it("preserves valid explicit HTTP URLs", () => {
		expect(normalizeBrowserUrl("https://example.com/path?q=1")).toBe(
			"https://example.com/path?q=1",
		);
	});

	it("accepts workspace file URLs, which the host authorizes per request", () => {
		expect(normalizeBrowserUrl("kilo-file://local/Users/me/project/Chart%20one.html")).toBe(
			"kilo-file://local/Users/me/project/Chart%20one.html",
		);
		expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
	});

	it("rejects empty, malformed and unsupported URLs without returning the raw input", () => {
		expect(() => normalizeBrowserUrl("  ")).toThrow("Enter a URL.");
		expect(() => normalizeBrowserUrl("ftp://user:secret@example.com/file")).toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
		expect(() => normalizeBrowserUrl("https://user:secret@example.com:bad/token")).toThrow(
			"Enter a valid URL.",
		);
	});

	it("keeps web links and the agent's tool to web pages", () => {
		expect(normalizeWebUrl("example.com/a")).toBe("https://example.com/a");
		expect(() => normalizeWebUrl(localFileUrl("/work/a.html"))).toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
		expect(isWebUrl(" https://example.com")).toBe(true);
		expect(isWebUrl("mailto:team@example.com")).toBe(false);
		expect(isWebUrl(undefined)).toBe(false);
	});
});

describe("local file URLs", () => {
	it("round-trip absolute paths, encoding each segment", () => {
		const url = localFileUrl("/Users/me/project/Chart one #1.html");
		expect(url).toBe("kilo-file://local/Users/me/project/Chart%20one%20%231.html");
		expect(localFilePath(url, false)).toBe("/Users/me/project/Chart one #1.html");
	});

	it("carry Windows drive paths", () => {
		const url = localFileUrl("C:\\Users\\me\\Chart.html");
		expect(url).toBe("kilo-file://local/C%3A/Users/me/Chart.html");
		expect(localFilePath(url, true)).toBe("C:/Users/me/Chart.html");
	});

	it("name no path for other or malformed URLs", () => {
		expect(localFilePath("https://local/etc/hosts", false)).toBeUndefined();
		expect(localFilePath("kilo-file://elsewhere/etc/hosts", false)).toBeUndefined();
		expect(localFilePath("kilo-file://local/%E0%A4%A", false)).toBeUndefined();
		expect(localFilePath("kilo-file://local/a%00b", false)).toBeUndefined();
		expect(localFilePath("not a url", false)).toBeUndefined();
	});
});

describe("pane URLs and objects", () => {
	it("restores the page a pane showed, else the object it was opened for", () => {
		const opened = (type: string, id: string) => ({ object: { type, id }, metadata: {} });
		expect(paneUrl({ metadata: { [BROWSER_PANE_METADATA.url]: "https://a.example/" } })).toBe(
			"https://a.example/",
		);
		expect(paneUrl(opened(URL_OBJECT_TYPE, "https://b.example/"))).toBe("https://b.example/");
		expect(paneUrl(opened(FILE_OBJECT_TYPE, "/work/a b.html"))).toBe(
			"kilo-file://local/work/a%20b.html",
		);
		expect(paneUrl(opened("kilo.other/thing", "x"))).toBe("");
		expect(paneUrl({ metadata: {} })).toBe("");
	});

	it("knows a page as a workspace file or a URL", () => {
		expect(objectRefOfUrl(localFileUrl("/work/a.html"), false)).toEqual({
			type: FILE_OBJECT_TYPE,
			id: "/work/a.html",
		});
		expect(objectRefOfUrl("https://example.com/", false)).toEqual({
			type: URL_OBJECT_TYPE,
			id: "https://example.com/",
		});
	});

	it("titles an opened object with its host or file name", () => {
		expect(titleOfObject({ type: URL_OBJECT_TYPE, id: "https://example.com:8080/a" })).toBe(
			"example.com:8080",
		);
		expect(titleOfObject({ type: FILE_OBJECT_TYPE, id: "C:\\work\\Index.html" })).toBe(
			"Index.html",
		);
		expect(titleOfObject({ type: URL_OBJECT_TYPE, id: "not a url" })).toBeUndefined();
		expect(titleOfObject({ type: "kilo.other/thing", id: "x" })).toBeUndefined();
		expect(basename("/")).toBe("/");
		expect(pageKey("s", "p")).toBe("s/p");
	});
});
