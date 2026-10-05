// Tests du recalcul du flash (node --test tests/flash.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const Flash = require("../dashboard/flash.js");

// Série publiée fictive : génération le 8 sept. à 19 h, commandes du 10 août (partiel) au 8 sept. (partiel).
const GENERATED_AT = "2026-09-08T19:11:25+00:00";
const series = [];
for (let i = 0; i < 30; i += 1) {
  const day = Flash.addDays("2026-08-10", i);
  if (day === "2026-09-04") continue; // un jour sans vente
  series.push({ day, revenue: 100 + i, orders: 1 + (i % 3) });
}
const valueOf = day => series.find(item => item.day === day)?.revenue ?? 0;

test("bornes : seuls les jours complets ayant 13 jours d'historique sont proposés", () => {
  const b = Flash.bounds(GENERATED_AT);
  assert.equal(b.firstFull, "2026-08-11");
  assert.equal(b.lastFull, "2026-09-07");
  assert.equal(b.firstSnapshot, "2026-08-24");
  assert.equal(b.snapshots, 15);
});

test("valeurs quotidiennes : un jour sans vente vaut zéro", () => {
  const days = Flash.dailyValues(series, "2026-09-03", "2026-09-05");
  assert.deepEqual(days.map(d => d.revenue), [124, 0, 126]);
});

test("déplacer le jour du flash recalcule cumul, semaine et même jour S-1", () => {
  const b = Flash.bounds(GENERATED_AT);
  const day = "2026-08-30";
  const row = Flash.row(series, day, 7, b);
  const sum = (from, to) => Flash.dailyValues(series, from, to).reduce((t, d) => t + d.revenue, 0);
  assert.equal(row.from, "2026-08-24");
  assert.equal(row.revenue, sum("2026-08-24", "2026-08-30"));
  assert.equal(row.weekRevenue, row.revenue);
  assert.equal(row.previousWeekRevenue, sum("2026-08-17", "2026-08-23"));
  assert.equal(row.dayRevenue, valueOf(day));
  assert.equal(row.previousDayRevenue, valueOf("2026-08-23"));
  assert.equal(row.comparisonDay, "2026-08-23");

  const later = Flash.row(series, "2026-09-07", 7, b);
  assert.notEqual(later.revenue, row.revenue);
  assert.equal(later.dayRevenue, valueOf("2026-09-07"));
});

test("le cumul sur 30 jours est borné au premier jour complet et l'indique", () => {
  const b = Flash.bounds(GENERATED_AT);
  const row = Flash.row(series, "2026-09-07", 30, b);
  assert.equal(row.from, "2026-08-11");
  assert.equal(row.days, 28);
  assert.equal(row.clipped, true);
  assert.equal(Flash.row(series, "2026-09-07", 14, b).clipped, false);
});

test("panier moyen = CA / commandes, vide sans commande", () => {
  const b = Flash.bounds(GENERATED_AT);
  const row = Flash.row(series, "2026-09-07", 7, b);
  assert.equal(row.basket, Math.round(row.revenue / row.orders * 100) / 100);
  assert.equal(Flash.row([], "2026-09-07", 7, b).basket, null);
});

test("la somme des canaux égale la rangée tous canaux", () => {
  const b = Flash.bounds(GENERATED_AT);
  const web = series.map(d => ({ ...d, revenue: d.revenue * 0.6, orders: d.orders }));
  const store = series.map(d => ({ ...d, revenue: d.revenue * 0.4, orders: d.orders }));
  const all = series.map(d => ({ ...d, revenue: d.revenue, orders: d.orders * 2 }));
  const day = "2026-09-01";
  const rows = [web, store].map(s => Flash.row(s, day, 14, b));
  const total = Flash.row(all, day, 14, b);
  assert.ok(Math.abs(rows[0].revenue + rows[1].revenue - total.revenue) < 0.02);
  assert.equal(rows[0].orders + rows[1].orders, total.orders);
});

test("écarts en texte : signe moins typographique, virgule, espace fine, n.d.", () => {
  assert.equal(Flash.signedPercent(103.2, 100).text, "+3,2 %");
  const negative = Flash.signedPercent(98.6, 100);
  assert.equal(negative.text, "−1,4 %");
  assert.equal(negative.negative, true);
  assert.equal(Flash.signedPercent(100, 100).text, "0,0 %");
  assert.equal(Flash.signedPercent(5, 0).text, "n.d.");
});
