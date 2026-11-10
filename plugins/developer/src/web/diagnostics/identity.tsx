import { KernelIdentity, type Account, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";

import { item, type DetailItem } from "./diagnostics-summary";
import { ownerRef } from "./domain-model";
import { DetailHeader, Details, Panel, toDisplayJson } from "./parts";

const selectIdentity = (state: DomainObjectState<typeof KernelIdentity>) => state;

/** Ids, not secrets: an account in `kernel/identity` carries no tokens. */
function accountItems(account: Account): DetailItem[] {
	const [pluginId] = account.source.split("/");
	return [
		{
			label: "Source",
			values: [{ code: account.source, ...(pluginId ? { link: ownerRef(pluginId) } : {}) }],
		},
		{ label: "Id", values: [{ code: account.id }] },
		...item("Email", account.email ? [{ text: account.email }] : []),
		...item("Name", account.name ? [{ text: account.name }] : []),
		...item(
			"Organization",
			account.organization
				? [
						{
							code: account.organization.id,
							...(account.organization.name ? { note: account.organization.name } : {}),
						},
					]
				: [],
		),
		...item(
			"Attributes",
			Object.keys(account.attributes).length > 0
				? [{ block: toDisplayJson(account.attributes) }]
				: [],
		),
	];
}

function AccountPanel({
	title,
	account,
	testId,
}: {
	readonly title: string;
	readonly account: Account;
	readonly testId: string;
}) {
	return (
		<Panel testId={testId}>
			<DetailHeader title={account.email ?? account.name ?? account.id} subtitle={title} />
			<Details className="border-t-0" items={accountItems(account)} />
		</Panel>
	);
}

/**
 * Who the user is (`kernel/identity`): the primary account flags and
 * telemetry key on, and the linked accounts added to it.
 */
export function IdentitySection() {
	const identity = useDomainObjectState(KernelIdentity, selectIdentity);
	if (!identity) {
		return (
			<p className="text-muted-foreground text-sm" data-qa-id="diagnostics-identity-unavailable">
				The identity isn't available in this window.
			</p>
		);
	}
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="diagnostics-identity">
			{identity.primary ? (
				<AccountPanel
					title="Primary account"
					account={identity.primary}
					testId="diagnostics-identity-primary"
				/>
			) : (
				<p className="text-muted-foreground text-sm" data-qa-id="diagnostics-identity-signed-out">
					No one is signed in: flags and telemetry see an anonymous user.
				</p>
			)}
			{identity.linked.map((account) => (
				<AccountPanel
					key={account.source}
					title="Linked account"
					account={account}
					testId={`diagnostics-identity-linked-${account.source}`}
				/>
			))}
		</div>
	);
}
