import { Definition as Gateway } from "@opencode/schema/kilocode/gateway";

import type { KiloProfile, ServerConnection } from "../../contracts";
import type { KiloAccountClient } from "./account-service";

import {
	callRpc,
	createServerClient,
	KiloRpcError,
	pluginsListed,
	toKiloError,
} from "../server-client";

/** Kilo's own integration and its device sign-in method. */
const KILO_INTEGRATION = "kilo";
const DEVICE_METHOD = "device";
const SIGN_IN_POLL_MS = 500;

/**
 * The account API of Desktop's Kilo v2 server: the `kilocode.gateway` RPC
 * for the account, the `kilo` integration's device OAuth for sign-in and its
 * credentials for sign-out. One client serves one connection; it remembers
 * the sign-in attempt `authorize` started so `callback` can wait for it.
 */
export function createKiloAccountClient(
	connection: ServerConnection,
	fetch: typeof globalThis.fetch = globalThis.fetch,
): KiloAccountClient {
	const directory = connection.globalDirectory;
	const location = { directory };
	const client = createServerClient(connection, fetch);
	const gateway = client.rpc(Gateway);
	let attemptID: string | undefined;

	async function optional<T>(read: () => Promise<T>): Promise<T | null> {
		return read().catch(() => null);
	}

	return {
		async authStatus() {
			const status = await callRpc(client, directory, (options) => gateway.authStatus({}, options));
			return { authenticated: status.authenticated };
		},
		async profile() {
			// Balance and Kilo Pass are extras: an account without them still has a profile.
			const [profile, balance, kiloPass] = await Promise.all([
				callRpc(client, directory, (options) => gateway.profile({}, options)),
				optional(() => callRpc(client, directory, (options) => gateway.balance({}, options))),
				optional(() => callRpc(client, directory, (options) => gateway.kiloPass({}, options))),
			]);
			return toKiloProfile(profile, balance, kiloPass);
		},
		async authorize() {
			// The device method comes from a plugin, registered with the location's plugins.
			await pluginsListed(client, directory);
			try {
				const { data } = await client.integration.oauth.connect({
					integrationID: KILO_INTEGRATION,
					methodID: DEVICE_METHOD,
					location,
				});
				attemptID = data.attemptID;
				return { url: data.url, instructions: data.instructions };
			} catch (error) {
				throw toKiloError(error);
			}
		},
		async callback(signal) {
			const attempt = attemptID;
			if (!attempt) throw new Error("No Kilo sign-in in progress.");
			const cancel = () =>
				void client.integration.oauth
					.cancel({ integrationID: KILO_INTEGRATION, attemptID: attempt, location })
					.catch(() => undefined);
			signal.addEventListener("abort", cancel, { once: true });
			try {
				for (;;) {
					signal.throwIfAborted();
					const { data } = await client.integration.oauth.status(
						{ integrationID: KILO_INTEGRATION, attemptID: attempt, location },
						{ signal },
					);
					if (data.status === "complete") return;
					if (data.status === "failed") throw new Error(data.message);
					if (data.status === "expired") throw new Error("The sign-in code expired.");
					await delay(SIGN_IN_POLL_MS, signal);
				}
			} finally {
				signal.removeEventListener("abort", cancel);
				if (attemptID === attempt) attemptID = undefined;
			}
		},
		async signOut() {
			const credentials = await client.credential.list();
			await Promise.all(
				credentials
					.filter((credential) => credential.integrationID === KILO_INTEGRATION)
					.map((credential) => client.credential.remove({ credentialID: credential.id })),
			);
		},
		async setOrganization(organizationId) {
			await callRpc(client, directory, (options) =>
				gateway["organization.set"]({ organizationID: organizationId }, options),
			).catch((error: unknown) => {
				// The gateway saves the selection before loading the team's model
				// catalog, so `failed` means switched, with models to follow.
				if (error instanceof KiloRpcError && error.type === "failed") return;
				throw error;
			});
		},
		async dispose() {
			await client.location.reload();
		},
	};
}

interface V2Profile {
	readonly email: string;
	readonly name?: string | undefined;
	readonly organizations: readonly {
		readonly id: string;
		readonly name: string;
		readonly role?: string | undefined;
	}[];
	readonly hasPersonalAccount: boolean;
	readonly organizationID: string | null;
}

interface V2Balance {
	readonly balance: number | null;
}

interface V2KiloPass {
	readonly currentPeriodBaseCreditsUsd: number;
	readonly currentPeriodUsageUsd: number;
	readonly currentPeriodBonusCreditsUsd: number;
	readonly nextBillingAt: string | null;
}

/** Today's account profile, assembled from v2's profile, balance and Kilo Pass answers. */
export function toKiloProfile(
	profile: V2Profile,
	balance: V2Balance | null,
	kiloPass: V2KiloPass | null,
): KiloProfile {
	return {
		profile: {
			email: profile.email,
			...(profile.name === undefined ? {} : { name: profile.name }),
			organizations: profile.organizations.map((organization) => ({
				id: organization.id,
				name: organization.name,
				role: organization.role ?? "",
			})),
			selectedOrganizationId: profile.organizationID,
			hasPersonalAccount: profile.hasPersonalAccount,
		},
		balance: balance?.balance == null ? null : { balance: balance.balance },
		kiloPass: kiloPass ? { ...kiloPass } : null,
		currentOrgId: profile.organizationID,
	};
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
