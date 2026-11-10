import { DialogDescription, DialogHeader, DialogTitle } from "@kilo-desktop/ui/components/dialog";

import { useCatalogAccess } from "./use-catalog-access";

export function ModelCatalogDialogHeader() {
	const { title } = useCatalogAccess();
	return (
		<DialogHeader className="px-4 pt-4 pr-3 pb-6 text-left">
			<DialogTitle>Local Model Catalog</DialogTitle>
			<DialogDescription className="text-sm leading-tight">
				{title === null
					? "Browse models and add them to your local model server."
					: `Browse models from ${title} and add them to your local model server.`}
			</DialogDescription>
		</DialogHeader>
	);
}
