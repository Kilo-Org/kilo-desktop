import { describe, expect, it } from "vitest";

import type { Account } from "@kilo-desktop/kernel";

import { contextFor } from "./context";

const account = (source: string, id: string): Account => ({ source, id, attributes: {} });

describe("contextFor", () => {
	it("is anonymous without accounts", () => {
		expect(contextFor({ primary: null, linked: [] })).toEqual({ isEmployee: false });
	});

	it("gives a second account from the same plugin its full source as kind", () => {
		const context = contextFor({
			primary: null,
			linked: [account("acme.sso/work", "w1"), account("acme.sso/home", "h1")],
		});

		expect(context.linkedAccounts?.map(({ kind, key }) => [kind, key])).toEqual([
			["acme.sso", "w1"],
			["acme.sso.home", "h1"],
		]);
	});
});
