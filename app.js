const state = { view: "overview", channel: "all", period: 30, data: null, loading: false, requestId: 0 };
// La vue fiabilité décrit le dernier run complet : les filtres canal et période ne s'y appliquent pas.
const globalViews = new Set(["reliability"]);
const channelLabels = { web: "E-commerce", store: "Magasins", marketplace: "Marketplace", catalog: "Catalogue" };
const riskLabels = { critical: "Sous le seuil", watch: "À surveiller", healthy: "Normal" };
const root = document.querySelector("#view-root");
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroCents = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-FR");
const UNAVAILABLE = "indisponible";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const dateShort = value => new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
const isNumber = value => typeof value === "number" && Number.isFinite(value);
const count = (value, unit) => isNumber(value) ? `${integer.format(value)} ${unit}` : UNAVAILABLE;
const channelLabel = value => channelLabels[value] || value;

function statusInfo(status) {
  return {
    PASS: { label: "Réussi", tone: "pass" },
    PUBLISHED: { label: "Publié", tone: "pass" },
    FAIL: { label: "Échec", tone: "critical" },
    READY: { label: "Non exécuté", tone: "ready" },
    NOT_RUN: { label: "Non exécuté", tone: "ready" },
  }[status] || { label: status ? String(status) : UNAVAILABLE, tone: "ready" };
}
const statusBadge = status => { const info = statusInfo(status); return `<span class="badge ${info.tone}">${escapeHtml(info.label)}</span>`; };

function activeScopeLabel() {
  const channel = document.querySelector("#channel-filter");
  const label = channel?.selectedOptions?.[0]?.textContent || "Tous les canaux";
  return `${label}, ${state.period} jours`;
}

function updateScopeUi() {
  const global = globalViews.has(state.view);
  document.querySelectorAll(".select-wrap").forEach(control => { control.hidden = global; });
  document.querySelector("#scope-mode").hidden = !global;
  document.querySelector("#scope-status").textContent = global ? "Dernier run complet, sans filtre" : activeScopeLabel();
  document.querySelector("#refresh-data").setAttribute(
    "aria-label",
    global ? "Actualiser le dernier run complet" : `Actualiser les données, ${activeScopeLabel()}`,
  );
}

// Statut tiré des rapports : contrôles qualité, rapprochements et run plateforme (Airflow, dbt, LocalStack).
function runStatus(d) {
  if (d.quality?.status !== "PASS" || d.reconciliation?.status !== "PASS") {
    return { tone: "error", text: "Publication bloquée : un contrôle ou un rapprochement échoue" };
  }
  if (d.platform_evidence?.status === "PASS") {
    return { tone: "ok", text: "Run complet réussi, publication autorisée" };
  }
  return { tone: "warn", text: "Contrôles Python réussis, run Airflow, dbt et LocalStack non exécuté" };
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function viewHead(title, copy, actions = "") {
  return `<div class="view-head"><div><h2>${title}</h2><p>${copy}</p></div>${actions}</div>`;
}

function kpi(label, value, detail, note = "", tone = "") {
  const noteHtml = note ? `<span${tone ? ` class="${tone}"` : ""}>${note}</span>` : "";
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-detail">${[noteHtml, detail].filter(Boolean).join(" · ")}</div></div>`;
}

function panel(title, subtitle, content, span = 6, meta = "") {
  return `<section class="panel span-${span}"><header class="panel-header"><div class="panel-title"><h3>${title}</h3><p>${subtitle}</p></div>${meta ? `<div class="panel-meta">${meta}</div>` : ""}</header><div class="panel-body">${content}</div></section>`;
}

function lineChart(series) {
  if (!series.length) return `<div class="error-state"><strong>Aucune vente sur cette sélection</strong>Essayez une autre période ou un autre canal.</div>`;
  const values = series.map(item => item.revenue);
  const maxValue = Math.max(...values, 1);
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 50 : index * (100 / (values.length - 1)),
    y: 100 - (value / maxValue) * 100,
  }));
  const step = Math.max(1, Math.floor(series.length / 6));
  const labels = series.filter((_, index) => index % step === 0 || index === series.length - 1).slice(-7);
  const buttons = points.map((p, i) => `<button type="button" class="point" style="left:${p.x}%;top:${p.y}%" data-index="${i}" aria-label="${dateShort(series[i].day)} : ${euro.format(series[i].revenue)}, ${series[i].orders} commandes"></button>`).join("");
  return `<div class="line-chart" role="group" aria-label="Chiffre d’affaires quotidien"><div class="chart-grid"><i></i><i></i></div><div class="chart-scale"><span>${compact.format(maxValue)}</span><span>${compact.format(maxValue / 2)}</span><span>0</span></div><div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline class="line" points="${points.map(p => `${p.x},${p.y}`).join(" ")}"/></svg>${buttons}<div class="chart-tooltip" id="chart-tooltip"></div></div><div class="chart-labels">${labels.map(item => `<span>${dateShort(item.day)}</span>`).join("")}</div></div>`;
}

function bindChartTooltips() {
  const tooltip = document.querySelector("#chart-tooltip");
  if (!tooltip) return;
  document.querySelectorAll(".point").forEach(point => {
    const show = () => {
      const item = state.data.series[Number(point.dataset.index)];
      tooltip.innerHTML = `<strong>${euro.format(item.revenue)}</strong>, ${item.orders} commandes, ${dateShort(item.day)}`;
      tooltip.style.left = point.style.left;
      tooltip.style.top = point.style.top;
      tooltip.style.opacity = 1;
    };
    const hide = () => { tooltip.style.opacity = 0; };
    point.addEventListener("mouseenter", show);
    point.addEventListener("focus", show);
    point.addEventListener("mouseleave", hide);
    point.addEventListener("blur", hide);
  });
}

// Une seule série par graphique : la longueur porte l'information, pas la couleur.
function shareBars(rows, emptyMessage) {
  if (!rows.length) return `<div class="error-state"><strong>Aucune donnée</strong>${emptyMessage}</div>`;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return `<div class="error-state"><strong>Aucune donnée</strong>${emptyMessage}</div>`;
  return `<div class="bar-list">${rows.map(row => `<div class="bar-row"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}<small>${row.detail}</small></span><div class="meter"><i style="width:${row.value / total * 100}%"></i></div><b>${Math.round(row.value / total * 100)} %</b></div>`).join("")}</div>`;
}

function categoryBars(items) {
  if (!items.length) return `<div class="error-state"><strong>Aucune catégorie</strong>La sélection ne contient aucune vente.</div>`;
  const max = Math.max(...items.map(item => item.revenue), 1);
  return `<div class="bar-list">${items.map(item => `<div class="bar-row"><span title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span><div class="meter"><i style="width:${item.revenue / max * 100}%"></i></div><b>${euro.format(item.revenue)}</b></div>`).join("")}</div>`;
}

function reconciliation(r) {
  const unitDelta = Number(r.unit_delta ?? r.delta);
  const amountDelta = Number(r.amount_delta);
  const rows = [
    ["Unités", `Batch : ${integer.format(r.batch_units)}`, `Kinesis : ${integer.format(r.stream_units)}`, Number.isFinite(unitDelta) ? integer.format(unitDelta) : UNAVAILABLE],
    ["Montants", `Ventes : ${euroCents.format(r.sales_amount || 0)}`, `Paiements soldés : ${euroCents.format(r.payment_amount || 0)}`, Number.isFinite(amountDelta) ? euroCents.format(amountDelta) : UNAVAILABLE],
  ];
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Rapprochement</th><th>Référence</th><th>Comparé à</th><th class="r">Écart</th></tr></thead><tbody>${rows.map(([label, a, b, gap]) => `<tr><td>${label}</td><td class="num">${a}</td><td class="num">${b}</td><td class="r">${gap}</td></tr>`).join("")}</tbody></table></div><div class="recon-foot"><span>Seuil : 0 unité et moins d’un centime d’écart.</span>${statusBadge(r.status)}</div>`;
}

function renderOverview() {
  const d = state.data, k = d.kpis;
  const mix = d.channel_mix.map(item => ({ label: channelLabel(item.channel), value: Number(item.revenue), detail: `${integer.format(item.orders)} commandes` }));
  const quality = statusInfo(d.quality.status);
  root.innerHTML = viewHead(`Ventes par canal, ${d.meta.period} jours`, "Chiffre d’affaires, commandes et stock disponible sur le périmètre sélectionné. La qualité porte sur le run complet.", `<button type="button" class="subtle-button" data-view-jump="reliability">Voir les contrôles</button>`)
    + `<div class="kpi-row">${kpi("Chiffre d’affaires", euro.format(k.revenue || 0), `${integer.format(k.customers || 0)} clients actifs`)}${kpi("Commandes", integer.format(k.orders || 0), `${integer.format(k.units || 0)} articles, panier moyen ${euro.format(k.avg_basket || 0)}`)}${kpi("Stock disponible (ATP)", integer.format(k.total_atp || 0), `hors filtres de vente, ${integer.format(d.inventory.length)} références`)}${kpi("Qualité des données", isNumber(k.quality_score) ? `${integer.format(k.quality_score)} %` : UNAVAILABLE, "run complet, hors filtres", d.quality.status === "PASS" ? "Publication autorisée" : "Publication bloquée", quality.tone === "pass" ? "ok" : "error")}</div>`
    + `<div class="dashboard-grid">${panel("Chiffre d’affaires quotidien", activeScopeLabel(), lineChart(d.series), 8)}${panel("Répartition par canal", "Part du chiffre d’affaires", shareBars(mix, "La sélection ne contient aucune vente."), 4)}${panel("Catégories", "Sept premières catégories par chiffre d’affaires", categoryBars(d.categories), 5)}${panel("Rapprochements", `Batch et Kinesis, ventes et paiements, ${activeScopeLabel()}`, reconciliation(d.reconciliation), 7)}</div>`;
  bindChartTooltips();
  bindInlineActions();
}

function inventoryTable(items) {
  const maxAtp = Math.max(...items.map(item => item.atp), 1);
  return `<div class="data-table-wrap"><table class="data-table wide"><thead><tr><th>Produit</th><th>Catégorie</th><th class="r">Ventes sélection</th><th class="r">Magasins</th><th class="r">Entrepôt</th><th class="r">Réservé</th><th class="r">Entrant</th><th>ATP / seuil</th><th>Risque</th></tr></thead><tbody id="inventory-body">${items.map(item => `<tr data-search="${escapeHtml(`${item.name} ${item.category} ${item.product_id} ${riskLabels[item.risk_level] || item.risk_level}`.toLowerCase())}"><td>${escapeHtml(item.name)}<span class="id">${escapeHtml(item.product_id)}</span></td><td>${escapeHtml(item.category)}</td><td class="r">${integer.format(item.selected_units_sold || 0)}</td><td class="r">${integer.format(item.store_stock)}</td><td class="r">${integer.format(item.warehouse_stock)}</td><td class="r">${integer.format(item.reserved)}</td><td class="r">${integer.format(item.incoming)}</td><td class="atp-cell num"><strong>${integer.format(item.atp)}</strong> / ${integer.format(item.safety_stock)}<div class="table-meter"><i class="${item.risk_level}" style="width:${Math.max(0, item.atp) / maxAtp * 100}%"></i></div></td><td><span class="badge ${item.risk_level}">${riskLabels[item.risk_level] || escapeHtml(item.risk_level)}</span></td></tr>`).join("")}</tbody></table></div>`;
}

function renderInventory() {
  const d = state.data, items = d.inventory;
  const watch = items.filter(item => item.risk_level === "watch").length;
  const critical = items.filter(item => item.risk_level === "critical").length;
  const totalAtp = items.reduce((sum, item) => sum + item.atp, 0);
  const selectedUnits = items.reduce((sum, item) => sum + Number(item.selected_units_sold || 0), 0);
  const dailyDemand = selectedUnits / d.meta.period;
  const coverageDays = dailyDemand > 0 ? Math.round(totalAtp / dailyDemand) : null;
  const toolbar = `<label class="search-box"><input id="inventory-search" type="search" placeholder="Rechercher un produit" aria-label="Rechercher un produit" /></label>`;
  root.innerHTML = viewHead("Stock disponible (ATP) et risque de rupture", "Le stock est un instantané du réseau. Le canal et la période ne filtrent que la demande observée, qui sert à estimer la couverture.", `<button type="button" class="subtle-button" id="export-inventory">Exporter le CSV</button>`)
    + `<div class="kpi-row">${kpi("ATP réseau", integer.format(totalAtp), "stock courant, hors filtres de vente")}${kpi("Demande sélectionnée", integer.format(selectedUnits), `unités vendues, ${activeScopeLabel()}`)}${kpi("Couverture estimée", coverageDays === null ? UNAVAILABLE : `${integer.format(coverageDays)} jours`, "au rythme de la sélection")}${kpi("Sous le seuil de sécurité", integer.format(critical), `${integer.format(watch)} à surveiller`, critical ? "Réassort à prévoir" : "Aucune référence", critical ? "error" : "ok")}</div>`
    + `<div class="dashboard-grid">${panel("Disponibilité par produit", `ATP = magasins + entrepôt + entrant − réservé − vendu. Demande : ${activeScopeLabel()}`, inventoryTable(items), 12, toolbar)}</div>`;
  bindTableSearch("#inventory-search", "#inventory-body");
  document.querySelector("#export-inventory").addEventListener("click", exportInventory);
}

function customerTable(customers) {
  return `<div class="data-table-wrap"><table class="data-table wide"><thead><tr><th>Golden record</th><th>Pays</th><th>Acquisition</th><th>Canaux rapprochés</th><th class="r">Commandes</th><th class="r">Valeur client</th><th>Segment RFM</th><th>Opt-in marketing</th></tr></thead><tbody id="customer-body">${customers.map(item => `<tr data-search="${escapeHtml(`${item.customer_id} ${item.segment} ${item.country} ${item.channels}`.toLowerCase())}"><td class="mono">${escapeHtml(item.customer_id)}</td><td>${escapeHtml(item.country)}</td><td>${escapeHtml(channelLabel(item.acquisition_channel))}</td><td>${escapeHtml(String(item.channels).split(",").map(channelLabel).join(", "))}</td><td class="r">${integer.format(item.order_count)}</td><td class="r">${euro.format(item.spend)}</td><td>${escapeHtml(item.segment)}</td><td>${item.consent_marketing ? "Oui" : "Non"}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderCustomers() {
  const d = state.data, customers = d.customers;
  const segments = ["Champions", "Fidèles", "Prometteurs", "Nouveaux"].map(label => {
    const value = customers.filter(item => item.segment === label).length;
    return { label, value, detail: `${integer.format(value)} profils` };
  });
  const omnichannel = customers.filter(item => String(item.channels).includes(",")).length;
  const privacyPassed = d.quality.privacy_ok;
  const toolbar = `<label class="search-box"><input id="customer-search" type="search" placeholder="Identifiant, pays ou segment" aria-label="Rechercher un client" /></label>`;
  root.innerHTML = viewHead("Identités client rapprochées", "Les identités CRM, web et caisse sont rapprochées en Golden Records. Le modèle analytique ne garde qu’un hash de l’email et des identifiants métier.")
    + `<div class="kpi-row">${kpi("Clients actifs", integer.format(d.kpis.customers), activeScopeLabel())}${kpi("Profils affichés", integer.format(customers.length), "classés par valeur client")}${kpi("Profils omnicanaux", integer.format(omnichannel), "plusieurs canaux, parmi les profils affichés")}${kpi("Emails", privacyPassed ? "Hachés" : "Non conformes", "contrôle privacy.email_hash_shape", privacyPassed ? "Contrôle réussi" : "Publication bloquée", privacyPassed ? "ok" : "error")}</div>`
    + `<div class="dashboard-grid">${panel("Segmentation RFM", "Profils affichés par segment", `<div class="narrow">${shareBars(segments, "Aucun profil sur cette sélection.")}</div>`, 12)}${panel("Golden Records", `${integer.format(customers.length)} premiers sur ${integer.format(d.kpis.customers)} clients actifs`, customerTable(customers), 12, toolbar)}</div>`;
  bindTableSearch("#customer-search", "#customer-body");
}

function pipelineMetric(node, d) {
  const platform = d.platform_evidence, q = d.quality;
  if (node.status === "ready") return "non exécuté";
  return {
    "Sources": count(platform.sources?.records, "lignes"),
    "Amazon S3": count(platform.aws?.s3_objects, "objets"),
    "Kinesis": count(platform.aws?.kinesis_events, "événements"),
    "dbt + DuckDB": isNumber(platform.dbt?.models) ? `${platform.dbt.models} modèles, ${platform.dbt.tests} tests` : UNAVAILABLE,
    "Qualité": `${q.passed}/${q.total} contrôles`,
    "Publication": statusInfo(platform.publishing?.status).label.toLowerCase(),
  }[node.name] ?? String(node.metric).toLowerCase();
}

const stepStatus = {
  executed: `<span class="badge pass">Exécuté</span>`,
  emulated: `<span class="badge emulated">Émulé (LocalStack)</span>`,
  ready: `<span class="badge ready">Non exécuté</span>`,
};

function renderReliability() {
  const d = state.data;
  const q = d.quality;
  const platform = d.platform_evidence;
  const gate = platform.publishing || {};
  const unitGap = gate.unit_delta ?? d.reconciliation.unit_delta;
  const amountGap = gate.payment_delta ?? d.reconciliation.amount_delta;
  const gapKnown = isNumber(unitGap) && isNumber(amountGap);
  const gapText = gapKnown ? `${integer.format(unitGap)} unité · ${euroCents.format(amountGap)}` : UNAVAILABLE;
  const gapOk = gapKnown && unitGap === 0 && Math.abs(amountGap) <= 0.005;
  const publishable = q.status === "PASS" && d.reconciliation.status === "PASS";
  const dbt = platform.dbt || {};
  const dbtKnown = isNumber(dbt.models);
  const awsRan = platform.aws?.status === "PASS";

  const steps = `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Étape</th><th>Rôle</th><th>Mesure</th><th>Statut</th></tr></thead><tbody>${d.pipeline.map(node => `<tr><td>${escapeHtml(node.name)}</td><td>${escapeHtml(node.role)}</td><td class="num">${escapeHtml(pipelineMetric(node, d))}</td><td>${stepStatus[node.status] || statusBadge(node.status)}</td></tr>`).join("")}</tbody></table></div>`;
  const proofs = [
    ["Sources contrôlées", `${count(platform.sources?.count, "fichiers")}, ${count(platform.sources?.records, "lignes")}`],
    ["AWS local", awsRan ? `${count(platform.aws.s3_objects, "objets S3")}, ${count(platform.aws.kinesis_events, "événements Kinesis")}` : "non exécuté"],
    ["Handler Lambda", awsRan ? `${count(platform.aws.lambda_events, "événements validés")} dans le processus local` : "non exécuté"],
    ["dbt et DuckDB", dbtKnown ? `${dbt.models} modèles, ${dbt.tests} tests, ${dbt.snapshots} snapshot` : `rapport dbt ${UNAVAILABLE}`],
    ["Contrôles qualité", `${q.passed}/${q.total} réussis`],
    ["Écart avant publication", gapText],
  ];
  const proofList = `<dl class="proof-list">${proofs.map(([title, detail]) => `<dt>${escapeHtml(title)}</dt><dd>${escapeHtml(detail)}</dd>`).join("")}</dl>`;
  const gateHtml = `<div class="gate"><div class="gate-value">${isNumber(q.score) ? `${integer.format(q.score)} %` : UNAVAILABLE}</div><div class="gate-label ${publishable ? "ok" : "error"}">${publishable ? "Publication autorisée" : "Publication bloquée"}</div><p>${publishable ? `Score qualité du run. Les ${q.total} contrôles et les deux rapprochements sont conformes.` : "Un contrôle ou un rapprochement échoue : les indicateurs ne sont pas publiés."}</p></div>`;

  root.innerHTML = viewHead("Pipeline et contrôles avant publication", "Airflow enchaîne six tâches. La publication n’a lieu que si les contrôles qualité et les rapprochements passent.")
    + `<div class="kpi-row">${kpi("Airflow", count(platform.airflow?.tasks, "tâches"), escapeHtml(platform.airflow?.schedule || ""), statusInfo(platform.airflow?.status).label, platform.airflow?.status === "PASS" ? "ok" : "warn")}${kpi("dbt build", dbtKnown ? `${dbt.models} modèles` : UNAVAILABLE, dbtKnown ? `${dbt.tests} tests, ${dbt.snapshots} snapshot` : "rapport absent", statusInfo(dbt.status).label, dbt.status === "PASS" ? "ok" : "warn")}${kpi("Contrôles qualité", `${q.passed}/${q.total}`, "contrats techniques et métier", statusInfo(q.status).label, q.status === "PASS" ? "ok" : "error")}${kpi("Réconciliation", gapText, "unités et paiements", gapKnown ? (gapOk ? "Aucun écart" : "Écart détecté") : "", gapOk ? "ok" : "error")}</div>`
    + `<div class="dashboard-grid">${panel("Étapes du dernier run", "S3 et Kinesis passent par les API émulées de LocalStack", steps, 12, `<div class="evidence-legend">${stepStatus.executed}${stepStatus.emulated}</div>`)}${panel("Chiffres des rapports d’exécution", "Lus dans reports/*.json", proofList, 7)}${panel("Décision de publication", "Qualité et rapprochements", gateHtml, 5)}</div>`;
}

function exportInventory() {
  const headers = ["product_id", "name", "category", "store_stock", "warehouse_stock", "reserved", "incoming", "units_sold", "selected_units_sold", "safety_stock", "atp", "risk_level"];
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.join(";"), ...state.data.inventory.map(item => headers.map(key => quote(item[key])).join(";"))].join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `retail-core-inventory-${state.channel}-${state.period}d.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Stock exporté, ${activeScopeLabel()}`);
}

function bindTableSearch(inputSelector, bodySelector) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll(`${bodySelector} tr`).forEach(row => { row.hidden = !row.dataset.search.includes(query); });
  });
}

function bindInlineActions() {
  document.querySelectorAll("[data-view-jump]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.viewJump)));
}

function render() {
  if (!state.data) return;
  ({ overview: renderOverview, inventory: renderInventory, customers: renderCustomers, reliability: renderReliability }[state.view])();
}

async function loadData(showFeedback = false) {
  const requestId = ++state.requestId;
  state.loading = true;
  document.querySelector("#refresh-data").disabled = true;
  if (!state.data) root.innerHTML = `<p class="loading-state">Chargement des données…</p>`;
  try {
    let data = window.RETAIL_CORE_STATIC?.dashboards?.[`${state.channel}-${state.period}`];
    let mode = "démo statique";
    if (!data) {
      const response = await fetch(`/api/dashboard?channel=${state.channel}&period=${state.period}`, { cache: "no-store" });
      if (!response.ok) throw new Error("API indisponible");
      data = await response.json();
      mode = "démo locale";
    }
    if (requestId !== state.requestId) return;
    state.data = data;
    document.querySelector("#run-mode").textContent = mode;
    document.title = `Retail Core, ${mode}`;
    const status = runStatus(data);
    const statusNode = document.querySelector("#run-status");
    statusNode.textContent = status.text;
    statusNode.className = `run-status ${status.tone}`;
    document.querySelector("#last-run").textContent = new Date(data.meta.generated_at).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    document.querySelector("#contract-version").textContent = data.meta.data_contract;
    document.querySelector("#latency-sla").textContent = isNumber(data.kpis.latency_p95_ms)
      ? `Latence p95 : ${integer.format(data.kpis.latency_p95_ms)} ms, cible < 3 s`
      : `Latence p95 ${UNAVAILABLE}`;
    updateScopeUi();
    render();
    if (showFeedback) showToast(globalViews.has(state.view) ? "Dernier run complet relu" : `Périmètre appliqué : ${activeScopeLabel()}`);
  } catch (error) {
    if (requestId !== state.requestId) return;
    const statusNode = document.querySelector("#run-status");
    statusNode.textContent = "Données indisponibles";
    statusNode.className = "run-status error";
    root.innerHTML = `<div class="error-state"><strong>Le tableau de bord n’arrive pas à joindre le pipeline.</strong>Lancez <code>python3 run_demo.py</code>, puis <code>python3 serve.py</code>.</div>`;
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      document.querySelector("#refresh-data").disabled = false;
    }
  }
}

function switchView(view) {
  if (!viewNames.includes(view)) return;
  state.view = view;
  history.replaceState(null, "", view === "overview" ? location.pathname + location.search : `#${view}`);
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.querySelectorAll(".nav-item").forEach(item => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
  });
  updateScopeUi();
  render();
}

document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => switchView(item.dataset.view)));
document.querySelector("#channel-filter").addEventListener("change", event => { state.channel = event.target.value; loadData(true); });
document.querySelector("#period-filter").addEventListener("change", event => { state.period = Number(event.target.value); loadData(true); });
document.querySelector("#refresh-data").addEventListener("click", () => loadData(true));
const viewNames = [...document.querySelectorAll(".nav-item")].map(item => item.dataset.view);
switchView(location.hash.slice(1) || "overview");
loadData();
