const state = { view: "overview", channel: "all", period: 30, data: null, loading: false, requestId: 0 };
const viewTitles = {
  overview: "Vue d’ensemble",
  inventory: "Stock & ATP",
  customers: "Customer 360",
  reliability: "Fiabilité data",
};
const globalViewScopes = {
  reliability: { pill: "RUN COMPLET", status: "Run complet · périmètre global" },
};
const colors = ["#ff7657", "#57d3e8", "#9f8cff", "#b8f36b", "#ffb85c", "#f573ae", "#6e91ff"];
const root = document.querySelector("#view-root");
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-FR");

const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const dateShort = value => new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

function activeScopeLabel() {
  const channel = document.querySelector("#channel-filter");
  const channelLabel = channel?.selectedOptions?.[0]?.textContent || "Tous les canaux";
  return `${channelLabel} · ${state.period} jours`;
}

function updateScopeUi() {
  const globalScope = globalViewScopes[state.view];
  const scopeMode = document.querySelector("#scope-mode");
  const scopeStatus = document.querySelector("#scope-status");
  const contextualStatus = {
    inventory: `Demande filtrée · ${activeScopeLabel()}`,
    customers: `Clients filtrés · ${activeScopeLabel()}`,
  };

  document.querySelectorAll(".select-wrap").forEach(control => {
    control.hidden = Boolean(globalScope);
  });
  scopeMode.hidden = !globalScope;
  document.querySelector("#scope-mode-text").textContent = globalScope?.pill || "Périmètre global";
  scopeStatus.querySelector("b").textContent = globalScope?.status
    || contextualStatus[state.view]
    || `Périmètre actif · ${activeScopeLabel()}`;
  scopeStatus.classList.toggle("global", Boolean(globalScope));
  document.querySelector("#refresh-data").setAttribute(
    "aria-label",
    globalScope ? `Actualiser · ${globalScope.pill.toLowerCase()}` : `Actualiser les données · ${activeScopeLabel()}`,
  );
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function hero(kicker, title, copy, actions = "") {
  return `<div class="hero-row"><div><div class="section-kicker">${kicker}</div><h2>${title}</h2><p>${copy}</p></div><div class="hero-actions">${actions}</div></div>`;
}

function kpi(label, value, foot, accent = "var(--coral)", glyph = "grid", trend = "") {
  return `<article class="kpi-card" style="--accent:${accent}"><div class="kpi-top"><span>${label}</span><div class="kpi-icon">${icon(glyph)}</div></div><div class="kpi-value">${value}</div><div class="kpi-foot"><span${trend ? ` style="color:${accent}"` : ""}>${trend || foot}</span>${trend ? `<span>${foot}</span>` : ""}</div></article>`;
}

function panel(title, subtitle, content, span = 6, meta = "") {
  return `<article class="panel span-${span}"><header class="panel-header"><div class="panel-title"><h3>${title}</h3><p>${subtitle}</p></div><div class="panel-meta">${meta}</div></header><div class="panel-body">${content}</div></article>`;
}

function lineChart(series) {
  if (!series.length) return `<div class="error-state"><strong>Aucune vente</strong>Essayez une période ou un canal différent.</div>`;
  const values = series.map(item => item.revenue);
  const maxValue = Math.max(...values, 1);
  const max = maxValue * 1.08;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 50 : index * (100 / (values.length - 1));
    const y = 95 - (value / max) * 82;
    return { x, y, value, day: series[index].day, orders: series[index].orders };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const area = `0,100 ${polyline} 100,100`;
  const step = Math.max(1, Math.floor(series.length / 6));
  const labels = series.filter((_, index) => index % step === 0 || index === series.length - 1).slice(-7);
  return `<div class="line-chart" role="group" aria-label="Évolution quotidienne du chiffre d’affaires"><div class="chart-grid"><i></i><i></i><i></i><i></i></div><div class="chart-scale"><span>${compact.format(maxValue)}</span><span>${compact.format(maxValue / 2)}</span><span>0</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon class="area" points="${area}"/><polyline class="line" points="${polyline}"/>${points.map((p, i) => `<circle class="point" cx="${p.x}" cy="${p.y}" r="1.35" vector-effect="non-scaling-stroke" data-index="${i}" tabindex="0" role="button" aria-label="${dateShort(p.day)} : ${euro.format(p.value)}, ${p.orders} commandes"/>`).join("")}</svg><div class="chart-tooltip" id="chart-tooltip"></div><div class="chart-labels">${labels.map(item => `<span>${dateShort(item.day)}</span>`).join("")}</div></div>`;
}

function bindChartTooltips() {
  const tooltip = document.querySelector("#chart-tooltip");
  if (!tooltip) return;
  document.querySelectorAll(".point").forEach(point => {
    const show = event => {
      const item = state.data.series[Number(point.dataset.index)];
      const bounds = point.closest(".line-chart").getBoundingClientRect();
      const pointBounds = event.target.getBoundingClientRect();
      tooltip.innerHTML = `<strong>${euro.format(item.revenue)}</strong><br>${item.orders} commandes`;
      tooltip.style.left = `${pointBounds.left - bounds.left}px`;
      tooltip.style.top = `${pointBounds.top - bounds.top}px`;
      tooltip.style.opacity = 1;
    };
    point.addEventListener("mouseenter", show);
    point.addEventListener("focus", show);
    point.addEventListener("mouseleave", () => tooltip.style.opacity = 0);
    point.addEventListener("blur", () => tooltip.style.opacity = 0);
  });
}

function donut(mix, totalLabel = "CA TOTAL") {
  if (!mix.length) return `<div class="error-state"><strong>Aucune donnée</strong>La sélection ne contient aucun élément.</div>`;
  const total = mix.reduce((sum, item) => sum + Number(item.revenue || item.value), 0) || 1;
  let cursor = 0;
  const stops = mix.map((item, index) => {
    const start = cursor;
    cursor += Number(item.revenue || item.value) / total * 100;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(",");
  return `<div class="donut-layout"><div class="donut" style="background:conic-gradient(${stops})"><div class="donut-center"><strong>${compact.format(total)}</strong><span>${totalLabel}</span></div></div><div class="mix-list">${mix.map((item, index) => { const value = Number(item.revenue || item.value); return `<div class="mix-row"><i style="background:${colors[index % colors.length]}"></i><span>${escapeHtml(item.channel || item.label)}<small>${item.orders ? `${integer.format(item.orders)} commandes` : "segment client"}</small></span><b>${Math.round(value / total * 100)}%</b></div>`; }).join("")}</div></div>`;
}

function categoryBars(items) {
  if (!items.length) return `<div class="error-state"><strong>Aucune catégorie</strong>La sélection active ne contient aucune vente.</div>`;
  const max = Math.max(...items.map(item => item.revenue), 1);
  return `<div class="metric-list">${items.map(item => `<div class="metric-row"><span title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span><div class="meter"><i style="width:${item.revenue / max * 100}%"></i></div><b>${compact.format(item.revenue)}</b></div>`).join("")}</div>`;
}

function reconciliation(data) {
  const unitDelta = Number(data.unit_delta ?? data.delta ?? 0);
  const amountDelta = Number(data.amount_delta ?? 0);
  return `<div class="recon-stack"><div class="recon-card"><div class="recon-side"><span>UNITÉS BATCH</span><strong>${integer.format(data.batch_units)}</strong></div><div class="recon-equals">${icon("check")}</div><div class="recon-side"><span>UNITÉS KINESIS</span><strong>${integer.format(data.stream_units)}</strong></div></div><div class="recon-card payment"><div class="recon-side"><span>VENTES COMPTABLES</span><strong>${euro.format(data.sales_amount || 0)}</strong></div><div class="recon-equals">${icon("check")}</div><div class="recon-side"><span>PAIEMENTS SOLDÉS</span><strong>${euro.format(data.payment_amount || 0)}</strong></div></div></div><div class="recon-foot"><span>Écarts : <b>${integer.format(unitDelta)} unité</b> · <b>${amountDelta.toFixed(2)} €</b></span><span class="badge ${data.status === "PASS" ? "pass" : "critical"}">${icon(data.status === "PASS" ? "check" : "shield")} ${data.status}</span></div>`;
}

function renderOverview() {
  const d = state.data, k = d.kpis;
  root.innerHTML = hero("PERFORMANCE OMNICANALE", "Le retail en un seul regard", "Ventes, stock disponible et qualité des données sur le périmètre sélectionné.", `<button type="button" class="subtle-button" data-view-jump="reliability">Voir la fiabilité</button>`)
    + `<div class="kpi-grid">${kpi("Chiffre d’affaires", euro.format(k.revenue || 0), `${d.meta.period} derniers jours`, "var(--coral)", "stream", `${integer.format(k.customers || 0)} clients actifs`)}${kpi("Commandes", integer.format(k.orders || 0), `${integer.format(k.units || 0)} articles`, "var(--cyan)", "box", `Panier moyen ${euro.format(k.avg_basket || 0)}`)}${kpi("Stock disponible · ATP", integer.format(k.total_atp || 0), "hors filtres de vente", "var(--lime)", "box", `${integer.format(d.inventory.length)} références · snapshot courant`)}${kpi("Qualité des données", `${k.quality_score}%`, "run complet · hors filtres", "var(--violet)", "shield", d.quality.status === "PASS" ? "Publication autorisée" : "Publication bloquée")}</div>`
    + `<div class="dashboard-grid">${panel("Performance commerciale", "Chiffre d’affaires quotidien · filtre actif", lineChart(d.series), 8, `<div class="legend"><span><i></i>CA sélectionné</span></div>`)}${panel("Mix des canaux", "Contribution dans la même sélection", donut(d.channel_mix), 4)}${panel("Catégories motrices", "Top 7 catégories par chiffre d’affaires", categoryBars(d.categories), 5)}${panel("Double réconciliation", `Batch / Kinesis et ventes / paiements · ${d.meta.scope}`, reconciliation(d.reconciliation), 7, `<span class="badge ${d.reconciliation.status === "PASS" ? "pass" : "critical"}">${d.reconciliation.status === "PASS" ? "2 INVARIANTS EXACTS" : "ÉCART DÉTECTÉ"}</span>`)}</div>`;
  bindChartTooltips();
  bindInlineActions();
}


function inventoryTable(items) {
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Catégorie</th><th>Ventes sélection</th><th>Magasins</th><th>Entrepôt</th><th>Réservé</th><th>Entrant</th><th>ATP</th><th>Risque</th></tr></thead><tbody id="inventory-body">${items.map(item => `<tr data-search="${escapeHtml(`${item.name} ${item.category} ${item.risk_level}`.toLowerCase())}"><td><div class="product-cell"><span class="product-icon">${item.product_id.slice(-2)}</span><strong>${escapeHtml(item.name)}</strong></div></td><td>${escapeHtml(item.category)}</td><td><strong>${integer.format(item.selected_units_sold || 0)}</strong></td><td>${integer.format(item.store_stock)}</td><td>${integer.format(item.warehouse_stock)}</td><td>${integer.format(item.reserved)}</td><td>${integer.format(item.incoming)}</td><td class="atp-cell"><div class="atp-value"><strong>${integer.format(item.atp)}</strong><span>seuil ${item.safety_stock}</span></div><div class="table-meter"><i class="${item.risk_level}" style="width:${Math.min(100, item.atp / 1600 * 100)}%"></i></div></td><td><span class="badge ${item.risk_level}">${item.risk_level.toUpperCase()}</span></td></tr>`).join("")}</tbody></table></div>`;
}

function renderInventory() {
  const d = state.data, items = d.inventory;
  const watch = items.filter(item => item.risk_level === "watch").length;
  const critical = items.filter(item => item.risk_level === "critical").length;
  const totalAtp = items.reduce((sum, item) => sum + item.atp, 0);
  const selectedUnits = items.reduce((sum, item) => sum + Number(item.selected_units_sold || 0), 0);
  const dailyDemand = selectedUnits / d.meta.period;
  const coverageDays = dailyDemand > 0 ? Math.round(totalAtp / dailyDemand) : null;
  const toolbar = `<div class="table-tools"><label class="search-box">${icon("search")}<input id="inventory-search" type="search" placeholder="Rechercher un produit…" /></label></div>`;
  root.innerHTML = hero("SUPPLY CHAIN · AVAILABLE TO PROMISE", "Le bon stock, au bon moment", "Le stock physique reste un instantané réseau. Le canal et la période filtrent la demande observée et recalculent la couverture associée.", `<button type="button" class="subtle-button" id="export-inventory">Exporter le snapshot CSV</button>`)
    + `<div class="kpi-grid">${kpi("ATP réseau", integer.format(totalAtp), "indépendant des ventes filtrées", "var(--lime)", "box", "Snapshot stock courant")}${kpi("Demande sélectionnée", integer.format(selectedUnits), activeScopeLabel(), "var(--coral)", "stream", "Unités vendues")}${kpi("Couverture estimée", coverageDays === null ? "—" : `${integer.format(coverageDays)} j`, "au rythme de la sélection", "var(--cyan)", "bolt", activeScopeLabel())}${kpi("Risque de rupture", integer.format(critical), `${integer.format(watch)} sous surveillance`, "var(--danger)", "shield", critical ? "Action requise" : "Aucune alerte")}</div>`
    + `<div class="dashboard-grid">${panel("Disponibilité détaillée", `Stock courant et demande sur ${activeScopeLabel()}`, inventoryTable(items), 12, toolbar)}</div>`;
  bindTableSearch("#inventory-search", "#inventory-body");
  document.querySelector("#export-inventory").addEventListener("click", exportInventory);
}

function customerTable(customers) {
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Golden record</th><th>Pays</th><th>Acquisition</th><th>Canaux réconciliés</th><th>Commandes</th><th>Valeur client</th><th>Segment RFM</th><th>Consentement</th></tr></thead><tbody id="customer-body">${customers.map(item => `<tr data-search="${escapeHtml(`${item.customer_id} ${item.segment} ${item.country} ${item.channels}`.toLowerCase())}"><td><div class="product-cell"><span class="product-icon">${item.customer_id.slice(-2)}</span><strong>${item.customer_id}</strong></div></td><td>${item.country}</td><td>${item.acquisition_channel}</td><td>${escapeHtml(item.channels)}</td><td>${item.order_count}</td><td><strong>${euro.format(item.spend)}</strong></td><td><span class="badge healthy">${item.segment}</span></td><td>${item.consent_marketing ? `<span class="badge pass">OPT-IN</span>` : `<span class="badge warn">OPT-OUT</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderCustomers() {
  const d = state.data, customers = d.customers;
  const segments = ["Champions", "Fidèles", "Prometteurs", "Nouveaux"].map(label => ({ label, value: customers.filter(item => item.segment === label).length }));
  const omnichannel = customers.filter(item => String(item.channels).includes(",")).length;
  const toolbar = `<div class="table-tools"><label class="search-box">${icon("search")}<input id="customer-search" type="search" placeholder="ID, pays ou segment…" /></label></div>`;
  const privacyPassed = d.quality.privacy_ok;
  root.innerHTML = hero("CRM + WEB + POS · IDENTITY RESOLUTION", "Une identité client unifiée", "Les comportements sont rapprochés sans exposer d’email : le modèle analytique ne conserve qu’un hash et des identifiants métier.")
    + `<div class="kpi-grid">${kpi("Clients actifs", integer.format(d.kpis.customers), activeScopeLabel(), "var(--violet)", "users", "Golden records filtrés")}${kpi("Profils affichés", integer.format(customers.length), "classés par valeur", "var(--cyan)", "users", "Top analytique")}${kpi("Omnicanaux", integer.format(omnichannel), "parmi les profils affichés", "var(--cyan)", "stream", "Plusieurs canaux")}${kpi("Protection PII", privacyPassed ? "100%" : "À corriger", "hashes contrôlés", "var(--lime)", "shield", privacyPassed ? "Contrat validé" : "Publication bloquée")}</div>`
    + `<div class="dashboard-grid">${panel("Segmentation RFM", "Répartition des profils affichés", donut(segments, "PROFILS"), 4)}${panel("Customer 360 · Golden Records", `Top ${customers.length} sur ${integer.format(d.kpis.customers)} clients actifs`, customerTable(customers), 8, toolbar)}</div>`;
  bindTableSearch("#customer-search", "#customer-body");
}

function renderReliability() {
  const d = state.data;
  const q = d.quality;
  const platform = d.platform_evidence;
  const publishable = q.status === "PASS" && d.reconciliation.status === "PASS";
  const flow = `<div class="pipeline-flow">${d.pipeline.map(node => `<div class="pipeline-node ${node.status}"><div class="node-icon">${node.name.split(" ")[0].slice(0,4).toUpperCase()}<i class="node-status"></i></div><strong>${node.name}</strong><span>${node.role}</span><b>${node.metric}</b></div>`).join("")}</div>`;
  const proofs = [
    ["Sources contrôlées", `${platform.sources.count} fichiers · ${integer.format(platform.sources.records)} lignes`],
    ["AWS local", `${platform.aws.s3_objects} objets S3 · ${integer.format(platform.aws.kinesis_events)} événements Kinesis`],
    ["Validation événementielle", `${integer.format(platform.aws.lambda_events)} événements validés par le handler`],
    ["dbt + DuckDB", `${platform.dbt.models} modèles · ${platform.dbt.tests} tests · ${platform.dbt.snapshots} snapshot`],
    ["Qualité métier", `${q.passed}/${q.total} contrôles réussis`],
    ["Publishing gate", `${d.reconciliation.unit_delta} unité · ${Number(d.reconciliation.amount_delta).toFixed(2)} € d’écart`],
  ];
  const proofGrid = `<div class="check-grid">${proofs.map(([title, detail]) => `<div class="check-item"><div class="check-mark">${icon("check")}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div></div>`).join("")}</div>`;
  const trust = `<div class="quality-score"><div class="score-ring" style="--score:${q.score}%"><div><strong>${q.score}%</strong><span>QUALITÉ</span></div></div><div class="quality-copy"><h3>${publishable ? "Publication autorisée" : "Publication bloquée"}</h3><p>${publishable ? "Tous les contrôles et rapprochements sont conformes." : "Un écart doit être corrigé avant publication."}</p></div></div>`;

  root.innerHTML = hero("AIRFLOW · DBT · DATA QUALITY", "Un pipeline fiable avant publication", "Airflow orchestre les traitements. dbt construit les modèles. La publication reste bloquée tant que les contrôles ne passent pas.")
    + `<div class="kpi-grid">${kpi("Airflow", `${platform.airflow.tasks} tâches`, platform.airflow.schedule, "var(--lime)", "pipeline", platform.airflow.status)}${kpi("dbt build", `${platform.dbt.models} modèles`, `${platform.dbt.tests} tests + ${platform.dbt.snapshots} snapshot`, "var(--violet)", "shield", platform.dbt.status)}${kpi("Contrôles qualité", `${q.passed}/${q.total}`, "contrats techniques et métier", "var(--cyan)", "shield", q.status)}${kpi("Réconciliation", "0 écart", "unités et paiements", "var(--coral)", "stream", d.reconciliation.status)}</div>`
    + `<div class="dashboard-grid">${panel("Chaîne exécutée", "Vert : exécuté · orange : API AWS locales", flow, 12, `<div class="evidence-legend"><span class="badge pass">EXÉCUTÉ</span><span class="badge emulated">AWS LOCAL</span></div>`)}${panel("Preuves essentielles", "Les chiffres proviennent des rapports d’exécution", proofGrid, 7)}${panel("Décision de publication", "La donnée n’est exposée qu’après validation", trust, 5, `<span class="badge ${publishable ? "pass" : "critical"}">${publishable ? "PASS" : "BLOCKED"}</span>`)}</div>`;
}

function exportInventory() {
  const headers = ["product_id", "name", "category", "store_stock", "warehouse_stock", "reserved", "incoming", "units_sold", "selected_units_sold", "safety_stock", "atp", "risk_level"];
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.join(";"), ...state.data.inventory.map(item => headers.map(key => quote(item[key])).join(";"))].join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `retail-core-inventory-${state.channel}-${state.period}d.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Snapshot ATP exporté · ${activeScopeLabel()}`);
}

function bindTableSearch(inputSelector, bodySelector) {
  const input = document.querySelector(inputSelector);
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll(`${bodySelector} tr`).forEach(row => row.hidden = !row.dataset.search.includes(query));
  });
}

function bindInlineActions() {
  document.querySelectorAll("[data-view-jump]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.viewJump)));
}

function render() {
  if (!state.data) return;
  root.style.animation = "none";
  requestAnimationFrame(() => root.style.animation = "viewIn .28s ease both");
  ({ overview: renderOverview, inventory: renderInventory, customers: renderCustomers, reliability: renderReliability }[state.view])();
}

async function loadData(showFeedback = false) {
  const requestId = ++state.requestId;
  state.loading = true;
  document.querySelector("#refresh-data").disabled = true;
  if (!state.data) root.innerHTML = `<div class="kpi-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="skeleton" style="height:340px"></div>`;
  try {
    let data = window.RETAIL_CORE_STATIC?.dashboards?.[`${state.channel}-${state.period}`];
    if (!data) {
      const response = await fetch(`/api/dashboard?channel=${state.channel}&period=${state.period}`, { cache: "no-store" });
      if (!response.ok) throw new Error("API indisponible");
      data = await response.json();
    }
    if (requestId !== state.requestId) return;
    state.data = data;
    document.querySelector("#last-run").textContent = new Date(state.data.meta.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    document.querySelector("#contract-version").textContent = state.data.meta.data_contract;
    document.querySelector("#latency-sla").textContent = `p95 ${integer.format(state.data.kpis.latency_p95_ms)} ms · cible < 3 s`;
    updateScopeUi();
    render();
    if (showFeedback) {
      const globalScope = globalViewScopes[state.view];
      showToast(globalScope ? `${globalScope.pill} actualisé` : `Périmètre appliqué · ${activeScopeLabel()}`);
    }
  } catch (error) {
    if (requestId !== state.requestId) return;
    root.innerHTML = `<div class="error-state"><strong>Le cockpit n’arrive pas à joindre le pipeline.</strong>Lancez <code>python3 run_demo.py</code>, puis <code>python3 serve.py</code>.</div>`;
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      document.querySelector("#refresh-data").disabled = false;
    }
  }
}

function switchView(view) {
  state.view = view;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.querySelector("#page-title").textContent = viewTitles[view];
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  document.querySelector("#sidebar").classList.remove("open");
  document.querySelector("#mobile-menu").setAttribute("aria-expanded", "false");
  updateScopeUi();
  render();
}

document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => switchView(item.dataset.view)));
document.querySelector("#channel-filter").addEventListener("change", event => { state.channel = event.target.value; loadData(true); });
document.querySelector("#period-filter").addEventListener("change", event => { state.period = Number(event.target.value); loadData(true); });
document.querySelector("#refresh-data").addEventListener("click", () => loadData(true));
document.querySelector("#mobile-menu").addEventListener("click", event => { const opened = document.querySelector("#sidebar").classList.toggle("open"); event.currentTarget.setAttribute("aria-expanded", String(opened)); });
updateScopeUi();
loadData();
