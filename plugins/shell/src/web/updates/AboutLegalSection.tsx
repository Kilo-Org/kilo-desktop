import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";

import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { KILO_TERMS_URL } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { FieldContent, FieldLegend, FieldSet } from "@kilo-desktop/ui/components/field";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";

import { Legal } from "../../contracts";

type LegalDomain = NonNullable<ReturnType<typeof useDomainObject<typeof Legal>>>;
type ReadableDocument = "third-party-notices";

const DOCUMENTS: Readonly<
	Record<ReadableDocument, { title: string; description: string; qaId: string }>
> = {
	"third-party-notices": {
		title: "Third-party notices",
		description: "The third-party software Kilo Desktop includes, with its license terms.",
		qaId: "about-view-third-party-notices",
	},
};

/**
 * Settings → About "Legal" card: Kilo's terms of service, the notices of the
 * third-party software it includes (licenses such as BSD-3-Clause require
 * them to be shown) and Chromium's credits, which are HTML and so revealed
 * in the file manager instead of shown.
 */
export function AboutLegalSection() {
	const legal = useDomainObject(Legal);
	const [open, setOpen] = useState<ReadableDocument | null>(null);
	if (!legal) return null;

	return (
		<FieldSet className="min-w-0" aria-labelledby="about-legal-heading" data-qa-id="about-legal">
			<FieldContent>
				<FieldLegend id="about-legal-heading" variant="label" className="mb-0">
					Legal
				</FieldLegend>
			</FieldContent>
			<section className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
				<div>
					<TermsOfServiceRow />
				</div>
				{(Object.keys(DOCUMENTS) as ReadableDocument[]).map((document) => (
					<div key={document}>
						<SummaryCard.Row>
							<SummaryCard.Content>
								<SummaryCard.Title>{DOCUMENTS[document].title}</SummaryCard.Title>
								<SummaryCard.Description>{DOCUMENTS[document].description}</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
								<Button
									size="sm"
									variant="outline"
									data-qa-id={DOCUMENTS[document].qaId}
									onClick={() => setOpen(document)}
								>
									View
								</Button>
							</SummaryCard.Actions>
						</SummaryCard.Row>
					</div>
				))}
				<div>
					<ChromiumNoticesRow legal={legal} />
				</div>
			</section>
			<LegalDocumentDialog legal={legal} document={open} onClose={() => setOpen(null)} />
		</FieldSet>
	);
}

function TermsOfServiceRow() {
	const os = useDomainObject(KernelOs);

	const open = async () => {
		try {
			await os?.methods.openExternal({ url: KILO_TERMS_URL });
		} catch (error) {
			toast.error("Could not open the terms of service", {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		}
	};

	return (
		<SummaryCard.Row>
			<SummaryCard.Content>
				<SummaryCard.Title>Terms of service</SummaryCard.Title>
				<SummaryCard.Description>The terms that govern your use of Kilo.</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Button
					size="sm"
					variant="outline"
					data-qa-id="about-view-terms"
					disabled={!os}
					onClick={() => void open()}
				>
					View
					<ExternalLinkIcon aria-hidden="true" />
				</Button>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

function ChromiumNoticesRow({ legal }: { readonly legal: LegalDomain }) {
	const os = useDomainObject(KernelOs);
	const [path, setPath] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		let active = true;
		legal.methods
			.locate({ document: "chromium-notices" })
			.then((located) => active && setPath(located))
			.catch(() => active && setPath(null));
		return () => {
			active = false;
		};
	}, [legal]);

	const reveal = async (file: string) => {
		try {
			await os?.methods.showItemInFolder({ path: file });
		} catch (error) {
			toast.error("Could not show Chromium's notices", {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		}
	};

	return (
		<SummaryCard.Row>
			<SummaryCard.Content>
				<SummaryCard.Title>Chromium</SummaryCard.Title>
				<SummaryCard.Description>
					Notices for Chromium, which Kilo Desktop is built on.
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Button
					size="sm"
					variant="outline"
					data-qa-id="about-show-chromium-notices"
					disabled={!path || !os}
					onClick={() => path && void reveal(path)}
				>
					{revealInFileManagerLabel()}
				</Button>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

function LegalDocumentDialog({
	legal,
	document,
	onClose,
}: {
	readonly legal: LegalDomain;
	readonly document: ReadableDocument | null;
	readonly onClose: () => void;
}) {
	return (
		<Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl"
				data-qa-id="legal-document"
			>
				{document ? (
					<>
						<DialogHeader className="pr-6">
							<DialogTitle>{DOCUMENTS[document].title}</DialogTitle>
							<DialogDescription>{DOCUMENTS[document].description}</DialogDescription>
						</DialogHeader>
						<LegalDocumentText legal={legal} document={document} />
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Mounted per open document, so a reopened dialog never shows the previous text. */
function LegalDocumentText({
	legal,
	document,
}: {
	readonly legal: LegalDomain;
	readonly document: ReadableDocument;
}) {
	const [text, setText] = useState<string | null | undefined>(undefined);
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		legal.methods
			.read({ document })
			.then((read) => active && setText(read))
			.catch((error: unknown) => {
				if (!active) return;
				setFailure(error instanceof Error ? error.message : "An unexpected error occurred.");
			});
		return () => {
			active = false;
		};
	}, [legal, document]);

	if (failure !== null) {
		return <p className="text-destructive text-sm">Could not read this document: {failure}</p>;
	}
	if (text === undefined) return <SkeletonText className="w-72" />;
	if (text === null) {
		return (
			<p className="text-muted-foreground text-sm">
				This document is written when the app is packaged, and is included in packaged builds.
			</p>
		);
	}
	return (
		<pre
			data-qa-id="legal-document-text"
			className="scroll-fade-y bg-muted/40 -mx-4 min-h-0 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
		>
			{text}
		</pre>
	);
}
