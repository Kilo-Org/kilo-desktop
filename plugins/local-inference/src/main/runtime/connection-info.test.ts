import { describe, expect, it } from "vitest";

import { advertisedListenHost, localConnectionInfo, pickLanIPv4 } from "./connection-info";

const info = localConnectionInfo(44123, "secret");

describe("localConnectionInfo", () => {
	it("builds the OpenAI-compatible listen address from the proxy port", () => {
		expect(info).toEqual({
			port: 44123,
			baseUrl: "http://127.0.0.1:44123/v1",
			apiKey: "secret",
		});
	});

	it("advertises a LAN host when serving on the local network", () => {
		expect(localConnectionInfo(44123, "secret", "192.168.1.20")).toEqual({
			port: 44123,
			baseUrl: "http://192.168.1.20:44123/v1",
			apiKey: "secret",
		});
	});
});

describe("pickLanIPv4", () => {
	it("prefers a physical RFC1918 address over VPN and link-local", () => {
		expect(
			pickLanIPv4({
				lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
				en0: [{ address: "192.168.1.20", family: 4, internal: false }],
				utun4: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
				en1: [{ address: "169.254.1.1", family: "IPv4", internal: false }],
			}),
		).toBe("192.168.1.20");
		expect(
			pickLanIPv4({
				Ethernet: [{ address: "192.168.0.12", family: "IPv4", internal: false }],
				"Wi-Fi": [{ address: "10.0.0.8", family: "IPv4", internal: false }],
			}),
		).toBe("192.168.0.12");
	});

	it("falls back to a VPN address when no physical LAN address exists", () => {
		expect(
			pickLanIPv4({
				lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
				utun4: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
			}),
		).toBe("10.8.0.2");
	});

	it("ranks RFC1918 ranges and skips IPv6 plus undefined NIC lists", () => {
		expect(
			pickLanIPv4({
				en0: [{ address: "172.16.4.2", family: "IPv4", internal: false }],
				en1: [{ address: "10.0.0.8", family: "IPv4", internal: false }],
				en2: undefined,
				en3: [{ address: "2001:db8::1", family: "IPv6", internal: false }],
			}),
		).toBe("10.0.0.8");
		expect(
			pickLanIPv4({
				en0: [{ address: "172.20.1.4", family: 4, internal: false }],
			}),
		).toBe("172.20.1.4");
		expect(
			pickLanIPv4({
				en0: [
					{ address: "172.16.1.8", family: "IPv4", internal: false },
					{ address: "172.16.1.4", family: "IPv4", internal: false },
				],
			}),
		).toBe("172.16.1.4");
		expect(
			pickLanIPv4({
				en0: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
			}),
		).toBe("8.8.8.8");
	});
});

describe("advertisedListenHost", () => {
	it("stays on loopback unless LAN serving is on and a LAN address exists", () => {
		const nics = {
			en0: [{ address: "192.168.1.20", family: "IPv4" as const, internal: false }],
		};
		expect(advertisedListenHost(false, nics)).toBe("127.0.0.1");
		expect(advertisedListenHost(true, nics)).toBe("192.168.1.20");
		expect(advertisedListenHost(true, {})).toBe("127.0.0.1");
	});
});
