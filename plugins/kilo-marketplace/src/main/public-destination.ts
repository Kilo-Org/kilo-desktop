import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Resolves a hostname to every address it maps to (`dns.lookup` with `all: true`). */
export type HostLookup = (hostname: string) => Promise<ReadonlyArray<{ readonly address: string }>>;

export const systemHostLookup: HostLookup = (hostname) =>
	dnsLookup(hostname, { all: true, verbatim: true });

const NON_PUBLIC_SUBNETS: ReadonlyArray<readonly [string, number, "ipv4" | "ipv6"]> = [
	["0.0.0.0", 8, "ipv4"], // unspecified / "this network"
	["10.0.0.0", 8, "ipv4"],
	["100.64.0.0", 10, "ipv4"], // CGNAT
	["127.0.0.0", 8, "ipv4"],
	["169.254.0.0", 16, "ipv4"], // link-local, cloud metadata
	["172.16.0.0", 12, "ipv4"],
	["192.0.0.0", 24, "ipv4"], // IETF protocol assignments
	["192.168.0.0", 16, "ipv4"],
	["198.18.0.0", 15, "ipv4"], // benchmarking
	["224.0.0.0", 4, "ipv4"], // multicast
	["240.0.0.0", 4, "ipv4"], // reserved + broadcast
	["::", 96, "ipv6"], // unspecified, loopback, deprecated IPv4-compatible
	["fc00::", 7, "ipv6"], // unique local
	["fe80::", 10, "ipv6"], // link-local
	["fec0::", 10, "ipv6"], // deprecated site-local
	["ff00::", 8, "ipv6"], // multicast
];

// BlockList also matches IPv4-mapped IPv6 (`::ffff:a.b.c.d`) against the IPv4 rules.
const nonPublicAddresses = new BlockList();
for (const [network, prefix, family] of NON_PUBLIC_SUBNETS) {
	nonPublicAddresses.addSubnet(network, prefix, family);
}

const RESERVED_HOSTNAME_SUFFIXES = ["localhost", "local", "internal"];

/** True for any address that is not a public unicast IP, including unparseable input. */
export function isNonPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return true;
	return nonPublicAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

function isReservedHostname(hostname: string): boolean {
	const name = hostname.toLowerCase().replace(/\.$/, "");
	return RESERVED_HOSTNAME_SUFFIXES.some(
		(suffix) => name === suffix || name.endsWith(`.${suffix}`),
	);
}

/**
 * Guards outbound fetches of untrusted URLs against reaching the user's
 * machine or network. Literal hosts are classified directly; names must
 * resolve exclusively to public addresses, and lookup failures fail closed.
 *
 * Residual risk: the fetch performs its own resolution afterwards, so a DNS
 * rebinding server could still answer differently (TOCTOU). Accepted for
 * credential-less, redirect-free, size-capped image fetches.
 */
export async function isPublicDestination(url: URL, lookup: HostLookup): Promise<boolean> {
	const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
	if (isIP(hostname)) return !isNonPublicAddress(hostname);
	if (!hostname || isReservedHostname(hostname)) return false;
	try {
		const addresses = await lookup(hostname);
		return addresses.length > 0 && addresses.every(({ address }) => !isNonPublicAddress(address));
	} catch {
		return false;
	}
}
