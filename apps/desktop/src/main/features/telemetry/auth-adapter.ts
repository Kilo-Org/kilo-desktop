import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import type { UserInfoAttribute } from "../auth/actions.js";
import { primarySubscriptionFromAttributes } from "../auth/utils.js";
import { calculatePeriodId } from "./utils.js";
import type { AnonymizeOption, TelemetryAuthAdapter, TelemetryIdentity } from "./types.js";

/** Auth surface the adapter reads from `AuthSessionService`. */
export interface AuthSessionSlice {
	getSession(): Promise<AuthSession>;
	getApiKey(): Promise<string | null>;
	getUserInfo(): Promise<UserInfoAttribute[]>;
	onChanged(listener: (session: AuthSession) => void): () => void;
}

export interface AuthSessionTelemetryAdapterOptions {
	auth: AuthSessionSlice;
	now?: () => number;
}

const ANONYMOUS_IDENTITY: TelemetryIdentity = { isEmployee: false };

/**
 * Implements {@link TelemetryAuthAdapter} over the shell `AuthSessionService`.
 * Identity is cached and invalidated on `onChanged`; anonymous,
 * `anonymize: "always"`, or any failure yields `subscription: undefined` and
 * never throws.
 */
export class AuthSessionTelemetryAdapter implements TelemetryAuthAdapter {
	readonly #auth: AuthSessionSlice;
	readonly #now: () => number;

	#cached: TelemetryIdentity | undefined;
	#inFlight: Promise<TelemetryIdentity> | undefined;

	constructor(options: AuthSessionTelemetryAdapterOptions) {
		this.#auth = options.auth;
		this.#now = options.now ?? Date.now;

		this.#auth.onChanged(() => {
			this.#cached = undefined;
			this.#inFlight = undefined;
		});
	}

	async getIdentity(anonymize: AnonymizeOption): Promise<TelemetryIdentity> {
		if (anonymize === "always") return ANONYMOUS_IDENTITY;
		if (this.#cached) return this.#cached;
		this.#inFlight ??= this.#resolveIdentity().then((identity) => {
			this.#cached = identity;
			this.#inFlight = undefined;
			return identity;
		});
		return this.#inFlight;
	}

	async getApiKey(): Promise<string | null> {
		try {
			return await this.#auth.getApiKey();
		} catch {
			return null;
		}
	}

	onChanged(listener: () => void): () => void {
		return this.#auth.onChanged(() => listener());
	}

	async #resolveIdentity(): Promise<TelemetryIdentity> {
		let session: AuthSession;
		try {
			session = await this.#auth.getSession();
		} catch {
			return ANONYMOUS_IDENTITY;
		}

		if (session.status !== "authenticated") return ANONYMOUS_IDENTITY;

		const identity: TelemetryIdentity = {
			isEmployee: session.user.email?.split("@")[1]?.toLowerCase() === "anaconda.com",
			cohortId: calculatePeriodId(this.#now()),
		};
		if (session.user.userId !== undefined) identity.userId = session.user.userId;

		const subscription = await this.#resolveSubscription();
		if (subscription !== undefined) identity.subscription = subscription;

		return identity;
	}

	async #resolveSubscription(): Promise<string | undefined> {
		try {
			const attributes = await this.#auth.getUserInfo();
			return primarySubscriptionFromAttributes(attributes);
		} catch {
			return undefined;
		}
	}
}
