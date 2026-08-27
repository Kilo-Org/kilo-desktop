import "./env-list.css";

export function renderError(message: string): void {
	const container = document.getElementById("app");
	if (!container) return;
	container.innerHTML = "";
	const errorBox = document.createElement("div");
	errorBox.className = "error-state";
	errorBox.textContent = message;
	container.appendChild(errorBox);
}

export function renderEnvList(envs: Array<{ name: string; prefix: string }>): void {
	const container = document.getElementById("app");
	if (!container) return;

	container.innerHTML = "";

	if (envs.length === 0) {
		container.innerHTML = `
      <div class="empty-state">
        No conda environments found
      </div>
    `;
		return;
	}

	const wrapper = document.createElement("div");
	wrapper.className = "env-list";

	// Header
	const header = document.createElement("div");
	header.className = "env-header";
	header.innerHTML = `
    <span class="env-title">Conda Environments</span>
    <span class="env-count">${envs.length} found</span>
  `;
	wrapper.appendChild(header);

	// Cards
	const cardList = document.createElement("div");
	cardList.className = "env-cards";

	for (const env of envs) {
		const card = document.createElement("div");
		card.className = "env-card";

		const name = document.createElement("div");
		name.className = "env-name";
		name.textContent = env.name || "base";

		const prefix = document.createElement("div");
		prefix.className = "env-prefix";
		// Guard against malformed entries — the tool JSON isn't runtime-validated.
		prefix.textContent = typeof env.prefix === "string" ? env.prefix : "";
		prefix.title = prefix.textContent;

		card.appendChild(name);
		card.appendChild(prefix);
		cardList.appendChild(card);
	}

	wrapper.appendChild(cardList);
	container.appendChild(wrapper);
}
