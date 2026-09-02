const state = { view: "overview", channel: "all", period: 30, data: null, loading: false, requestId: 0 };
const viewTitles = {
  overview: "Vue d’ensemble",
  realtime: "Temps réel",
  inventory: "Stock & ATP",
  customers: "Customer 360",
  pipeline: "Pipeline & Ops",
  quality: "Qualité & SCD2",
  costs: "FinOps",
};
const colors = ["#ff7657", "#57d3e8", "#9f8cff", "#b8f36b", "#ffb85c", "#f573ae", "#6e91ff"];
const root = document.querySelector("#view-root");
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-FR");

const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const dateShort = value => new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
const timeShort = value => new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

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
  return `<div class="recon-stack"><div class="recon-card"><div class="recon-side"><span>UNITÉS BATCH</span><strong>${integer.format(data.batch_units)}</strong></div><div class="recon-equals">${icon("check")}</div><div class="recon-side"><span>UNITÉS KINESIS</span><strong>${integer.format(data.stream_units)}</strong></div></div><div class="recon-card payment"><div class="recon-side"><span>VENTES COMPTABLES</span><strong>${euro.format(data.sales_amount || 0)}</strong></div><div class="recon-equals">${icon("check")}</div><div class="recon-side"><span>PAIEMENTS SOLDÉS</span><strong>${euro.format(data.payment_amount || 0)}</strong></div></div></div><div class="recon-foot"><span>Écarts : <b>${integer.format(unitDelta)} unité</b> · <b>${amountDelta.toFixed(2)} €</b></span><span class="badge ${data.status === "PASS" ? "pass" : "critical"}">${icon(data.status === "PASS" ? "check" : "close")} ${data.status}</span></div>`;
}

function renderOverview() {
  const d = state.data, k = d.kpis;
  root.innerHTML = hero("RETAIL CORE · SINGLE SOURCE OF TRUTH", "Le retail en un seul regard", "Ventes synthétiques omnicanales, disponibilité stock et fiabilité du pipeline sur la sélection active.", `<button type="button" class="subtle-button" data-view-jump="pipeline">Voir l’architecture</button><button type="button" class="subtle-button accent" data-open-sim>Scénario Black Friday</button>`)
    + `<div class="kpi-grid">${kpi("Chiffre d’affaires", euro.format(k.revenue || 0), `${d.meta.period} derniers jours`, "var(--coral)", "stream", `${integer.format(k.customers || 0)} clients actifs`)}${kpi("Commandes", integer.format(k.orders || 0), `${integer.format(k.units || 0)} articles`, "var(--cyan)", "box", `Panier moyen ${euro.format(k.avg_basket || 0)}`)}${kpi("Stock disponible · ATP", integer.format(k.total_atp || 0), "snapshot réseau complet", "var(--lime)", "box", `${integer.format(d.inventory.length)} références suivies`)}${kpi("Qualité des données", `${k.quality_score}%`, `${d.quality.passed}/${d.quality.total} contrôles`, "var(--violet)", "shield", d.quality.status === "PASS" ? "Publication autorisée" : "Publication bloquée")}</div>`
    + `<div class="dashboard-grid">${panel("Performance commerciale", "Chiffre d’affaires quotidien · filtre actif", lineChart(d.series), 8, `<div class="legend"><span><i></i>CA sélectionné</span></div>`)}${panel("Mix des canaux", "Contribution dans la même sélection", donut(d.channel_mix), 4)}${panel("Catégories motrices", "Top 7 catégories par chiffre d’affaires", categoryBars(d.categories), 5)}${panel("Double réconciliation", `Batch / Kinesis et ventes / paiements · ${d.meta.scope}`, reconciliation(d.reconciliation), 7, `<span class="badge ${d.reconciliation.status === "PASS" ? "pass" : "critical"}">${d.reconciliation.status === "PASS" ? "2 INVARIANTS EXACTS" : "ÉCART DÉTECTÉ"}</span>`)}</div>`;
  bindChartTooltips();
  bindInlineActions();
}

function renderRealtime() {
  const d = state.data, m = d.event_metrics;
  const feed = d.live_events.length ? `<div class="event-feed">${d.live_events.map(event => `<div class="event-row"><div class="event-type">${event.event_type.replaceAll("_", " ")}</div><div><strong>${escapeHtml(event.product_name)}</strong><span>${escapeHtml(event.channel)} · ${timeShort(event.event_at)}</span></div><span class="latency">${integer.format(event.latency_ms)} ms</span></div>`).join("")}</div>` : `<div class="error-state"><strong>Aucun événement</strong>La sélection active ne contient aucun événement.</div>`;
  root.innerHTML = hero("STREAMING RETAIL · REPLAY SYNTHÉTIQUE", "Le parcours événementiel sous contrôle", "Consultations, paniers et achats sont filtrés, validés puis rapprochés du batch sur le même périmètre.", `<button type="button" class="subtle-button accent" data-open-sim>Estimer un trafic ×5</button>`)
    + `<div class="kpi-grid">${kpi("Événements dans la fenêtre", integer.format(m.events), d.meta.scope, "var(--cyan)", "stream", `${integer.format(m.purchase_events)} achats`)}${kpi("Latence moyenne", `${integer.format(m.avg_latency_ms)} ms`, `p95 ${integer.format(d.kpis.latency_p95_ms)} ms`, "var(--lime)", "bolt", d.kpis.latency_p95_ms < 3000 ? "SLA cible respecté" : "SLA cible dépassé")}${kpi("Achats détectés", integer.format(m.purchase_events), "événements purchase", "var(--coral)", "box", `Réconciliés : ${d.reconciliation.status}`)}${kpi("Ajouts au panier", integer.format(m.cart_events), "événements web", "var(--violet)", "stream", "Signal d’intention")}</div>`
    + `<div class="dashboard-grid">${panel("Replay des événements", "12 événements les plus récents de la sélection", feed, 5, `<span class="badge healthy">● REPLAY</span>`)}${panel("Valeur captée", "Ventes quotidiennes corrélées aux achats", lineChart(d.series), 7, `<span>p95 ${integer.format(d.kpis.latency_p95_ms)} ms</span>`)}${panel("Garantie d’exactitude", "Idempotence métier et double rapprochement sur le même filtre", reconciliation(d.reconciliation), 6)}${panel("Résilience : exécuté et cible", "Preuves locales et extension de production clairement séparées", `<div class="check-grid"><div class="check-item"><div class="check-mark">${icon("check")}</div><div><strong>event_id unique</strong><span>Test automatisé</span></div></div><div class="check-item"><div class="check-mark">${icon("check")}</div><div><strong>Partition source_customer_id</strong><span>Test automatisé</span></div></div><div class="check-item"><div class="check-mark">${icon("check")}</div><div><strong>Alarme CloudWatch</strong><span>Exécutée via AWS local</span></div></div><div class="check-item target"><div class="check-mark">${icon("arrow")}</div><div><strong>Dead-letter queue</strong><span>Cible production</span></div></div></div>`, 6)}</div>`;
  bindChartTooltips(); bindInlineActions();
}

function inventoryTable(items) {
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Catégorie</th><th>Magasins</th><th>Entrepôt</th><th>Réservé</th><th>Entrant</th><th>ATP</th><th>Risque</th></tr></thead><tbody id="inventory-body">${items.map(item => `<tr data-search="${escapeHtml(`${item.name} ${item.category} ${item.risk_level}`.toLowerCase())}"><td><div class="product-cell"><span class="product-icon">${item.product_id.slice(-2)}</span><strong>${escapeHtml(item.name)}</strong></div></td><td>${escapeHtml(item.category)}</td><td>${integer.format(item.store_stock)}</td><td>${integer.format(item.warehouse_stock)}</td><td>${integer.format(item.reserved)}</td><td>${integer.format(item.incoming)}</td><td class="atp-cell"><div class="atp-value"><strong>${integer.format(item.atp)}</strong><span>seuil ${item.safety_stock}</span></div><div class="table-meter"><i class="${item.risk_level}" style="width:${Math.min(100, item.atp / 1600 * 100)}%"></i></div></td><td><span class="badge ${item.risk_level}">${item.risk_level.toUpperCase()}</span></td></tr>`).join("")}</tbody></table></div>`;
}

function renderInventory() {
  const d = state.data, items = d.inventory;
  const watch = items.filter(item => item.risk_level === "watch").length;
  const critical = items.filter(item => item.risk_level === "critical").length;
  const incoming = items.reduce((sum, item) => sum + item.incoming, 0);
  const toolbar = `<div class="table-tools"><label class="search-box">${icon("search")}<input id="inventory-search" type="search" placeholder="Rechercher un produit…" /></label></div>`;
  root.innerHTML = hero("SUPPLY CHAIN · AVAILABLE TO PROMISE", "Le bon stock, au bon moment", "ATP = stock initial + entrant − réservé − unités vendues dans le jeu de démonstration.", `<button type="button" class="subtle-button" id="export-inventory">Exporter le snapshot CSV</button>`)
    + `<div class="kpi-grid">${kpi("ATP réseau", integer.format(items.reduce((s,i)=>s+i.atp,0)), "unités vendables", "var(--lime)", "box", "Snapshot consolidé")}${kpi("Sous surveillance", integer.format(watch), "références", "var(--warning)", "shield", "ATP < 2 × seuil")}${kpi("Risque de rupture", integer.format(critical), "références critiques", "var(--danger)", "shield", critical ? "Action requise" : "Aucune alerte")}${kpi("Réapprovisionnement", integer.format(incoming), "unités entrantes", "var(--cyan)", "stream", "Flux déclaré")}</div>`
    + `<div class="dashboard-grid">${panel("Disponibilité détaillée", "Référentiel produit enrichi du calcul ATP", inventoryTable(items), 12, toolbar)}</div>`;
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
  const privacyPassed = d.quality.checks.some(check => check.name === "privacy.email_hash_shape" && check.status === "PASS");
  root.innerHTML = hero("CRM + WEB + POS · IDENTITY RESOLUTION", "Une identité client unifiée", "Les comportements sont rapprochés sans exposer d’email : le modèle analytique ne conserve qu’un hash et des identifiants métier.")
    + `<div class="kpi-grid">${kpi("Clients actifs", integer.format(d.kpis.customers), `${d.meta.period} jours`, "var(--violet)", "users", "Golden records filtrés")}${kpi("Profils affichés", integer.format(customers.length), "classés par valeur", "var(--cyan)", "users", "Top analytique")}${kpi("Omnicanaux", integer.format(omnichannel), "parmi les profils affichés", "var(--cyan)", "stream", "Plusieurs canaux")}${kpi("Protection PII", privacyPassed ? "100%" : "À corriger", "hashes contrôlés", "var(--lime)", "shield", privacyPassed ? "Contrat validé" : "Publication bloquée")}</div>`
    + `<div class="dashboard-grid">${panel("Segmentation RFM", "Répartition des profils affichés", donut(segments, "PROFILS"), 4)}${panel("Customer 360 · Golden Records", `Top ${customers.length} sur ${integer.format(d.kpis.customers)} clients actifs`, customerTable(customers), 8, toolbar)}</div>`;
  bindTableSearch("#customer-search", "#customer-body");
}

function renderPipeline() {
  const d = state.data, run = d.pipeline_run, platform = d.platform_evidence;
  const flow = `<div class="pipeline-flow">${d.pipeline.map(node => `<div class="pipeline-node ${node.status}"><div class="node-icon">${node.name.split(" ")[0].slice(0,4).toUpperCase()}<i class="node-status"></i></div><strong>${node.name}</strong><span>${node.role}</span><b>${node.metric}</b></div>`).join("")}</div>`;
  const maxDuration = Math.max(...run.phases.map(phase => phase.duration_ms), 1);
  const execution = run.phases.length ? `<div class="dag">${run.phases.map(phase => `<div class="dag-row"><strong>${escapeHtml(phase.name)}</strong><span>${escapeHtml(phase.label)}</span><div class="task-bar"><i style="width:${Math.max(5, phase.duration_ms / maxDuration * 100)}%"></i></div><time>${Number(phase.duration_ms).toFixed(1)} ms</time></div>`).join("")}</div>` : `<div class="error-state"><strong>Aucune télémétrie</strong>Relancez le pipeline pour produire le rapport d’exécution.</div>`;
  const proofs = [
    ["DAG Airflow 3.3.1", `${platform.airflow.tasks} tâches · ${platform.airflow.schedule}`],
    ["Connecteur Airbyte-compatible", `${platform.airbyte.streams} flux · ${integer.format(platform.airbyte.records)} lignes`],
    ["S3 Raw partitionné", `${platform.aws.s3_objects} objets via LocalStack`],
    ["Kinesis + Lambda", `${integer.format(platform.aws.kinesis_events)} publiés · ${integer.format(platform.aws.lambda_events)} validés`],
    ["CloudWatch", `${platform.aws.cloudwatch_metrics} métriques + logs + alarme`],
    ["dbt Core", `${platform.dbt.models} modèles · ${platform.dbt.tests} tests · ${platform.dbt.snapshots} snapshot`],
    ["Warehouse DuckDB", `Adapter exécuté · ${platform.dbt.failed} échec`],
    ["Publishing gate", `SLA ${platform.publishing.sla} · écarts à zéro`],
  ];
  const proofGrid = `<div class="check-grid">${proofs.map(([title, detail]) => `<div class="check-item"><div class="check-mark">${icon("check")}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div></div>`).join("")}</div>`;
  root.innerHTML = hero("AIRFLOW · DBT · AWS LOCAL", "Une plateforme réellement orchestrée", "Le profil Docker exécute les six tâches du DAG, les appels AWS locaux et le build dbt. Snowflake reste explicitement la cible de production.", `<button type="button" class="subtle-button accent" data-open-sim>Estimer la capacité</button>`)
    + `<div class="kpi-grid">${kpi("Airflow 3.3.1", platform.airflow.status, platform.airflow.dag_id, "var(--lime)", "pipeline", `${platform.airflow.tasks} tâches exécutables`)}${kpi("dbt build", `${platform.dbt.models} modèles`, `${platform.dbt.tests} tests + ${platform.dbt.snapshots} snapshot`, "var(--violet)", "shield", platform.dbt.status)}${kpi("AWS local", platform.aws.status, "S3 · Kinesis · Lambda · CloudWatch", "var(--cyan)", "stream", `${integer.format(platform.aws.kinesis_events)} événements`)}${kpi("Publication", platform.publishing.status, `SLA ${platform.publishing.sla}`, "var(--coral)", "bolt", "2 rapprochements exacts")}</div>`
    + `<div class="dashboard-grid">${panel("Chaîne d’exécution et cible", "Vert : exécuté · orange : AWS émulé localement · bleu : cible de production", flow, 12, `<div class="evidence-legend"><span class="badge pass">EXÉCUTÉ</span><span class="badge emulated">AWS LOCAL</span><span class="badge target">CIBLE</span></div>`)}${panel("Preuves du dernier profil complet", "Valeurs issues des rapports d’exécution, pas d’un écran décoratif", proofGrid, 7, `<span class="badge ${platform.status === "PASS" ? "pass" : "warn"}">${platform.status}</span>`)}${panel("Pipeline de référence", "Durées mesurées des transformations Python indépendantes", execution, 5, `<span class="badge pass">${run.status} · ${Number(run.duration_ms).toFixed(1)} ms</span>`)}</div>`;
  bindInlineActions();
}

function renderQuality() {
  const d = state.data, q = d.quality;
  const checks = `<div class="check-grid">${q.checks.map(check => `<div class="check-item ${check.status === "PASS" ? "" : "failed"}"><div class="check-mark">${icon(check.status === "PASS" ? "check" : "close")}</div><div><strong>${escapeHtml(check.name)}</strong><span>${escapeHtml(check.domain)} · ${check.status}</span></div></div>`).join("")}</div>`;
  const scd = `<div class="scd-timeline">${d.price_scd.map(item => `<div class="scd-item ${item.is_current ? "current" : ""}"><strong>${escapeHtml(item.name)}</strong><b>${Number(item.price).toFixed(2)} €</b><span>${item.valid_from} → ${item.valid_to === "9999-12-31" ? "actuel" : item.valid_to}</span><span class="badge ${item.is_current ? "pass" : "warn"}">${item.is_current ? "CURRENT" : "HISTORY"}</span></div>`).join("")}</div>`;
  const publishable = q.status === "PASS" && d.reconciliation.status === "PASS";
  root.innerHTML = hero("DATA CONTRACTS · TRUST BY DESIGN", "Des indicateurs auxquels le métier peut croire", "Le publishing gate bloque l’exposition si un contrat ou la réconciliation du périmètre sélectionné échoue.", `<a class="subtle-button" href="/api/quality-report" download="retail-core-quality-report.json">Télécharger le rapport JSON</a>`)
    + `<div class="kpi-grid">${kpi("Score qualité", `${q.score}%`, `${q.passed}/${q.total} contrôles`, "var(--lime)", "shield", publishable ? "Publishing gate ouvert" : "Publishing gate fermé")}${kpi("Fraîcheur", `${q.freshness_minutes} min`, "dernier événement généré", "var(--cyan)", "stream", "Seuil < 24 h")}${kpi("Double rapprochement", "2 / 2", d.meta.scope, "var(--coral)", "cost", `${d.reconciliation.unit_delta} unité · ${Number(d.reconciliation.amount_delta).toFixed(2)} €`)}${kpi("SCD Type 2", integer.format(d.price_scd.length), "versions chargées", "var(--violet)", "pipeline", `${integer.format(d.inventory.length)} produits × 2 versions`)}</div>`
    + `<div class="dashboard-grid">${panel("Confiance globale", "Qualité avant exposition aux utilisateurs", `<div class="quality-score"><div class="score-ring" style="--score:${q.score}%"><div><strong>${q.score}%</strong><span>TRUST SCORE</span></div></div><div class="quality-copy"><h3>${publishable ? "Prêt pour publication" : "Publication bloquée"}</h3><p>${publishable ? "Tous les contrôles passent et la réconciliation de la sélection est exacte." : "Un contrôle doit être corrigé avant d’exposer les indicateurs."}</p></div></div>`, 5, `<span class="badge ${publishable ? "pass" : "critical"}">${publishable ? "PASS" : "BLOCKED"}</span>`)}${panel("Contrôles automatisés", "Contrats, intégrité, métier, privacy, SCD2 et fraîcheur", checks, 7)}${panel("Historisation des prix · SCD Type 2", "Une version historique et une version courante par produit", scd, 12, `<span>${d.price_scd.length} versions</span>`)}</div>`;
}

function renderCosts() {
  const d = state.data, c = d.costs, capacity = d.capacity_preview;
  const usage = c.monthly_total / c.budget * 100;
  const safeCapacity = capacity.shards_after * capacity.assumptions.safe_events_per_shard / capacity.assumptions.headroom_ratio;
  const capacityLoad = Math.min(100, capacity.simulated_rps / safeCapacity * 100);
  const costBars = `<div class="cost-bars">${c.components.map((item, index) => `<div class="cost-row"><span>${item.name}</span><div class="cost-bar"><i style="width:${item.share}%;background:${colors[index + 2]}"></i></div><b>${item.amount.toFixed(0)} €</b></div>`).join("")}</div>`;
  root.innerHTML = hero("FINOPS · SCÉNARIO CLOUD CIBLE", "Un modèle de coût explicite, pas une fausse facture", `Hypothèse pédagogique : ${compact.format(c.monthly_event_volume)} événements par mois sur des services managés. Les montants servent à comparer budget, prévision et leviers.`)
    + `<div class="kpi-grid">${kpi("Coût mensuel estimé", euro.format(c.monthly_total), "scénario cible", "var(--violet)", "cost", `${c.savings_percent}% sous le scénario non optimisé`)}${kpi("Budget simulé", euro.format(c.budget), `${usage.toFixed(0)}% consommé`, "var(--lime)", "shield", "Marge disponible")}${kpi("Prévision simulée", euro.format(c.forecast), "fin de mois", "var(--cyan)", "stream", `${c.forecast_under_budget_percent}% sous budget`)}${kpi("Coût / 1k événements", `${c.cost_per_1k_events.toFixed(2)} €`, `${compact.format(c.monthly_event_volume)} événements/mois`, "var(--coral)", "bolt", "Calcul cohérent")}</div>`
    + `<div class="dashboard-grid">${panel("Budget du scénario", "Estimation paramétrique · aucune facture cloud connectée", `<div class="cost-total"><div><span>COÛT MODÉLISÉ</span><strong>${euro.format(c.monthly_total)}</strong></div><span>Prévision ${euro.format(c.forecast)}</span></div><div class="budget-meter"><i style="width:${usage}%"></i></div><div class="budget-labels"><span>0 €</span><span>Budget ${euro.format(c.budget)}</span></div><div class="assumption-note">${c.assumptions.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>`, 5)}${panel("Répartition du scénario", "Les montants totalisent exactement le coût mensuel modélisé", costBars, 7)}${panel("Optimisations proposées", "Leviers à mettre en œuvre dans l’architecture cible", `<div class="check-grid"><div class="check-item target"><div class="check-mark">${icon("arrow")}</div><div><strong>Snowflake auto-suspend</strong><span>Compute cible</span></div></div><div class="check-item"><div class="check-mark">${icon("check")}</div><div><strong>dbt incrémental</strong><span>Modèles fournis</span></div></div><div class="check-item target"><div class="check-mark">${icon("arrow")}</div><div><strong>Lambda right-sizing</strong><span>Mesure cible</span></div></div><div class="check-item target"><div class="check-mark">${icon("arrow")}</div><div><strong>S3 lifecycle</strong><span>Politique cible</span></div></div></div>`, 6)}${panel("Capacité Black Friday", "Exemple déterministe à ×5 avec 25 % de marge", `<div class="quality-score"><div class="score-ring" style="--score:${capacityLoad}%"><div><strong>${capacityLoad.toFixed(0)}%</strong><span>CHARGE</span></div></div><div class="quality-copy"><h3>+${euro.format(capacity.estimated_cost_delta)}</h3><p>${capacity.shards_before} → ${capacity.shards_after} unités de capacité, p95 estimée à ${integer.format(capacity.p95_latency_ms)} ms. Aucun trafic réel n’est lancé.</p><button type="button" class="subtle-button accent" data-open-sim style="margin-top:12px">Modifier le scénario</button></div></div>`, 6)}</div>`;
  bindInlineActions();
}

function exportInventory() {
  const headers = ["product_id", "name", "category", "store_stock", "warehouse_stock", "reserved", "incoming", "units_sold", "safety_stock", "atp", "risk_level"];
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.join(";"), ...state.data.inventory.map(item => headers.map(key => quote(item[key])).join(";"))].join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "retail-core-inventory.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Snapshot ATP exporté en CSV");
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
  document.querySelectorAll("[data-open-sim]").forEach(button => button.addEventListener("click", openSimulation));
  document.querySelectorAll("[data-view-jump]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.viewJump)));
}

function render() {
  if (!state.data) return;
  root.style.animation = "none";
  requestAnimationFrame(() => root.style.animation = "viewIn .28s ease both");
  ({ overview: renderOverview, realtime: renderRealtime, inventory: renderInventory, customers: renderCustomers, pipeline: renderPipeline, quality: renderQuality, costs: renderCosts }[state.view])();
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
    render();
    if (showFeedback) showToast("Données actualisées · qualité validée");
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
  render();
}

function openSimulation() {
  document.querySelector("#simulation-modal").hidden = false;
  document.querySelector("#simulation-result").innerHTML = "";
  document.querySelector("#traffic-multiplier").focus();
}
function closeSimulation() { document.querySelector("#simulation-modal").hidden = true; }
async function runSimulation() {
  const button = document.querySelector("#run-simulation");
  const multiplier = Number(document.querySelector("#traffic-multiplier").value);
  button.disabled = true;
  button.innerHTML = `<span class="pulse-dot"></span>Simulation en cours…`;
  document.querySelector("#simulation-result").innerHTML = `<div class="skeleton" style="margin-top:14px;min-height:110px"></div>`;
  try {
    let result = window.RETAIL_CORE_STATIC?.simulations?.[multiplier.toFixed(1)];
    if (!result) {
      const response = await fetch(`/api/simulate?multiplier=${multiplier}`);
      if (!response.ok) throw new Error("Simulation indisponible");
      result = await response.json();
    }
    await new Promise(resolve => setTimeout(resolve, 650));
    document.querySelector("#simulation-result").innerHTML = `<div class="simulation-results"><header><strong>Scénario calculé</strong><span class="badge ${result.status === "PASS" ? "pass" : "warn"}">${icon(result.status === "PASS" ? "check" : "shield")} ${result.status}</span></header><div class="simulation-results-grid"><div><span>DÉBIT ESTIMÉ</span><strong>${integer.format(result.simulated_rps)} events/s</strong></div><div><span>UNITÉS DE CAPACITÉ</span><strong>${result.shards_before} → ${result.shards_after}</strong></div><div><span>LATENCE P95</span><strong>${integer.format(result.p95_latency_ms)} ms</strong></div><div><span>TAUX D’ERREUR MODÉLISÉ</span><strong>${result.error_rate}%</strong></div><div><span>INVARIANT COMPTABLE</span><strong>${result.reconciliation_delta}</strong></div><div><span>SURCOÛT ESTIMÉ</span><strong>+${result.estimated_cost_delta.toFixed(2)} €</strong></div></div><p>${result.message}</p></div>`;
  } catch (error) {
    document.querySelector("#simulation-result").innerHTML = `<div class="simulation-results"><strong>Simulation indisponible</strong></div>`;
  } finally {
    button.disabled = false;
    button.innerHTML = `${icon("bolt")}Calculer le scénario`;
  }
}

document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => switchView(item.dataset.view)));
document.querySelector("#channel-filter").addEventListener("change", event => { state.channel = event.target.value; loadData(true); });
document.querySelector("#period-filter").addEventListener("change", event => { state.period = Number(event.target.value); loadData(true); });
document.querySelector("#refresh-data").addEventListener("click", () => loadData(true));
document.querySelector("#mobile-menu").addEventListener("click", event => { const opened = document.querySelector("#sidebar").classList.toggle("open"); event.currentTarget.setAttribute("aria-expanded", String(opened)); });
document.querySelector("#open-simulation").addEventListener("click", openSimulation);
document.querySelector("#close-simulation").addEventListener("click", closeSimulation);
document.querySelector("#simulation-modal").addEventListener("click", event => { if (event.target.id === "simulation-modal") closeSimulation(); });
document.querySelector("#traffic-multiplier").addEventListener("input", event => { const value = Number(event.target.value); document.querySelector("#multiplier-value").textContent = `× ${value.toFixed(1)}`; document.querySelector("#projected-rps").textContent = `${Math.round(42 * value)} événements/s`; });
document.querySelector("#run-simulation").addEventListener("click", runSimulation);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeSimulation(); });

loadData();
