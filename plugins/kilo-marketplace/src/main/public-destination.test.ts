import { describe, expect, it, vi } from "vitest";

import { isNonPublicAddress, isPublicDestination } from "./public-destination.js";

const resolvesTo =
	(...addresses: string[]) =>
	async () =>
		addresses.map((address) => ({ address }));

describe("isNonPublicAddress", () => {
	it.each([
		"0.0.0.0",
		"10.1.2.3",
		"100.64.0.1",
		"127.0.0.1",
		"127.255.255.254",
		"169.254.169.254",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"224.0.0.1",
		"255.255.255.255",
		"::",
		"::1",
		"fc00::1",
		"fd12:3456::1",
		"fe80::1",
		"ff02::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:a9fe:a9fe",
		"not-an-ip",
	])("blocks %s", (address) => {
		expect(isNonPublicAddress(address)).toBe(true);
	});

	it.each([
		"8.8.8.8",
		"93.184.216.34",
		"172.32.0.1",
		"100.128.0.1",
		"2606:4700::1111",
		"::ffff:8.8.8.8",
	])("allows public %s", (address) => {
		expect(isNonPublicAddress(address)).toBe(false);
	});
});

describe("isPublicDestination", () => {
	it.each([
		"https://127.0.0.1/favicon.ico",
		"https://0x7f.1/favicon.ico",
		"https://[::1]/favicon.ico",
		"https://[::ffff:127.0.0.1]/favicon.ico",
		"https://[fd00::1]/favicon.ico",
		"https://169.254.169.254/latest/meta-data",
	])("rejects the literal address in %s without a DNS lookup", async (url) => {
		const lookup = vi.fn(resolvesTo("93.184.216.34"));

		await expect(isPublicDestination(new URL(url), lookup)).resolves.toBe(false);
		expect(lookup).not.toHaveBeenCalled();
	});

	it.each([
		"https://localhost/",
		"https://LOCALHOST./",
		"https://api.localhost/",
		"https://printer.local/",
		"https://metadata.google.internal/",
	])("rejects the reserved hostname in %s without a DNS lookup", async (url) => {
		const lookup = vi.fn(resolvesTo("93.184.216.34"));

		await expect(isPublicDestination(new URL(url), lookup)).resolves.toBe(false);
		expect(lookup).not.toHaveBeenCalled();
	});

	it("rejects a name when any resolved address is non-public", async () => {
		const lookup = vi.fn(resolvesTo("93.184.216.34", "10.0.0.5"));

		await expect(isPublicDestination(new URL("https://mixed.example.com/"), lookup)).resolves.toBe(
			false,
		);
		expect(lookup).toHaveBeenCalledWith("mixed.example.com");
	});

	it("rejects names that fail to resolve or resolve to nothing", async () => {
		await expect(
			isPublicDestination(new URL("https://missing.example.com/"), async () => {
				throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
			}),
		).resolves.toBe(false);
		await expect(
			isPublicDestination(new URL("https://empty.example.com/"), resolvesTo()),
		).resolves.toBe(false);
	});

	it("allows public literals and names that only resolve to public addresses", async () => {
		await expect(
			isPublicDestination(new URL("https://93.184.216.34/"), resolvesTo()),
		).resolves.toBe(true);
		await expect(
			isPublicDestination(
				new URL("https://mcp.example.com/"),
				resolvesTo("93.184.216.34", "2606:2800:220:1::1"),
			),
		).resolves.toBe(true);
	});
});
