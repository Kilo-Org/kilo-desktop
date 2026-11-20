import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import type { AnacondaAccountResult } from "@kilo-desktop/plugin-anaconda/contracts";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import {
	CHAT_DEFINITIONS,
	ToolRenderer,
	type ToolCallProps,
	type ToolRendererImplementation,
} from "@kilo-desktop/plugin-chat/contracts";

import {
	formatEnvironmentsErrorMessage,
	type PolicyBlockedPackage,
	type PolicyNotice,
} from "../../contracts/common";
import { bootEnvironmentsHost, type EnvironmentsHostOptions } from "../../test/environments-host";
import { environmentsWebEntry } from "../index";

afterEach(cleanup);

const chat = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };

const pkg = (overrides: Partial<PolicyBlockedPackage> = {}): PolicyBlockedPackage => ({
	package: "pillow",
	version: "8.4.0",
	channel: "defaults",
	org: "acme",
	policy: "organization_policy",
	policyId: null,
	reason: "Known vulnerabilities",
	...overrides,
});

const blockedMessage = (blocked: PolicyBlockedPackage[]) =>
	formatEnvironmentsErrorMessage(
		"POLICY_BLOCKED",
		`${blocked.map((entry) => `${entry.package} is blocked by ${entry.policy}`).join("\n")}\n\nsolver output`,
		{ blocked } satisfies PolicyNotice,
	);

const BLOCKED_MESSAGE = blockedMessage([pkg()]);

const install: ToolCallProps = {
	toolCallId: "call_install",
	toolName: "desktop_environments_conda_packages_install",
	args: { name: "dev", packages: ["pillow=8.4.0"] },
	argsText: "{}",
	status: { type: "complete" },
};

const failedInstall = (result: unknown): ToolCallProps => ({
	...install,
	result,
	isError: true,
	status: { type: "incomplete", reason: "error" },
});

function Original({ toolName }: ToolCallProps) {
	return <p data-qa-id="chat-default-row">{toolName}</p>;
}

async function renderCall(call: ToolCallProps, options: EnvironmentsHostOptions = {}) {
	const host = await bootEnvironmentsHost({
		webEntry: environmentsWebEntry,
		plugins: [chat],
		...options,
	});
	const contribution = host.renderer.extensions
		.list(ToolRenderer)
		.find((candidate) => candidate.key === "kilo.environments/conda-policy")!;
	const implementation = contribution.implementation as ToolRendererImplementation;
	host.render(
		<RenderContribution
			contribution={contribution}
			props={{ ...call, Original }}
			select={(renderer: ToolRendererImplementation) => renderer.component}
		/>,
	);
	return { host, isStandalone: implementation.isStandalone!(call) };
}

const card = () => page.getByTestId("environments-chat-policy-card");

const headline = () => page.getByTestId("environments-chat-policy-card-headline");
const signInButton = () => page.getByTestId("environments-anaconda-sign-in");

const signInRefusal = (code: "NOT_SIGNED_IN" | "CHANNEL_ACCESS_DENIED", channel: string) => ({
	content: [
		{
			type: "text",
			text: formatEnvironmentsErrorMessage(code, undefined, {
				refused: { org: null, channel },
			}),
		},
	],
});

describe("conda policy failures in the chat", () => {
	it("leads a block with the package, then the policy and its reason once each, the default row one click away", async () => {
		const { isStandalone } = await renderCall(failedInstall(BLOCKED_MESSAGE));

		await expect.element(headline()).toHaveTextContent("pillow 8.4.0 is blocked");
		await expect
			.element(page.getByRole("group", { name: "pillow 8.4.0 is blocked" }))
			.toBeVisible();
		await expect
			.element(card())
			.toMatchTextContent(/by acme's package policy · organization_policy/);
		await expect
			.element(page.getByTestId("environments-chat-policy-card-reason"))
			.toHaveTextContent("Known vulnerabilities");
		// The bridge's summary sentence would only repeat the rows.
		await expect.element(card()).not.toMatchTextContent(/is blocked by organization_policy/);
		await expect
			.element(card())
			.toMatchTextContent(/Ask your organization's administrator for an exception/);
		await expect.element(page.getByTestId("chat-default-row")).not.toBeInTheDocument();
		expect(isStandalone).toBe(true);

		await page.getByTestId("environments-chat-policy-card-details").click();
		await expect.element(page.getByTestId("chat-default-row")).toBeVisible();
		await expect.element(card()).toMatchTextContent(/solver output$/);
	});

	it("lists several blocks, naming on a row only the org or policy the card's subline does not", async () => {
		await renderCall(
			failedInstall(
				blockedMessage([
					pkg(),
					pkg({ package: "numpy", version: null, policy: "strict_policy", reason: null }),
					pkg({ package: "scipy", version: "1.0" }),
				]),
			),
		);

		await expect.element(headline()).toHaveTextContent("3 packages are blocked");
		await expect.element(card()).toMatchTextContent(/by acme's package policy/);
		const rows = page.getByTestId("environments-policy-blocked-package");
		await expect
			.element(rows.nth(0))
			.toHaveTextContent("pillow 8.4.0Known vulnerabilitiesorganization_policy");
		await expect
			.element(rows.nth(1))
			.toHaveTextContent("numpyNo reason given by the policy.strict_policy");
		await expect
			.element(rows.nth(2))
			.toHaveTextContent("scipy 1.0Known vulnerabilitiesorganization_policy");
	});

	it("explains a solve failure the policy may be behind", async () => {
		const { isStandalone } = await renderCall(
			failedInstall(
				formatEnvironmentsErrorMessage("SOLVE_FAILED", "nothing provides holoviews", {
					policyNote: true,
				}),
			),
		);

		await expect.element(headline()).toHaveTextContent("Couldn't resolve the packages");
		await expect
			.element(card())
			.toMatchTextContent(/Your organization's package policy may have removed a dependency\./);
		expect(isStandalone).toBe(true);

		await page.getByTestId("environments-chat-policy-card-details").click();
		await expect.element(card()).toMatchTextContent(/nothing provides holoviews$/);
	});

	it("signs in to Anaconda from the card, then says to ask the agent again", async () => {
		const signIn = vi.fn((): AnacondaAccountResult => ({ ok: true }));
		const { isStandalone } = await renderCall(
			failedInstall(signInRefusal("NOT_SIGNED_IN", "https://repo.anaconda.cloud/repo/acme/main")),
			{ anaconda: { signIn } },
		);

		await expect.element(headline()).toHaveTextContent("Sign in to Anaconda to use acme/main");
		await expect
			.element(page.getByTestId("environments-chat-policy-retry-hint"))
			.not.toBeInTheDocument();
		expect(isStandalone).toBe(true);

		await signInButton().click();

		expect(signIn).toHaveBeenCalledOnce();
		await expect
			.element(page.getByTestId("environments-chat-policy-retry-hint"))
			.toHaveTextContent("Signed in. Ask the agent to try again.");
		await expect.element(signInButton()).not.toBeInTheDocument();
	});

	it("says why a sign-in failed and keeps the button to try again", async () => {
		await renderCall(failedInstall(signInRefusal("CHANNEL_ACCESS_DENIED", "acme/main")), {
			anaconda: { signIn: () => ({ ok: false, reason: "the browser closed" }) },
		});

		await expect.element(headline()).toHaveTextContent("Your Anaconda account can't use acme/main");
		await signInButton().click();

		await expect
			.element(page.getByTestId("environments-anaconda-sign-in-error"))
			.toHaveTextContent("Could not sign in to Anaconda: the browser closed");
		await expect.element(signInButton()).toBeEnabled();
	});

	it("leaves out the sign-in button without kilo.anaconda", async () => {
		await renderCall(failedInstall("CHANNEL_ACCESS_DENIED: 403"));

		await expect
			.element(headline())
			.toHaveTextContent("Your Anaconda account can't use this channel");
		await expect.element(signInButton()).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("environments-chat-policy-retry-hint"))
			.not.toBeInTheDocument();
	});

	it("keeps the default row, inside the fold, for other failures and for successes", async () => {
		const other = await renderCall(failedInstall("PACKAGE_NOT_FOUND: nope"));
		await expect.element(page.getByTestId("chat-default-row")).toBeVisible();
		await expect.element(card()).not.toBeInTheDocument();
		expect(other.isStandalone).toBe(false);

		const done = await renderCall({ ...install, result: BLOCKED_MESSAGE });
		await expect.element(page.getByTestId("chat-default-row")).toBeVisible();
		await expect.element(card()).not.toBeInTheDocument();
		expect(done.isStandalone).toBe(false);
	});
});
