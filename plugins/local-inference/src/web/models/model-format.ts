const parameterCountFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const fileSizeFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatParameterCount(parameters: number): string {
	if (parameters >= 1_000_000_000) {
		return `${parameterCountFormatter.format(parameters / 1_000_000_000)}B`;
	}
	if (parameters >= 1_000_000) {
		return `${parameterCountFormatter.format(parameters / 1_000_000)}M`;
	}
	return parameterCountFormatter.format(parameters);
}

export function formatFileSize(bytes: number): string {
	return `${fileSizeFormatter.format(bytes / 1024 ** 3)} GB`;
}

/** Catalog downloads are registered as "Name (quant)"; the quant is shown separately. */
export function modelDisplayName(model: { name: string; catalog?: unknown }): string {
	if (!model.catalog) return model.name;
	return model.name.replace(/\s*\([^()]*\)$/, "") || model.name;
}
