// Calcul du flash ventes pour un jour donné, à partir des séries quotidiennes publiées
// (build_dashboard(..., 30)["series"]). Partagé par le navigateur et par les tests node.
(function (root) {
  const NNBSP = " ";
  const MINUS = "−";
  const oneDecimal = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Dates civiles AAAA-MM-JJ, calculées en UTC pour éviter tout décalage de fuseau.
  function addDays(iso, days) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86400000);
  }

  // src/generate_data.py place les commandes entre « génération − 29 jours » et « génération » :
  // le premier et le dernier jour de la série sont donc partiels. Restent 28 jours complets.
  // Un instantané n'est proposé que si toutes ses colonnes sont calculables, y compris
  // « 7 j contre 7 j précédents », qui remonte 13 jours avant le jour choisi.
  function bounds(generatedAt) {
    const endIso = generatedAt.slice(0, 10);
    const firstFull = addDays(endIso, -28);
    const lastFull = addDays(endIso, -1);
    const firstSnapshot = addDays(firstFull, 13);
    return { endIso, firstFull, lastFull, firstSnapshot, snapshots: daysBetween(firstSnapshot, lastFull) + 1 };
  }

  // Valeurs quotidiennes de fromIso à toIso inclus ; un jour sans vente vaut zéro.
  function dailyValues(series, fromIso, toIso) {
    const byDay = new Map((series || []).map(item => [item.day, item]));
    const length = daysBetween(fromIso, toIso) + 1;
    return Array.from({ length: Math.max(0, length) }, (_, index) => {
      const day = addDays(fromIso, index);
      const item = byDay.get(day);
      return { day, revenue: item ? Number(item.revenue) : 0, orders: item ? Number(item.orders) : 0 };
    });
  }

  const round2 = value => Math.round(value * 100) / 100;
  const total = (items, key) => round2(items.reduce((sum, item) => sum + item[key], 0));

  // Une rangée du flash au jour `day` : cumul sur `period` jours complets se terminant ce jour
  // (borné au premier jour complet), écart de la semaine close ce jour contre la précédente,
  // et écart du jour contre le même jour de la semaine précédente.
  function row(series, day, period, b) {
    const from = addDays(day, -(period - 1)) < b.firstFull ? b.firstFull : addDays(day, -(period - 1));
    const window = dailyValues(series, from, day);
    const revenue = total(window, "revenue");
    const orders = total(window, "orders");
    const week = dailyValues(series, addDays(day, -6), day);
    const previousWeek = dailyValues(series, addDays(day, -13), addDays(day, -7));
    const sameDay = dailyValues(series, day, day)[0];
    const previousSameDay = dailyValues(series, addDays(day, -7), addDays(day, -7))[0];
    return {
      from, to: day, days: window.length, clipped: from !== addDays(day, -(period - 1)),
      revenue, orders, basket: orders ? round2(revenue / orders) : null,
      weekRevenue: total(week, "revenue"), previousWeekRevenue: total(previousWeek, "revenue"),
      dayRevenue: sameDay.revenue, previousDayRevenue: previousSameDay.revenue,
      comparisonDay: addDays(day, -7),
    };
  }

  // Écart signé : « + » ou signe moins typographique, une décimale, espace fine avant %.
  function signedPercent(current, reference) {
    const finite = value => typeof value === "number" && Number.isFinite(value);
    if (!finite(current) || !finite(reference) || reference === 0) return { text: "n.d.", negative: false, value: null };
    const value = Math.round((current - reference) / reference * 1000) / 10;
    if (value === 0) return { text: `0,0${NNBSP}%`, negative: false, value: 0 };
    return { text: `${value > 0 ? "+" : MINUS}${oneDecimal.format(Math.abs(value))}${NNBSP}%`, negative: value < 0, value };
  }

  const api = { addDays, daysBetween, bounds, dailyValues, row, signedPercent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RetailFlash = api;
})(typeof window !== "undefined" ? window : globalThis);
