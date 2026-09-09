export interface NetworkAddress {
	readonly address: string;
	readonly family: string | number;
	readonly internal: boolean;
}

const VIRTUAL_NIC = /^(lo|utun|tun|awdl|llw|bridge|docker|br-|veth|vmnet|vboxnet|cni|flannel|zt)/i;
const PHYSICAL_NIC = /^(en|eth|wlan|wl|wifi|wi-fi|eno|ens|enp|wlp)/i;

export function localConnectionInfo(port: number, apiKey: string, host = "127.0.0.1") {
	return {
		port,
		baseUrl: `http://${host}:${String(port)}/v1`,
		apiKey,
	};
}

export function advertisedListenHost(
	serveOnLocalNetwork: boolean,
	nics: Readonly<Record<string, readonly NetworkAddress[] | undefined>>,
): string {
	if (!serveOnLocalNetwork) return "127.0.0.1";
	return pickLanIPv4(nics) ?? "127.0.0.1";
}

export function pickLanIPv4(
	nics: Readonly<Record<string, readonly NetworkAddress[] | undefined>>,
): string | undefined {
	let best: { address: string; score: number; name: string } | undefined;
	for (const name of Object.keys(nics).toSorted()) {
		for (const addr of nics[name] ?? []) {
			if (!isIPv4(addr.family) || addr.internal || isLinkLocal(addr.address)) continue;
			const score = addressScore(name, addr.address);
			if (
				!best ||
				score > best.score ||
				(score === best.score &&
					(name < best.name || (name === best.name && addr.address < best.address)))
			) {
				best = { address: addr.address, score, name };
			}
		}
	}
	return best?.address;
}

function isIPv4(family: string | number): boolean {
	return family === "IPv4" || family === 4;
}

function isLinkLocal(address: string): boolean {
	return address.startsWith("169.254.");
}

function addressScore(name: string, address: string): number {
	let score = rfc1918Score(address);
	if (PHYSICAL_NIC.test(name)) score += 10;
	if (VIRTUAL_NIC.test(name)) score -= 20;
	return score;
}

function rfc1918Score(address: string): number {
	if (address.startsWith("192.168.")) return 3;
	if (address.startsWith("10.")) return 2;
	const octets = address.split(".");
	const a = Number(octets[0]);
	const b = Number(octets[1]);
	if (a === 172 && b >= 16 && b <= 31) return 1;
	return 0;
}
