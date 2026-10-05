const state = { view: "overview", channel: "all", period: 30, data: null, trends: null, mode: "démo statique", loading: false, requestId: 0, flashDay: null, playTimer: null };
const Flash = window.RetailFlash;
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

const signedPercent = (current, reference) => Flash.signedPercent(current, reference);
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

const PLAY_STEP_MS = 1500;

function flashBounds() { return Flash.bounds(state.data.meta.generated_at); }
function currentFlashDay(b) {
  const day = state.flashDay;
  return day && day >= b.firstSnapshot && day <= b.lastFull ? day : b.lastFull;
}
function trendKeysFor(channel) { return channel === "all" ? [...CHANNELS, "all"] : [channel, "all"]; }

// Ordre des rangées fixe : rien ne saute de ligne quand on change de jour.
function flashRows(day, b) {
  const keys = state.channel === "all" ? CHANNELS : [state.channel];
  const rows = keys.map(key => ({ key, label: channelLabel(key), total: false, ...Flash.row(state.trends[key], day, state.period, b) }));
  const all = { key: "all", label: "Tous canaux", total: true, ...Flash.row(state.trends.all, day, state.period, b) };
  return { rows: state.channel === "all" ? [...rows, all] : rows, all };
}

function sparkline(row, day, b) {
  const points = Flash.dailyValues(state.trends[row.key], b.firstFull, b.lastFull);
  if (points.length < 2) return `<span class="muted">–</span>`;
  const width = 150, height = 30, pad = 3;
  const max = Math.max(...points.map(p => p.revenue), 1);
  const x = i => pad + i * (width - 2 * pad) / (points.length - 1);
  const y = v => height - pad - (v / max) * (height - 2 * pad);
  const at = Flash.daysBetween(b.firstFull, day);
  const from = Flash.daysBetween(b.firstFull, row.from);
  const low = points.reduce((a, c) => (c.revenue < a.revenue ? c : a));
  const high = points.reduce((a, c) => (c.revenue > a.revenue ? c : a));
  const label = `${row.label}, chiffre d’affaires quotidien du ${dayLabel(b.firstFull)} au ${dayLabel(b.lastFull)} : minimum ${euro.format(low.revenue)} le ${dayLabel(low.day)}, maximum ${euro.format(high.revenue)} le ${dayLabel(high.day)}, ${euro.format(points[at].revenue)} le ${dayLabel(day)}, jour du flash. Flèches pour lire un autre jour, Entrée pour y placer le flash.`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" tabindex="0" role="img" data-key="${row.key}" data-index="${at}" aria-label="${escapeHtml(label)}">`
    + `<rect class="spark-window" x="${x(from).toFixed(1)}" y="0" width="${Math.max(1, x(at) - x(from)).toFixed(1)}" height="${height}"/>`
    + `<line class="spark-base" x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}"/>`
    + `<polyline points="${points.map((p, i) => `${x(i).toFixed(1)},${y(p.revenue).toFixed(1)}`).join(" ")}"/>`
    + `<line class="spark-day" x1="${x(at).toFixed(1)}" x2="${x(at).toFixed(1)}" y1="0" y2="${height}"/>`
    + `<circle cx="${x(at).toFixed(1)}" cy="${y(points[at].revenue).toFixed(1)}" r="2.4"/>`
    + `<line class="spark-hover" x1="0" x2="0" y1="0" y2="${height}" visibility="hidden"/></svg>`;
}

function dailyTable(rows, day, b) {
  const days = Flash.dailyValues(state.trends.all, b.firstFull, b.lastFull).map(p => p.day);
  const columns = rows.map(row => ({ label: row.label, values: new Map(Flash.dailyValues(state.trends[row.key], b.firstFull, b.lastFull).map(p => [p.day, p])) }));
  const body = days.slice().reverse().map(iso => `<tr${iso === day ? ' class="current" aria-current="date"' : ""}><th scope="row">${dayLabel(iso)}</th>${columns.map(col => `<td class="r">${euro.format(col.values.get(iso).revenue)}</td><td class="r">${integer.format(col.values.get(iso).orders)}</td>`).join("")}</tr>`);
  const head = [["Jour", ""], ...columns.flatMap(col => [[`${escapeHtml(col.label)}, CA`, "r"], ["commandes", "r"]])];
  return `<details class="daily"><summary>Valeurs quotidiennes en tableau, du ${dayLabel(b.firstFull)} au ${dayLabel(b.lastFull)}</summary>${table(head, body, { caption: "Chiffre d’affaires et commandes par jour" })}</details>`;
}

function flashBody(d) {
  const b = flashBounds();
  const day = currentFlashDay(b);
  const { rows, all } = flashRows(day, b);
  const headers = [
    ["Canal", ""],
    ["Chiffre d’affaires", "r"],
    ["Commandes", "r"],
    ["Panier moyen", "r"],
    ["Part du CA", "r"],
    ["7 j vs 7 j préc.", "r"],
    [`CA du ${dayLabel(day)}`, "r"],
    [`vs ${dayLabel(all.comparisonDay)}`, "r"],
    ["CA quotidien", "spark-col"],
  ];
  const body = rows.map(row => {
    const week = signedPercent(row.weekRevenue, row.previousWeekRevenue);
    const sameDay = signedPercent(row.dayRevenue, row.previousDayRevenue);
    return `<tr${row.total ? ' class="total"' : ""}><th scope="row">${escapeHtml(row.label)}</th><td class="r">${euro.format(row.revenue)}</td><td class="r">${integer.format(row.orders)}</td><td class="r">${row.basket === null ? "–" : euroCents.format(row.basket)}</td><td class="r">${share(row.revenue, all.revenue)}</td><td class="r${week.negative ? " neg" : ""}">${week.text}</td><td class="r">${euro.format(row.dayRevenue)}</td><td class="r${sameDay.negative ? " neg" : ""}">${sameDay.text}</td><td class="spark-col">${sparkline(row, day, b)}</td></tr>`;
  });
  const cutTime = new Date(d.meta.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
  const note = `Cumuls sur ${count(all.days, "jour complet", "jours complets")}, du ${dayLabel(all.from, "long")} au ${dayLabel(day, "long")}. Écarts : semaine close ce jour contre la précédente, et jour contre le ${dayLabel(all.comparisonDay, "long")}.`;
  const method = `<details class="method"><summary>Méthode de calcul</summary><p>Les journées partielles du ${dayLabel(Flash.addDays(b.firstFull, -1))} et du ${dayLabel(b.endIso)} (arrêtée à ${cutTime}) sont exclues des cumuls et des courbes. Le curseur commence au ${dayLabel(b.firstSnapshot)}, premier jour qui a ses 13 jours d’historique pour les écarts. Il ne déplace que ce tableau : les blocs suivants portent sur ${inlineScopeLabel()}.</p></details>`;
  return `<p class="note">${note}</p>${method}${table(headers, body, { className: "flash", caption: `Flash ventes par canal au ${dayLabel(day, "long")}` })}`
    + `<p class="spark-readout" id="spark-readout" aria-live="polite">Survolez ou touchez une courbe, ou parcourez-la au clavier, pour lire un jour ; un clic ou Entrée y place le flash.</p>`
    + dailyTable(rows, day, b);
}

function flashSection(d) {
  const b = flashBounds();
  const day = currentFlashDay(b);
  const index = Flash.daysBetween(b.firstSnapshot, day);
  const controls = `<div class="flash-controls">
    <label class="flash-label" for="flash-day">Jour du flash <output id="flash-day-out" for="flash-day">${dayLabel(day, "long")}</output></label>
    <div class="flash-range"><input type="range" id="flash-day" min="0" max="${b.snapshots - 1}" step="1" value="${index}" aria-valuetext="${dayLabel(day, "long")}" /><div class="range-ends" aria-hidden="true"><span>${dayLabel(b.firstSnapshot)}</span><span>${dayLabel(b.lastFull)}</span></div></div>
    <button type="button" class="button primary" id="flash-play">${state.playTimer ? "Pause" : state.playPaused ? "Reprendre" : "Rejouer jour par jour"}</button>
    <button type="button" class="button" id="flash-reset">Réinitialiser</button>
    <p class="visually-hidden" id="flash-live" aria-live="polite"></p>
  </div>`;
  return `<section class="block lead"><div class="block-head"><h2 id="flash-title">Flash ventes au ${dayLabel(day, "long")}</h2></div>${controls}<div id="flash-body">${flashBody(d)}</div></section>`;
}

function announceFlash(day) {
  const b = flashBounds();
  const { all } = flashRows(day, b);
  const week = signedPercent(all.weekRevenue, all.previousWeekRevenue);
  document.querySelector("#flash-live").textContent = `Flash au ${dayLabel(day, "long")} : tous canaux ${euro.format(all.revenue)}, semaine ${week.text} contre la précédente.`;
}

function setFlashDay(day, { announce = false } = {}) {
  const b = flashBounds();
  state.flashDay = day === b.lastFull ? null : day;
  const shown = currentFlashDay(b);
  const slider = document.querySelector("#flash-day");
  if (!slider) return;
  slider.value = String(Flash.daysBetween(b.firstSnapshot, shown));
  slider.setAttribute("aria-valuetext", dayLabel(shown, "long"));
  document.querySelector("#flash-day-out").textContent = dayLabel(shown, "long");
  document.querySelector("#flash-title").textContent = `Flash ventes au ${dayLabel(shown, "long")}`;
  document.querySelector("#flash-body").innerHTML = flashBody(state.data);
  bindSparklines();
  if (announce) announceFlash(shown);
}

function stopReplay({ paused = false } = {}) {
  clearInterval(state.playTimer);
  state.playTimer = null;
  state.playPaused = paused;
  const button = document.querySelector("#flash-play");
  if (button) button.textContent = paused ? "Reprendre" : "Rejouer jour par jour";
}

function toggleReplay() {
  const b = flashBounds();
  if (state.playTimer) {
    stopReplay({ paused: true });
    announceFlash(currentFlashDay(b));
    return;
  }
  if (!state.playPaused || currentFlashDay(b) >= b.lastFull) setFlashDay(b.firstSnapshot, { announce: true });
  state.playPaused = false;
  document.querySelector("#flash-play").textContent = "Pause";
  state.playTimer = setInterval(() => {
    const next = Flash.addDays(currentFlashDay(b), 1);
    setFlashDay(next);
    if (next >= b.lastFull) {
      stopReplay();
      announceFlash(next);
    }
  }, PLAY_STEP_MS);
}

function bindSparklines() {
  const readout = document.querySelector("#spark-readout");
  const b = flashBounds();
  document.querySelectorAll("svg.spark").forEach(svg => {
    const key = svg.dataset.key;
    const points = Flash.dailyValues(state.trends[key], b.firstFull, b.lastFull);
    const hover = svg.querySelector(".spark-hover");
    const show = index => {
      const i = Math.max(0, Math.min(points.length - 1, index));
      svg.dataset.index = String(i);
      const x = 3 + i * (150 - 6) / (points.length - 1);
      hover.setAttribute("x1", x.toFixed(1));
      hover.setAttribute("x2", x.toFixed(1));
      hover.setAttribute("visibility", "visible");
      const p = points[i];
      const placeable = p.day >= b.firstSnapshot;
      readout.textContent = `${key === "all" ? "Tous canaux" : channelLabel(key)}, ${dayLabel(p.day, "long")} : ${euro.format(p.revenue)}, ${count(p.orders, "commande", "commandes")}.${placeable ? "" : ` Pas d’instantané ce jour-là : les écarts demandent ${count(13, "jour", "jours")} d’historique.`}`;
      return p;
    };
    const indexAt = event => {
      const box = svg.getBoundingClientRect();
      return Math.round(((event.clientX - box.left) / box.width * 150 - 3) / (150 - 6) * (points.length - 1));
    };
    const place = p => {
      if (p.day < b.firstSnapshot) return;
      stopReplay({ paused: Boolean(state.playTimer) || state.playPaused });
      setFlashDay(p.day, { announce: true });
    };
    svg.addEventListener("pointermove", event => show(indexAt(event)));
    svg.addEventListener("pointerdown", event => show(indexAt(event)));
    svg.addEventListener("pointerleave", () => hover.setAttribute("visibility", "hidden"));
    svg.addEventListener("click", event => place(show(indexAt(event))));
    svg.addEventListener("focus", () => show(Number(svg.dataset.index)));
    svg.addEventListener("blur", () => hover.setAttribute("visibility", "hidden"));
    svg.addEventListener("keydown", event => {
      const current = Number(svg.dataset.index);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        show(current + (event.key === "ArrowLeft" ? -1 : 1));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        place(points[current]);
      }
    });
  });
}

function bindFlashControls() {
  const b = flashBounds();
  document.querySelector("#flash-day").addEventListener("input", event => {
    if (state.playTimer) stopReplay({ paused: true });
    setFlashDay(Flash.addDays(b.firstSnapshot, Number(event.target.value)), { announce: true });
  });
  document.querySelector("#flash-play").addEventListener("click", toggleReplay);
  document.querySelector("#flash-reset").addEventListener("click", () => {
    stopReplay();
    setFlashDay(b.lastFull, { announce: true });
  });
  bindSparklines();
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
  root.innerHTML = flashSection(d)
    + `<div class="pair">${section("Catégories", `Sept premières catégories, ${inlineScopeLabel()}.`, categoriesTable(d))}${section("Rapprochements", `Seuil : aucune unité et moins d’un centime d’écart, ${inlineScopeLabel()}.`, reconciliationTable(d.reconciliation))}</div>`
    + `<div class="pair">${section("Stock", "Instantané du réseau ; seule la demande suit les filtres.", stockTable(d), `<button type="button" class="link-button" data-view-jump="inventory">Détail par produit</button>`)}${section("Latence du flux", "Événements Kinesis rapprochés des commandes.", latencyTable(d))}</div>`
    + section("Contrôles qualité", "Ils portent sur le run complet, hors filtres.", qualityTable(d), `<button type="button" class="link-button" data-view-jump="reliability">Étapes du run</button>`);
  bindFlashControls();
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
  stopReplay({ paused: false });
  state.loading = true;
  document.querySelector("#refresh-data").disabled = true;
  if (!state.data) root.innerHTML = `<p class="loading-state">Chargement du flash…</p>`;
  try {
    // Les sparklines et les écarts lisent la série quotidienne sur 30 jours de chaque rangée.
    const trendKeys = trendKeysFor(state.channel);
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
  stopReplay({ paused: false });
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
