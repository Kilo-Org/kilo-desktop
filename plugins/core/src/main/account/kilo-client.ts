import type { IntegrationAttemptStatus } from "@kilocode/client";
import { KiloGatewayRpc } from "@kilocode/schema/kilocode/gateway";

import type { KiloProfile, ServerConnection } from "../../contracts";
import { callLocationRpc, createServerClient, locationPluginsReady } from "../agent/server-client";
import type { KiloAccountClient } from "./account-service";

/** Kilo v2's integration for Kilo's own gateway, and its device sign-in method. */
export const KILO_INTEGRATION_ID = "kilo";
const DEVICE_METHOD_ID = "device";
const ATTEMPT_POLL_MS = 1_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason ?? new Error("Sign-in was cancelled."));
			},
			{ once: true },
		);
	});
}

/** The attempt's failure for a person: Kilo's message, or what ended it. */
function attemptFailure(attempt: IntegrationAttemptStatus): Error {
	if (attempt.status === "failed") return new Error(attempt.message || "Sign-in failed.");
	if (attempt.status === "expired") return new Error("The sign-in code expired. Start again.");
	return new Error("Sign-in did not complete.");
}

/**
 * The account API of a running Kilo v2 server: the Kilo gateway's RPC
 * (`kilocode.gateway`) for status, profile and organisation, Kilo's `kilo`
 * integration for device sign-in, and its credential store for sign-out. Calls
 * run in `directory`'s location (kilo.core's global directory); RPCs wait out
 * a location that is still loading its plugins.
 */
export function createKiloAccountClient(
	connection: ServerConnection,
	directory: string = connection.globalDirectory,
): KiloAccountClient {
	const server = createServerClient(connection);
	const gateway = server.rpc(KiloGatewayRpc.Definition);
	const location = { location: { directory } };
	const read = <T>(call: () => Promise<T>) => callLocationRpc(server, directory, call);
	let attemptId: string | undefined;

	return {
		authStatus: () => read(() => gateway.authStatus({}, location)),
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
			await locationPluginsReady(server, directory);
			const { data: attempt } = await server.integration.oauth.connect({
				integrationID: KILO_INTEGRATION_ID,
				methodID: DEVICE_METHOD_ID,
				...location,
			});
			attemptId = attempt.attemptID;
			return {
				url: attempt.url,
				...(attempt.instructions ? { instructions: attempt.instructions } : {}),
			};
		},
		async callback(signal) {
			const id = attemptId;
			if (!id) throw new Error("No sign-in is in progress.");
			const attempt = { integrationID: KILO_INTEGRATION_ID, attemptID: id, ...location };
			const cancel = () => void server.integration.oauth.cancel(attempt).catch(() => undefined);
			signal.addEventListener("abort", cancel, { once: true });
			try {
				for (;;) {
					const { data: status } = await server.integration.oauth
						.status(attempt)
						.catch((error: unknown) => {
							// Cancelling removes the attempt, so a poll in flight then fails.
							signal.throwIfAborted();
							throw error;
						});
					signal.throwIfAborted();
					if (status.status === "complete") return;
					if (status.status !== "pending") throw attemptFailure(status);
					await delay(ATTEMPT_POLL_MS, signal);
				}
			} finally {
				signal.removeEventListener("abort", cancel);
				if (attemptId === id) attemptId = undefined;
			}
		},
		async signOut() {
			const credentials = await server.credential.list();
			await Promise.all(
				credentials
					.filter((credential) => credential.integrationID === KILO_INTEGRATION_ID)
					.map((credential) => server.credential.remove({ credentialID: credential.id })),
			);
		},
		async setOrganization(organizationId) {
			// Null selects the personal account.
			await read(() => gateway["organization.set"]({ organizationID: organizationId }, location));
		},
		dispose: () => server.location.reload(),
	};
}
