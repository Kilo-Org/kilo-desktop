import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { WizardStepIndicator, type WizardStep } from "../onboarding/WizardStepIndicator.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import {
	EMBEDDED_CUSTOM_PROVIDER_CONTENT_CLASS_NAME,
	CustomProviderForm,
	type CustomProviderSubmitInput,
} from "./CustomProviderDialog.js";
import { ProviderConnectForm } from "./ProviderConnectDialog.js";
import type { ProviderRow } from "./provider-list.js";

type AddProviderStep = "choose" | "configure";
type ProviderChoice = { type: "catalog"; provider: ProviderRow } | { type: "custom" };

const STEPS: readonly WizardStep<AddProviderStep>[] = [
	{ id: "choose", label: "Choose provider" },
	{ id: "configure", label: "Configure" },
];

export function AddProviderDialog({
	open,
	providers,
	blockedIds,
	pending,
	connectError,
	saveError,
	onOpenChange,
	onResetConnect,
	onResetSave,
	onConnect,
	onSaveCustom,
}: {
	open: boolean;
	providers: readonly ProviderRow[];
	blockedIds: readonly string[];
	pending: boolean;
	connectError: string | null;
	saveError: string | null;
	onOpenChange: (open: boolean) => void;
	onResetConnect: () => void;
	onResetSave: () => void;
	onConnect: (provider: ProviderRow, apiKey: string) => Promise<void>;
	onSaveCustom: (input: CustomProviderSubmitInput) => Promise<void>;
}) {
	const [choice, setChoice] = useState<ProviderChoice | null>(null);
	const skipChooseStep = providers.length === 0;
	const step: AddProviderStep = choice ? "configure" : "choose";

	const changeOpen = (next: boolean) => {
		if (!next && pending) return;
		if (!next) setChoice(null);
		onOpenChange(next);
	};

	const back = () => {
		onResetConnect();
		onResetSave();
		setChoice(null);
	};

	const stepIndicator = skipChooseStep ? undefined : (
		<WizardStepIndicator
			steps={STEPS}
			currentStep={step}
			busy={pending}
			qaPrefix="kilo-providers-add"
			canSelect={(candidate) => candidate === "choose" || choice !== null}
			onSelect={(candidate) => {
				if (candidate === "choose") back();
			}}
		/>
	);

	const custom = choice?.type === "custom" || skipChooseStep;
	const dialogQaId = custom
		? "kilo-providers-custom-dialog"
		: choice?.type === "catalog"
			? "kilo-providers-connect-dialog"
			: "kilo-providers-add-dialog";

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent
				data-qa-id={dialogQaId}
				style={{ transition: "none" }}
				className={cn("sm:max-w-xl", custom && EMBEDDED_CUSTOM_PROVIDER_CONTENT_CLASS_NAME)}
			>
				{choice?.type === "catalog" ? (
					<ProviderConnectForm
						providerName={choice.provider.name}
						pending={pending}
						error={connectError}
						stepIndicator={stepIndicator}
						onBack={back}
						onSubmit={(apiKey) => onConnect(choice.provider, apiKey)}
					/>
				) : custom ? (
					<CustomProviderForm
						existing={null}
						blockedIds={blockedIds}
						pending={pending}
						error={saveError}
						stepIndicator={stepIndicator}
						{...(!skipChooseStep ? { onBack: back } : {})}
						onCancel={() => changeOpen(false)}
						onSubmit={onSaveCustom}
					/>
				) : (
					<>
						{stepIndicator}
						<DialogHeader>
							<DialogTitle>Add AI Provider</DialogTitle>
						</DialogHeader>

						<div className="flex flex-col gap-3">
							<p className="text-muted-foreground text-xs font-medium">Popular providers</p>
							<ItemGroup className="grid gap-2 sm:grid-cols-2">
								{providers.map((provider) => (
									<ProviderChoiceItem
										key={provider.id}
										provider={provider}
										disabled={pending}
										onSelect={() => {
											onResetConnect();
											setChoice({ type: "catalog", provider });
										}}
									/>
								))}
							</ItemGroup>
							<Separator />
							<Item
								render={<button type="button" disabled={pending} />}
								variant="outline"
								size="sm"
								className="bg-card hover:bg-foreground/5 min-w-0 flex-nowrap text-left"
								onClick={() => {
									onResetSave();
									setChoice({ type: "custom" });
								}}
								data-qa-id="kilo-providers-add-custom"
							>
								<ItemMedia className="border-border bg-background size-8 rounded-lg border">
									<PlusIcon className="size-4" />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>Custom AI Provider</ItemTitle>
								</ItemContent>
								<ItemActions>
									<ArrowRightIcon className="text-muted-foreground size-4" />
								</ItemActions>
							</Item>
						</div>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => changeOpen(false)}>
								Cancel
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ProviderChoiceItem({
	provider,
	disabled,
	onSelect,
}: {
	provider: ProviderRow;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<Item
			render={<button type="button" disabled={disabled} />}
			variant="outline"
			size="sm"
			className="bg-card hover:bg-foreground/5 min-w-0 flex-nowrap text-left"
			onClick={onSelect}
			data-qa-id={`kilo-providers-add-${provider.id}`}
		>
			<ItemMedia className="border-border bg-background size-8 rounded-lg border">
				<ProviderIcon
					provider={provider.id}
					variant="color"
					size={18}
					fallbackLabel={provider.name}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{provider.name}</ItemTitle>
			</ItemContent>
			<ItemActions>
				<ArrowRightIcon className="text-muted-foreground size-4" />
			</ItemActions>
		</Item>
	);
}
