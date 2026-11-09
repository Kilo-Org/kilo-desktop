import { createKiloClient } from "@kilocode/sdk/v2/client";

import type { ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

import type { KiloProfileData } from "../contracts";
import type { KiloAccountClient } from "./identity";

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

	return {
		async authStatus() {
			const { data } = await client.kilo.authStatus({ directory }, options);
			return { authenticated: data.authenticated === true };
		},
		async profile() {
			const { data } = await client.kilo.profile({ directory }, options);
			return data as KiloProfileData;
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
