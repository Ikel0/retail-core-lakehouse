const state = { view: "overview", channel: "all", period: 30, data: null, trends: null, mode: "démo statique", loading: false, requestId: 0 };
// La vue fiabilité décrit le dernier run complet : les filtres canal et période ne s'y appliquent pas.
const globalViews = new Set(["reliability"]);
const CHANNELS = ["web", "store", "marketplace"];
const channelLabels = { web: "E-commerce", store: "Magasins", marketplace: "Marketplace", catalog: "Catalogue" };
const riskLabels = { critical: "Sous le seuil", watch: "À surveiller", healthy: "Normal" };
const root = document.querySelector("#view-root");

// Intl fr-FR pose déjà l'espace fine insécable des milliers et l'espace insécable avant €.
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroCents = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("fr-FR");
const oneDecimal = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NNBSP = " ";
const MINUS = "−";
const UNAVAILABLE = "indisponible";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const isNumber = value => typeof value === "number" && Number.isFinite(value);
const channelLabel = value => channelLabels[value] || value;
// En français, 0 et 1 prennent le singulier.
const plural = (value, singular, pluralForm) => (Math.abs(value) < 2 ? singular : pluralForm);
const count = (value, singular, pluralForm) => isNumber(value) ? `${integer.format(value)} ${plural(value, singular, pluralForm)}` : UNAVAILABLE;
const share = (part, total) => total ? `${oneDecimal.format(part / total * 100)}${NNBSP}%` : "–";

// Écart signé : « + » ou signe moins typographique, une décimale, espace fine avant %.
function signedPercent(current, reference) {
  if (!isNumber(current) || !isNumber(reference) || reference === 0) return { text: "n.d.", negative: false };
  const value = Math.round((current - reference) / reference * 1000) / 10;
  if (value === 0) return { text: `0,0${NNBSP}%`, negative: false };
  return { text: `${value > 0 ? "+" : MINUS}${oneDecimal.format(Math.abs(value))}${NNBSP}%`, negative: value < 0 };
}
const signedNumber = (value, formatter) => value < 0 ? `${MINUS}${formatter.format(Math.abs(value))}` : formatter.format(value);

// Les jours de la série sont des dates civiles (AAAA-MM-JJ) : on les lit sans fuseau.
const parseDay = iso => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function dayLabel(iso, month = "short") {
  const date = parseDay(iso);
  const day = date.getDate() === 1 ? "1er" : String(date.getDate());
  return `${day} ${date.toLocaleDateString("fr-FR", { month })}`;
}
const runDate = value => new Date(value).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/^1 /, "1er ");

function statusInfo(status) {
  return {
    PASS: { label: "Réussi", negative: false },
    PUBLISHED: { label: "Publié", negative: false },
    FAIL: { label: "Échec", negative: true },
    READY: { label: "Non exécuté", negative: false },
    NOT_RUN: { label: "Non exécuté", negative: false },
  }[status] || { label: status ? String(status) : UNAVAILABLE, negative: false };
}
const statusText = status => { const info = statusInfo(status); return `<span${info.negative ? ' class="neg"' : ""}>${escapeHtml(info.label)}</span>`; };

function activeScopeLabel() {
  const channel = document.querySelector("#channel-filter");
  const label = channel?.selectedOptions?.[0]?.textContent || "Tous les canaux";
  return `${label}, ${state.period} jours`;
}
// Le libellé du filtre commence par une majuscule ; en milieu de phrase on l'écrit en minuscule.
const inlineScopeLabel = () => {
  const label = activeScopeLabel();
  return label.charAt(0).toLocaleLowerCase("fr-FR") + label.slice(1);
};

function updateScopeUi() {
  const global = globalViews.has(state.view);
  document.querySelectorAll(".select-wrap").forEach(control => { control.hidden = global; });
  document.querySelector("#scope-mode").hidden = !global;
  document.querySelector("#refresh-data").setAttribute(
    "aria-label",
    global ? "Actualiser le dernier run complet" : `Actualiser les données, ${inlineScopeLabel()}`,
  );
}

// Statut tiré des rapports : contrôles qualité, rapprochements et run plateforme (Airflow, dbt, LocalStack).
function runStatus(d) {
  if (d.quality?.status !== "PASS" || d.reconciliation?.status !== "PASS") {
    return { negative: true, text: "Publication bloquée : un contrôle ou un rapprochement échoue" };
  }
  if (d.platform_evidence?.status === "PASS") {
    return { negative: false, text: "Run complet réussi, publication autorisée" };
  }
  return { negative: false, text: "Contrôles Python réussis, run Airflow, dbt et LocalStack non exécuté" };
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function section(title, note, content, extra = "", className = "") {
  return `<section class="block ${className}"><div class="block-head"><h2>${title}</h2>${extra}</div>${note ? `<p class="note">${note}</p>` : ""}${content}</section>`;
}

function table(headers, rows, { className = "", caption = "" } = {}) {
  const head = headers.map(([label, align]) => `<th scope="col"${align ? ` class="${align}"` : ""}>${label}</th>`).join("");
  return `<div class="table-wrap"><table class="grid ${className}">${caption ? `<caption class="visually-hidden">${caption}</caption>` : ""}<thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

// Résumé d'une vue : une ligne d'en-têtes, une ligne de valeurs, à la taille du texte courant.
function summary(items) {
  return table(items.map(([label]) => [label, "r"]), [`<tr>${items.map(([, value, detail, negative]) => `<td class="r${negative ? " neg" : ""}">${value}${detail ? `<span class="sub">${detail}</span>` : ""}</td>`).join("")}</tr>`], { className: "summary" });
}

const emptyState = (title, detail) => `<div class="empty-state"><strong>${title}</strong>${detail}</div>`;

/* ---------- Flash ventes ---------- */

// Série quotidienne complète (jours sans vente à zéro), du plus ancien au plus récent.
function denseSeries(series, endIso, days) {
  const byDay = new Map((series || []).map(item => [item.day, item]));
  const end = parseDay(endIso);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (days - 1 - index));
    const day = isoDay(date);
    const item = byDay.get(day);
    return { day, revenue: item ? Number(item.revenue) : 0, orders: item ? Number(item.orders) : 0 };
  });
}
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

function sparkline(points) {
  if (points.length < 2) return `<span class="muted">–</span>`;
  const width = 132, height = 28, pad = 3;
  const max = Math.max(...points.map(p => p.revenue), 1);
  const coords = points.map((p, i) => [pad + i * (width - 2 * pad) / (points.length - 1), height - pad - (p.revenue / max) * (height - 2 * pad)]);
  const low = points.reduce((a, b) => (b.revenue < a.revenue ? b : a));
  const high = points.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const last = points[points.length - 1];
  const label = `Chiffre d’affaires quotidien du ${dayLabel(points[0].day)} au ${dayLabel(last.day)} : minimum ${euro.format(low.revenue)} le ${dayLabel(low.day)}, maximum ${euro.format(high.revenue)} le ${dayLabel(high.day)}, dernier point ${euro.format(last.revenue)} le ${dayLabel(last.day)}`;
  const [lx, ly] = coords[coords.length - 1];
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title><line class="spark-base" x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}"/><polyline points="${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2"/></svg>`;
}

// Le dernier jour de la série est arrêté à l'heure de génération : les comparaisons
// portent sur le dernier jour civil complet, comme un flash publié le matin.
function flashModel(d, trends) {
  const endIso = d.meta.generated_at.slice(0, 10);
  const lastFull = isoDay(new Date(parseDay(endIso).getFullYear(), parseDay(endIso).getMonth(), parseDay(endIso).getDate() - 1));
  const sameDayLastWeek = isoDay(new Date(parseDay(lastFull).getFullYear(), parseDay(lastFull).getMonth(), parseDay(lastFull).getDate() - 7));
  const rowFor = (key, label, revenue, orders, total) => {
    const daily = denseSeries(trends[key], lastFull, 30);
    const last = daily[29], previousWeekDay = daily[22];
    const week = daily.slice(23, 30), previousWeek = daily.slice(16, 23);
    const firstDay = trends[key]?.[0]?.day;
    const spark = daily.slice(-state.period).filter(p => !firstDay || p.day >= firstDay);
    return {
      key, label, revenue, orders, total,
      basket: orders ? revenue / orders : null,
      week: signedPercent(sum(week, "revenue"), sum(previousWeek, "revenue")),
      lastRevenue: last.revenue,
      lastDelta: signedPercent(last.revenue, previousWeekDay.revenue),
      spark,
    };
  };
  const totalRevenue = Number(d.kpis.revenue || 0);
  const rows = [];
  if (state.channel === "all") {
    const mix = new Map(d.channel_mix.map(item => [item.channel, item]));
    const ordered = [...CHANNELS].sort((a, b) => Number(mix.get(b)?.revenue || 0) - Number(mix.get(a)?.revenue || 0));
    ordered.forEach(channel => {
      const item = mix.get(channel) || { revenue: 0, orders: 0 };
      rows.push(rowFor(channel, channelLabel(channel), Number(item.revenue), Number(item.orders), false));
    });
    rows.push(rowFor("all", "Tous canaux", totalRevenue, Number(d.kpis.orders || 0), true));
  } else {
    rows.push(rowFor(state.channel, channelLabel(state.channel), totalRevenue, Number(d.kpis.orders || 0), false));
  }
  return { rows, lastFull, sameDayLastWeek, totalRevenue, endIso };
}

function flashTable(d) {
  const model = flashModel(d, state.trends);
  const headers = [
    ["Canal", ""],
    ["Chiffre d’affaires", "r"],
    ["Commandes", "r"],
    ["Panier moyen", "r"],
    ["Part du CA", "r"],
    ["7 j vs 7 j préc.", "r"],
    [`CA du ${dayLabel(model.lastFull)}`, "r"],
    [`vs ${dayLabel(model.sameDayLastWeek)}`, "r"],
    [`CA quotidien, ${state.period} j`, "spark-col"],
  ];
  const rows = model.rows.map(row => `<tr${row.total ? ' class="total"' : ""}><th scope="row">${escapeHtml(row.label)}</th><td class="r">${euro.format(row.revenue)}</td><td class="r">${integer.format(row.orders)}</td><td class="r">${row.basket === null ? "–" : euroCents.format(row.basket)}</td><td class="r">${share(row.revenue, model.totalRevenue)}</td><td class="r${row.week.negative ? " neg" : ""}">${row.week.text}</td><td class="r">${euro.format(row.lastRevenue)}</td><td class="r${row.lastDelta.negative ? " neg" : ""}">${row.lastDelta.text}</td><td class="spark-col">${sparkline(row.spark)}</td></tr>`);
  const cutTime = new Date(d.meta.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "\u00a0h\u00a0");
  const note = `Cumuls sur ${state.period} jours jusqu’au ${dayLabel(model.endIso)}, journée arrêtée à ${cutTime}. Écarts sur jours complets : semaine au ${dayLabel(model.lastFull)} contre la précédente, ${dayLabel(model.lastFull)} contre ${dayLabel(model.sameDayLastWeek)}.`;
  return section(`Flash ventes au ${dayLabel(model.endIso, "long")}`, note, table(headers, rows, { className: "flash", caption: "Flash ventes par canal" }), "", "lead");
}

function categoriesTable(d) {
  if (!d.categories.length) return emptyState("Aucune catégorie", "La sélection ne contient aucune vente.");
  const total = Number(d.kpis.revenue || 0);
  return table([["Catégorie", ""], ["Chiffre d’affaires", "r"], ["Unités", "r"], ["Part du CA", "r"]],
    d.categories.map(item => `<tr><th scope="row">${escapeHtml(item.category)}</th><td class="r">${euro.format(item.revenue)}</td><td class="r">${integer.format(item.units)}</td><td class="r">${share(item.revenue, total)}</td></tr>`));
}

function reconciliationTable(r) {
  const unitDelta = Number(r.unit_delta ?? r.delta);
  const amountDelta = Number(r.amount_delta);
  const unitOk = unitDelta === 0;
  const amountOk = Number.isFinite(amountDelta) && Math.abs(amountDelta) <= 0.005;
  const rows = [
    ["Unités, batch et Kinesis", integer.format(r.batch_units), integer.format(r.stream_units), Number.isFinite(unitDelta) ? signedNumber(unitDelta, integer) : UNAVAILABLE, unitOk],
    ["Montants, ventes et paiements soldés", euroCents.format(r.sales_amount || 0), euroCents.format(r.payment_amount || 0), Number.isFinite(amountDelta) ? signedNumber(amountDelta, euroCents) : UNAVAILABLE, amountOk],
  ];
  return table([["Rapprochement", ""], ["Référence", "r"], ["Comparé à", "r"], ["Écart", "r"], ["Résultat", ""]],
    rows.map(([label, a, b, gap, ok]) => `<tr><th scope="row">${label}</th><td class="r">${a}</td><td class="r">${b}</td><td class="r${ok ? "" : " neg"}">${gap}</td><td${ok ? "" : ' class="neg"'}>${ok ? "Conforme" : "Écart"}</td></tr>`));
}

function stockModel(d) {
  const items = d.inventory;
  const totalAtp = items.reduce((total, item) => total + item.atp, 0);
  const selectedUnits = items.reduce((total, item) => total + Number(item.selected_units_sold || 0), 0);
  const dailyDemand = selectedUnits / d.meta.period;
  return {
    items, totalAtp, selectedUnits,
    critical: items.filter(item => item.risk_level === "critical").length,
    watch: items.filter(item => item.risk_level === "watch").length,
    coverageDays: dailyDemand > 0 ? Math.round(totalAtp / dailyDemand) : null,
  };
}

function stockTable(d) {
  const s = stockModel(d);
  const rows = [
    ["Stock disponible (ATP) du réseau", count(s.totalAtp, "unité", "unités"), "", false],
    ["Couverture au rythme de la sélection", s.coverageDays === null ? UNAVAILABLE : count(s.coverageDays, "jour", "jours"), "", false],
    ["Références sous le seuil de sécurité", integer.format(s.critical), `sur ${count(s.items.length, "référence", "références")}`, s.critical > 0],
    ["Références à surveiller", integer.format(s.watch), "moins de deux fois le seuil", false],
  ];
  return table([["Indicateur", ""], ["Valeur", "r"], ["Repère", ""]],
    rows.map(([label, value, detail, negative]) => `<tr><th scope="row">${label}</th><td class="r${negative ? " neg" : ""}">${value}</td><td class="muted">${detail}</td></tr>`));
}

function latencyTable(d) {
  const p95 = d.kpis.latency_p95_ms;
  const late = isNumber(p95) && p95 >= 3000;
  const rows = [
    ["Latence p95 des événements", isNumber(p95) ? `${integer.format(p95)}${NNBSP}ms` : UNAVAILABLE, "cible sous 3 s", late],
    ["Événements reçus", count(d.kpis.event_count, "événement", "événements"), inlineScopeLabel(), false],
  ];
  return table([["Indicateur", ""], ["Valeur", "r"], ["Repère", ""]],
    rows.map(([label, value, detail, negative]) => `<tr><th scope="row">${label}</th><td class="r${negative ? " neg" : ""}">${value}</td><td class="muted">${detail}</td></tr>`));
}

function qualityTable(d) {
  const q = d.quality, r = d.reconciliation, platform = d.platform_evidence || {};
  const publishable = q.status === "PASS" && r.status === "PASS";
  const rows = [
    ["Contrôles qualité Python", `${integer.format(q.passed)} sur ${integer.format(q.total)} ${plural(q.passed, "réussi", "réussis")}`, q.failed ? count(q.failed, "échec", "échecs") : "aucun échec", q.status !== "PASS"],
    ["Fraîcheur des données", isNumber(q.freshness_minutes) ? `${oneDecimal.format(q.freshness_minutes)}${NNBSP}min` : UNAVAILABLE, "délai entre la dernière source et le run", false],
    ["Emails clients", q.privacy_ok ? "Hachés" : "Non conformes", "contrôle privacy.email_hash_shape", !q.privacy_ok],
    ["Rapprochements", r.status === "PASS" ? "Conformes" : "Écart détecté", "unités et montants, sur la sélection", r.status !== "PASS"],
    ["Run Airflow, dbt et LocalStack", platform.status === "PASS" ? "Exécuté" : "Non exécuté", "lu dans reports/*.json", false],
    ["Publication", publishable ? "Autorisée" : "Bloquée", "exige contrôles et rapprochements conformes", !publishable],
  ];
  return table([["Contrôle", ""], ["Résultat", ""], ["Détail", ""]],
    rows.map(([label, value, detail, negative]) => `<tr><th scope="row">${label}</th><td${negative ? ' class="neg"' : ""}>${value}</td><td class="muted">${detail}</td></tr>`));
}

function renderOverview() {
  const d = state.data;
  if (!d.kpis.orders) {
    root.innerHTML = section("Flash ventes", "", emptyState("Aucune vente sur cette sélection", "Choisissez une autre période ou un autre canal."), "", "lead");
    return;
  }
  root.innerHTML = flashTable(d)
    + `<div class="pair">${section("Catégories", `Sept premières catégories, ${inlineScopeLabel()}.`, categoriesTable(d))}${section("Rapprochements", `Seuil : aucune unité et moins d’un centime d’écart, ${inlineScopeLabel()}.`, reconciliationTable(d.reconciliation))}</div>`
    + `<div class="pair">${section("Stock", "Instantané du réseau ; seule la demande suit les filtres.", stockTable(d), `<button type="button" class="link-button" data-view-jump="inventory">Détail par produit</button>`)}${section("Latence du flux", "Événements Kinesis rapprochés des commandes.", latencyTable(d))}</div>`
    + section("Contrôles qualité", "Ils portent sur le run complet, hors filtres.", qualityTable(d), `<button type="button" class="link-button" data-view-jump="reliability">Étapes du run</button>`);
  bindInlineActions();
}

/* ---------- Stock ---------- */

function inventoryTable(items) {
  const maxAtp = Math.max(...items.map(item => item.atp), 1);
  return `<div class="table-wrap"><table class="grid wide"><thead><tr><th scope="col">Produit</th><th scope="col">Catégorie</th><th scope="col" class="r">Ventes sélection</th><th scope="col" class="r">Magasins</th><th scope="col" class="r">Entrepôt</th><th scope="col" class="r">Réservé</th><th scope="col" class="r">Entrant</th><th scope="col" class="r">ATP / seuil</th><th scope="col">Risque</th></tr></thead><tbody id="inventory-body">${items.map(item => `<tr data-search="${escapeHtml(`${item.name} ${item.category} ${item.product_id} ${riskLabels[item.risk_level] || item.risk_level}`.toLowerCase())}"><th scope="row">${escapeHtml(item.name)}<span class="id mono">${escapeHtml(item.product_id)}</span></th><td>${escapeHtml(item.category)}</td><td class="r">${integer.format(item.selected_units_sold || 0)}</td><td class="r">${integer.format(item.store_stock)}</td><td class="r">${integer.format(item.warehouse_stock)}</td><td class="r">${integer.format(item.reserved)}</td><td class="r">${integer.format(item.incoming)}</td><td class="r atp-cell">${integer.format(item.atp)} / ${integer.format(item.safety_stock)}<span class="meter" aria-hidden="true"><i class="${item.risk_level === "critical" ? "neg-fill" : ""}" style="width:${Math.max(0, item.atp) / maxAtp * 100}%"></i></span></td><td${item.risk_level === "critical" ? ' class="neg"' : ""}>${riskLabels[item.risk_level] || escapeHtml(item.risk_level)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderInventory() {
  const d = state.data, s = stockModel(d);
  const tools = `<div class="block-tools"><input id="inventory-search" type="search" placeholder="Rechercher un produit" aria-label="Rechercher un produit" /><button type="button" class="button" id="export-inventory">Exporter le CSV</button></div>`;
  root.innerHTML = section("Stock disponible (ATP) et risque de rupture", "Le stock est un instantané du réseau. Le canal et la période ne filtrent que la demande observée, qui sert à estimer la couverture.",
    summary([
      ["ATP réseau", integer.format(s.totalAtp), "stock courant"],
      ["Demande sélectionnée", integer.format(s.selectedUnits), `unités, ${inlineScopeLabel()}`],
      ["Couverture estimée", s.coverageDays === null ? UNAVAILABLE : count(s.coverageDays, "jour", "jours"), "au rythme de la sélection"],
      ["Sous le seuil", integer.format(s.critical), `${integer.format(s.watch)} à surveiller`, s.critical > 0],
    ]), "", "lead")
    + section("Disponibilité par produit", `ATP = magasins + entrepôt + entrant − réservé − vendu. Demande : ${inlineScopeLabel()}.`, inventoryTable(s.items), tools);
  bindTableSearch("#inventory-search", "#inventory-body");
  document.querySelector("#export-inventory").addEventListener("click", exportInventory);
}

/* ---------- Customer 360 ---------- */

function customerTable(customers) {
  return `<div class="table-wrap"><table class="grid wide"><thead><tr><th scope="col">Golden record</th><th scope="col">Pays</th><th scope="col">Acquisition</th><th scope="col">Canaux rapprochés</th><th scope="col" class="r">Commandes</th><th scope="col" class="r">Valeur client</th><th scope="col">Segment RFM</th><th scope="col">Opt-in marketing</th></tr></thead><tbody id="customer-body">${customers.map(item => `<tr data-search="${escapeHtml(`${item.customer_id} ${item.segment} ${item.country} ${item.channels}`.toLowerCase())}"><th scope="row" class="mono">${escapeHtml(item.customer_id)}</th><td>${escapeHtml(item.country)}</td><td>${escapeHtml(channelLabel(item.acquisition_channel))}</td><td>${escapeHtml(String(item.channels).split(",").map(channelLabel).join(", "))}</td><td class="r">${integer.format(item.order_count)}</td><td class="r">${euro.format(item.spend)}</td><td>${escapeHtml(item.segment)}</td><td>${item.consent_marketing ? "Oui" : "Non"}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderCustomers() {
  const d = state.data, customers = d.customers;
  const omnichannel = customers.filter(item => String(item.channels).includes(",")).length;
  const privacyPassed = d.quality.privacy_ok;
  const segments = ["Champions", "Fidèles", "Prometteurs", "Nouveaux"].map(label => ({ label, value: customers.filter(item => item.segment === label).length }));
  const segmentRows = segments.map(item => `<tr><th scope="row">${item.label}</th><td class="r">${count(item.value, "profil", "profils")}</td><td class="r">${share(item.value, customers.length)}</td></tr>`);
  const tools = `<div class="block-tools"><input id="customer-search" type="search" placeholder="Identifiant, pays ou segment" aria-label="Rechercher un client" /></div>`;
  root.innerHTML = section("Identités client rapprochées", "Les identités CRM, web et caisse sont rapprochées en Golden Records. Le modèle analytique ne garde qu’un hash de l’email et des identifiants métier.",
    summary([
      ["Clients actifs", integer.format(d.kpis.customers), activeScopeLabel()],
      ["Profils affichés", integer.format(customers.length), "classés par valeur client"],
      ["Profils omnicanaux", integer.format(omnichannel), "plusieurs canaux"],
      ["Emails", privacyPassed ? "Hachés" : "Non conformes", "privacy.email_hash_shape", !privacyPassed],
    ]), "", "lead")
    + section("Segmentation RFM", "Profils affichés, par segment.", table([["Segment", ""], ["Profils", "r"], ["Part", "r"]], segmentRows), "", "narrow")
    + section("Golden Records", `${integer.format(customers.length)} premiers sur ${count(d.kpis.customers, "client actif", "clients actifs")}.`, customerTable(customers), tools);
  bindTableSearch("#customer-search", "#customer-body");
}

/* ---------- Fiabilité ---------- */

function pipelineMetric(node, d) {
  const platform = d.platform_evidence, q = d.quality;
  if (node.status === "ready") return "non exécuté";
  return {
    "Sources": count(platform.sources?.records, "ligne", "lignes"),
    "Amazon S3": count(platform.aws?.s3_objects, "objet", "objets"),
    "Kinesis": count(platform.aws?.kinesis_events, "événement", "événements"),
    "dbt + DuckDB": isNumber(platform.dbt?.models) ? `${count(platform.dbt.models, "modèle", "modèles")}, ${count(platform.dbt.tests, "test", "tests")}` : UNAVAILABLE,
    "Qualité": `${q.passed} sur ${q.total} contrôles`,
    "Publication": statusInfo(platform.publishing?.status).label.toLowerCase(),
  }[node.name] ?? String(node.metric).toLowerCase();
}

const stepStatus = { executed: "Exécuté", emulated: "Émulé (LocalStack)", ready: "Non exécuté" };

function renderReliability() {
  const d = state.data;
  const q = d.quality;
  const platform = d.platform_evidence;
  const gate = platform.publishing || {};
  const unitGap = gate.unit_delta ?? d.reconciliation.unit_delta;
  const amountGap = gate.payment_delta ?? d.reconciliation.amount_delta;
  const gapKnown = isNumber(unitGap) && isNumber(amountGap);
  const gapText = gapKnown ? `${count(unitGap, "unité", "unités")}, ${euroCents.format(amountGap)}` : UNAVAILABLE;
  const gapOk = gapKnown && unitGap === 0 && Math.abs(amountGap) <= 0.005;
  const publishable = q.status === "PASS" && d.reconciliation.status === "PASS";
  const dbt = platform.dbt || {};
  const dbtKnown = isNumber(dbt.models);
  const awsRan = platform.aws?.status === "PASS";

  const steps = table([["Étape", ""], ["Rôle", ""], ["Mesure", "r"], ["Statut", ""]],
    d.pipeline.map(node => `<tr><th scope="row">${escapeHtml(node.name)}</th><td>${escapeHtml(node.role)}</td><td class="r">${escapeHtml(pipelineMetric(node, d))}</td><td>${stepStatus[node.status] || statusText(node.status)}</td></tr>`));
  const proofs = [
    ["Sources contrôlées", `${count(platform.sources?.count, "fichier", "fichiers")}, ${count(platform.sources?.records, "ligne", "lignes")}`, false],
    ["AWS local", awsRan ? `${count(platform.aws.s3_objects, "objet S3", "objets S3")}, ${count(platform.aws.kinesis_events, "événement Kinesis", "événements Kinesis")}` : "non exécuté", false],
    ["Handler Lambda", awsRan ? `${count(platform.aws.lambda_events, "événement validé", "événements validés")} dans le processus local` : "non exécuté", false],
    ["dbt et DuckDB", dbtKnown ? `${count(dbt.models, "modèle", "modèles")}, ${count(dbt.tests, "test", "tests")}, ${count(dbt.snapshots, "snapshot", "snapshots")}` : `rapport dbt ${UNAVAILABLE}`, false],
    ["Contrôles qualité", `${q.passed} sur ${q.total} ${plural(q.passed, "réussi", "réussis")}`, q.status !== "PASS"],
    ["Écart avant publication", gapText, !gapOk],
    ["Décision", publishable ? "Publication autorisée" : "Publication bloquée : les indicateurs ne sont pas publiés", !publishable],
  ];
  const proofTable = table([["Rapport", ""], ["Contenu", ""]], proofs.map(([title, detail, negative]) => `<tr><th scope="row">${escapeHtml(title)}</th><td${negative ? ' class="neg"' : ""}>${escapeHtml(detail)}</td></tr>`));

  root.innerHTML = section("Pipeline et contrôles avant publication", "Airflow enchaîne six tâches. La publication n’a lieu que si les contrôles qualité et les rapprochements passent.",
    summary([
      ["Airflow", count(platform.airflow?.tasks, "tâche", "tâches"), `${statusInfo(platform.airflow?.status).label}, ${escapeHtml(platform.airflow?.schedule || "")}`],
      ["dbt build", dbtKnown ? count(dbt.models, "modèle", "modèles") : UNAVAILABLE, dbtKnown ? `${count(dbt.tests, "test", "tests")}, ${count(dbt.snapshots, "snapshot", "snapshots")}` : "rapport absent"],
      ["Contrôles qualité", `${q.passed} sur ${q.total}`, statusInfo(q.status).label, q.status !== "PASS"],
      ["Réconciliation", gapText, gapKnown ? (gapOk ? "aucun écart" : "écart détecté") : "", !gapOk],
    ]), "", "lead")
    + section("Étapes du dernier run", "S3 et Kinesis passent par les API émulées de LocalStack.", steps)
    + section("Chiffres des rapports d’exécution", "Lus dans reports/*.json.", proofTable);
}

/* ---------- Actions ---------- */

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
  showToast(`Stock exporté, ${inlineScopeLabel()}`);
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

// Édition statique : les 12 combinaisons sont précalculées. Sinon, API locale de serve.py.
async function fetchDashboard(channel, period) {
  const embedded = window.RETAIL_CORE_STATIC?.dashboards?.[`${channel}-${period}`];
  if (embedded) return { data: embedded, mode: "démo statique" };
  const response = await fetch(`/api/dashboard?channel=${channel}&period=${period}`, { cache: "no-store" });
  if (!response.ok) throw new Error("API indisponible");
  return { data: await response.json(), mode: "démo locale" };
}

async function loadData(showFeedback = false) {
  const requestId = ++state.requestId;
  state.loading = true;
  document.querySelector("#refresh-data").disabled = true;
  if (!state.data) root.innerHTML = `<p class="loading-state">Chargement du flash…</p>`;
  try {
    // Les sparklines et les écarts lisent la série quotidienne sur 30 jours de chaque rangée.
    const trendKeys = state.channel === "all" ? [...CHANNELS, "all"] : [state.channel];
    const [main, ...trendResults] = await Promise.all([
      fetchDashboard(state.channel, state.period),
      ...trendKeys.map(key => fetchDashboard(key, 30)),
    ]);
    if (requestId !== state.requestId) return;
    state.data = main.data;
    state.mode = main.mode;
    state.trends = Object.fromEntries(trendKeys.map((key, index) => [key, trendResults[index].data.series]));
    document.querySelector("#run-mode").textContent = main.mode.charAt(0).toUpperCase() + main.mode.slice(1);
    document.title = `Retail Core, ${main.mode}`;
    const status = runStatus(main.data);
    const statusNode = document.querySelector("#run-status");
    statusNode.textContent = status.text;
    statusNode.className = `run-status${status.negative ? " neg" : ""}`;
    document.querySelector("#last-run").textContent = runDate(main.data.meta.generated_at);
    document.querySelector("#contract-version").textContent = main.data.meta.data_contract;
    updateScopeUi();
    render();
    if (showFeedback) showToast(globalViews.has(state.view) ? "Dernier run complet relu" : `Périmètre appliqué : ${inlineScopeLabel()}`);
  } catch (error) {
    if (requestId !== state.requestId) return;
    const statusNode = document.querySelector("#run-status");
    statusNode.textContent = "Données indisponibles";
    statusNode.className = "run-status neg";
    root.innerHTML = emptyState("Le flash n’a pas pu être lu.", `Le tableau de bord n’arrive pas à joindre le pipeline. Lancez <code>python3 run_demo.py</code>, puis <code>python3 serve.py</code>.`);
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
