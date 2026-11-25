import { KiloGatewayRpc } from "@kilocode/schema/kilocode/gateway";
import { createKiloClient } from "@kilocode/sdk/v2/client";

import type { KiloProfile, ServerConnection } from "../../contracts";
import { callLocationRpc, createServerClient } from "../agent/server-client";
import type { KiloAccountClient } from "./account-service";

const KILO_PROVIDER = "kilo";
/** Kilo's device sign-in method for its own provider. */
const DEVICE_METHOD = 0;

/** The account API of a running Kilo server, through its SDK. */
export function createKiloAccountClient(connection: ServerConnection): KiloAccountClient {
	const directory = connection.globalDirectory;
	const client = createKiloClient({
		baseUrl: connection.baseUrl,
		headers: {
			Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
		},
		directory,
	});
	const options = { throwOnError: true } as const;
	const server = createServerClient(connection);
	const gateway = server.rpc(KiloGatewayRpc.Definition);
	const location = { location: { directory } };
	const read = <T>(call: () => Promise<T>) => callLocationRpc(server, directory, call);

	return {
		async authStatus() {
			const { data } = await client.kilo.authStatus({ directory }, options);
			return { authenticated: data.authenticated === true };
		},
		async profile(): Promise<KiloProfile> {
			// Balance and Kilo Pass are extras: an account without them still has a profile.
			const [profile, balance, kiloPass] = await Promise.all([
				read(() => gateway.profile({}, location)),
				read(() => gateway.balance({}, location)).catch(() => null),
				read(() => gateway.kiloPass({}, location)).catch(() => null),
			]);
			return {
				email: profile.email,
				...(profile.name === undefined ? {} : { name: profile.name }),
				organizations: profile.organizations.map((organization) => ({ ...organization })),
				hasPersonalAccount: profile.hasPersonalAccount,
				organizationId: profile.organizationID,
				balance: balance ? { ...balance } : null,
				kiloPass: kiloPass ? { ...kiloPass } : null,
			};
		},
		async authorize() {
			const { data } = await client.provider.oauth.authorize(
				{ providerID: KILO_PROVIDER, method: DEVICE_METHOD, directory },
				options,
			);
			return { url: data.url, instructions: data.instructions };
		},
		async callback(signal) {
			await client.provider.oauth.callback(
				{ providerID: KILO_PROVIDER, method: DEVICE_METHOD, directory },
				{ ...options, signal },
			);
		},
		async signOut() {
			await client.auth.remove({ providerID: KILO_PROVIDER }, options);
		},
		async setOrganization(organizationId) {
			await client.kilo.organization.set({ organizationId, directory }, options);
		},
		async dispose() {
			await client.global.dispose();
		},
	};
}
