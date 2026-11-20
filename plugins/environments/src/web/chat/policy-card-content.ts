import type { PolicyBlockedPackage } from "../../contracts/common";
import {
	keyedBlockedPackages,
	type FriendlyEnvironmentsError,
} from "../providers/conda/environments-error-message";

/** A run of headline text; `code` runs (package names, channels) are set in mono. */
export interface TextPart {
	text: string;
	code?: true;
}

/** Which org and policy blocked packages, each null when unknown or not shared. */
export interface BlockedBy {
	org: string | null;
	policy: string | null;
}

/**
 * One blocked package. `org` and `policy` are set only when the card's
 * subline does not already name them, so the card never says them twice.
 */
export interface BlockedRow extends BlockedBy {
	key: string;
	label: string;
	reason: string | null;
}

export type PolicyCardContent =
	| {
			kind: "blocked";
			headline: TextPart[];
			/** Absent when the failure carried no structured packages. */
			by?: BlockedBy;
			rows: BlockedRow[];
			/** The bridge's own summary, for a block that carried no structured packages. */
			summary?: string;
			nextStep: string;
	  }
	| { kind: "policy-note"; headline: TextPart[]; subline: string; nextStep: string }
	| {
			kind: "sign-in";
			code: "NOT_SIGNED_IN" | "CHANNEL_ACCESS_DENIED";
			headline: TextPart[];
			subline: string;
	  };

/**
 * What the chat's policy card says for a failure, in reading order: what
 * is blocked, why, by whom, and what to do. Null for failures without a card.
 * The platform's policy names and reasons stay verbatim.
 */
export function policyCardContent(failure: FriendlyEnvironmentsError): PolicyCardContent | null {
	const channel = failure.policy?.refused?.channel;
	switch (failure.code) {
		case "POLICY_BLOCKED":
			return blockedContent(failure.policy?.blocked ?? [], failure.message);
		case "SOLVE_FAILED":
			return failure.policy?.policyNote === true
				? {
						kind: "policy-note",
						headline: [{ text: "Couldn't resolve the packages" }],
						subline: "Your organization's package policy may have removed a dependency.",
						nextStep: "Ask your organization's administrator, or try different versions.",
					}
				: null;
		case "NOT_SIGNED_IN":
			return {
				kind: "sign-in",
				code: failure.code,
				headline: channel
					? [{ text: "Sign in to Anaconda to use " }, { text: channelLabel(channel), code: true }]
					: [{ text: "Sign in to Anaconda to continue" }],
				subline: "Anaconda didn't accept the request because you're not signed in.",
			};
		case "CHANNEL_ACCESS_DENIED":
			return {
				kind: "sign-in",
				code: failure.code,
				headline: channel
					? [
							{ text: "Your Anaconda account can't use " },
							{ text: channelLabel(channel), code: true },
						]
					: [{ text: "Your Anaconda account can't use this channel" }],
				subline:
					"Ask your organization's administrator for access, or sign in with another account.",
			};
		default:
			return null;
	}
}

function blockedContent(
	blocked: readonly PolicyBlockedPackage[],
	summary: string,
): PolicyCardContent {
	const keyed = keyedBlockedPackages(blocked);
	const entries = keyed.map(({ entry }) => entry);
	if (entries.length === 0) {
		return {
			kind: "blocked",
			headline: [{ text: "Blocked by your organization's package policy" }],
			rows: [],
			summary,
			nextStep:
				"Ask your organization's administrator for an exception, or use a version the policy allows.",
		};
	}
	const orgShared = shares(entries, (entry) => entry.org);
	const policyShared = orgShared && shares(entries, (entry) => entry.policy);
	const [first] = entries as [PolicyBlockedPackage, ...PolicyBlockedPackage[]];
	const single = entries.length === 1;
	return {
		kind: "blocked",
		headline: single
			? [{ text: packageLabel(first), code: true }, { text: " is blocked" }]
			: [{ text: `${entries.length} packages are blocked` }],
		by: { org: orgShared ? first.org : null, policy: policyShared ? first.policy : null },
		rows: keyed.map(({ key, entry }) => ({
			key,
			label: packageLabel(entry),
			reason: entry.reason,
			org: orgShared ? null : entry.org,
			policy: policyShared ? null : entry.policy,
		})),
		nextStep: `Ask your organization's administrator for an exception, or use ${
			single ? "a version" : "versions"
		} the policy allows.`,
	};
}

function shares(
	entries: readonly PolicyBlockedPackage[],
	field: (entry: PolicyBlockedPackage) => string | null,
): boolean {
	return entries.every((entry) => field(entry) === field(entries[0]!));
}

function packageLabel({ package: name, version }: PolicyBlockedPackage): string {
	return version ? `${name} ${version}` : name;
}

/** The headline as one string (the card's accessible name). */
export function plainText(parts: readonly TextPart[]): string {
	return parts.map((part) => part.text).join("");
}

const ANACONDA_REPO_CHANNEL = /^https:\/\/repo\.anaconda\.cloud\/repo\/([^/]+\/[^/]+)\/?$/;

/**
 * A refused channel as the card names it: an Anaconda org channel URL as
 * its `org/channel` name, as conda users write it. Anything else stays
 * verbatim, including a one-segment repo URL whose short name (`main`) would
 * read as a different channel.
 */
export function channelLabel(channel: string): string {
	return ANACONDA_REPO_CHANNEL.exec(channel)?.[1] ?? channel;
}
