/* Property Administration – reconcile with "Rent Control.xlsx".
 *
 * On start the file is fetched (PC: from the import source folder, OneDrive version: from OneDrive) and a
 * fingerprint of its content is compared with the one stored in the database (setting rent_control_hash).
 * Only if the file has changed it is parsed and compared with the payments / utility settlements in the app.
 * The differences are shown for review – nothing is changed without confirmation.
 * The Excel file itself is NEVER written.
 *
 * Expected layout (sheet "Overview"):
 *   column B  building (merged cell), column C  tenant name / unit (WHG_1_EG, GEW_6G_7H, WHG 1) / row label,
 *   one column per month from D on, header row of each block = month numbers,
 *   "Abrechnungszeitraum YYYY" above the first month (February) of that year.
 */
"use strict";

const RC_NOTE = "imported from Rent Control";
const RC_LABELS = {
  "miete (kalt)": "rent", "nebenkosten vorschuss": "service", "nachzahlung beglichen": "settlement",
  "kaution": "deposit", "nachzahlung fällig": "due",
};

// ---------------------------------------------------------------- helpers
/** content fingerprint (two independent 32-bit FNV-1a variants + length) – works without crypto.subtle (LAN http) */
function rcFingerprint(bytes) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 2246822519);
  }
  return `${bytes.length}-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`;
}

let _xlsxLoading = null;
function rcLoadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return (_xlsxLoading ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "vendor/xlsx.full.min.js";
    s.onload = ok; s.onerror = () => { _xlsxLoading = null; fail(new Error("The Excel reader could not be loaded.")); };
    document.head.appendChild(s);
  }));
}

const rcNorm = (s) => String(s ?? "").toLowerCase().replace(/stra(ß|ss)e|str\./g, "str").replace(/[^a-z0-9äöü]+/g, " ").trim();
const rcCents = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- 1. read the workbook
function rcParse(bytes) {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets.Overview || wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) throw new Error('Rent Control.xlsx: sheet "Overview" not found.');
  const R = XLSX.utils.decode_range(ws["!ref"]);
  const val = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;
  const COL_B = 1, COL_C = 2, FIRST = 3;

  const entries = []; // {building, unit, tenant, label, cat, ym, amount, cell}
  let building = null, tenant = null, block = null, anchor = null; // anchor = {col, ym}
  for (let r = R.s.r; r <= R.e.r; r++) {
    const b = val(r, COL_B), c = val(r, COL_C);
    if (b != null && String(b).trim()) building = String(b).replace(/\s+/g, " ").trim();
    if (typeof c !== "string" || !c.trim()) continue;
    const label = c.trim();
    // "Abrechnungszeitraum YYYY" in the tenant row marks the first month of that year
    for (let col = FIRST; col <= R.e.c; col++) {
      const m = /abrechnungszeitraum\s+(\d{4})/i.exec(String(val(r, col) ?? ""));
      if (m) { anchor = { col, ym: `${m[1]}-02`, row: r }; break; }
    }
    if (/^(WHG|GEW)[\s_]/i.test(label)) {
      // header row of a block: month numbers. The anchor's month number gives the real month.
      if (!anchor) anchor = { col: FIRST, ym: db.settings?.tracking_start || "2025-02" };
      const mAtAnchor = Number(val(r, anchor.col));
      if (mAtAnchor >= 1 && mAtAnchor <= 12) anchor = { col: anchor.col, ym: `${anchor.ym.slice(0, 4)}-${String(mAtAnchor).padStart(2, "0")}` };
      const months = {};
      for (let col = FIRST; col <= R.e.c; col++) {
        const ym = addMonths(anchor.ym, col - anchor.col);
        const n = val(r, col);
        if (typeof n === "number" && n !== Number(ym.slice(5, 7)))
          throw new Error(`Rent Control.xlsx: unexpected month in cell ${XLSX.utils.encode_cell({ r, c: col })} (${n}, expected ${Number(ym.slice(5, 7))}). Was the layout changed?`);
        months[col] = ym;
      }
      block = { building, unit: label, tenant, months };
      continue;
    }
    const cat = RC_LABELS[label.toLowerCase().replace(/\s+/g, " ")];
    if (!cat) { tenant = label; block = null; continue; } // tenant name row
    if (!block) continue;
    for (let col = FIRST; col <= R.e.c; col++) {
      const v = val(r, col);
      if (typeof v === "number" && Math.abs(v) > 0.0049 && block.months[col])
        entries.push({ building: block.building, unit: block.unit, tenant: block.tenant, label, cat, ym: block.months[col], amount: v, cell: XLSX.utils.encode_cell({ r, c: col }) });
    }
  }
  return entries;
}

// ---------------------------------------------------------------- 2. map to buildings / units / leases
function rcBuilding(text) {
  const t = rcNorm(text);
  if (!t) return null;
  const words = t.split(" ");
  const num = words.find((w) => /\d/.test(w));
  return db.buildings.find((b) => {
    const n = rcNorm(b.name);
    return n === t || (n.startsWith(words[0]) && (!num || n.includes(num))) || rcNorm(b.code) === t;
  }) || null;
}
function rcUnits(building, token) {
  const m = /^(WHG|GEW)[\s_]*(.*)$/i.exec(token);
  if (!building || !m) return [];
  const nums = [...m[2].matchAll(/(\d+)/g)].map((x) => Number(x[1]));
  const wanted = m[1].toUpperCase() === "WHG" ? (u) => u.unit_type === "Apartment" : (u) => u.unit_type === "Commercial";
  const firstNum = (u) => Number((/(\d+)/.exec(u.code) || [])[1]);
  // "WHG_01_EG" → only the first number is the flat number; "GEW_6G_7H" → several units
  const list = m[1].toUpperCase() === "WHG" ? nums.slice(0, 1) : nums;
  return list.map((n) => db.units.find((u) => u.building_id === building.id && !u.parent_unit_id && wanted(u) && firstNum(u) === n)).filter(Boolean);
}
/** split an amount over several leases (e.g. GEW 6 + GEW 7 paid together) like the initial import did */
function rcSplit(leases, cat, amount) {
  if (leases.length === 1) return [[leases[0], amount]];
  const w = (l) => ({ rent: (l.cold_rent || 0) + (l.other_charge || 0), service: l.service_charge || 0, deposit: l.deposit || 0 }[cat] ?? 1);
  const total = sum(leases, w);
  let rest = amount;
  return leases.map((l, i) => {
    const part = i === leases.length - 1 ? rcCents(rest) : rcCents(total ? amount * w(l) / total : amount / leases.length);
    rest -= part;
    return [l, part];
  });
}

// ---------------------------------------------------------------- 3. compare with the database
function rcCompare(entries) {
  const want = new Map(); // "lease|month|cat" → {lease_id, month, category, amount, cells}
  const dues = new Map(); // "lease|period" → {lease_id, period_year, amount, first_due_month}
  const unassigned = new Map(); // "where" → {where, months:Set, amount}
  const covered = new Set(); // lease ids that appear in the file
  let minYm = "9999-99", maxYm = "0000-00";
  for (const e of entries) {
    if (e.ym < minYm) minYm = e.ym;
    if (e.ym > maxYm) maxYm = e.ym;
    const b = rcBuilding(e.building);
    const units = rcUnits(b, e.unit);
    // the lease active in that month – or, outside any lease period (e.g. payments before the lease start),
    // the lease the payment is already booked on in the program
    const leases = units.map((u) => db.leases.filter((l) => l.unit_id === u.id && leaseActiveInMonth(l, e.ym)).sort((x, y) => y.start_date.localeCompare(x.start_date))[0]
      || byId("leases", db.payments.find((p) => p.month === e.ym && p.category === e.cat && byId("leases", p.lease_id)?.unit_id === u.id)?.lease_id));
    if (!units.length || leases.some((l) => !l)) {
      const why = !b ? "building not found" : !units.length ? "unit not found" : "no lease for this period (former tenant?)";
      const key = `${e.building} · ${e.unit} · ${e.label}|${why}`;
      const u = unassigned.get(key) || { where: `${b ? b.name : e.building} · ${units.map((x) => x.code).join(" + ") || e.unit}`, label: e.label, why, months: [], amount: 0 };
      u.months.push(e.ym); u.amount += e.amount;
      unassigned.set(key, u);
      continue;
    }
    leases.forEach((l) => covered.add(l.id));
    if (e.cat === "due") {
      const l = leases[0];
      const key = `${l.id}|${Number(e.ym.slice(0, 4)) - 1}`;
      const d = dues.get(key) || { lease_id: l.id, period_year: Number(e.ym.slice(0, 4)) - 1, amount: 0, first_due_month: e.ym, cells: [] };
      d.amount = rcCents(d.amount + e.amount); d.cells.push(e.cell);
      dues.set(key, d);
      continue;
    }
    for (const [l, part] of rcSplit(leases, e.cat, e.amount)) {
      const key = `${l.id}|${e.ym}|${e.cat}`;
      const w = want.get(key) || { lease_id: l.id, month: e.ym, category: e.cat, amount: 0, cells: [] };
      w.amount = rcCents(w.amount + part); w.cells.push(e.cell);
      want.set(key, w);
    }
  }

  const changes = { add: [], update: [], remove: [], dueAdd: [], dueUpdate: [], onlyInApp: [], unassigned: [...unassigned.values()], range: [minYm, maxYm] };
  const have = new Map(db.payments.map((p) => [`${p.lease_id}|${p.month}|${p.category}`, p]));
  for (const [key, w] of want) {
    const p = have.get(key);
    if (!p) changes.add.push(w);
    else if (Math.abs(Number(p.amount) - w.amount) > 0.004) changes.update.push({ ...w, id: p.id, old: Number(p.amount) });
  }
  for (const p of db.payments) {
    if (want.has(`${p.lease_id}|${p.month}|${p.category}`) || !covered.has(p.lease_id) || p.month < minYm || p.month > maxYm) continue;
    if ((p.notes || "").includes(RC_NOTE)) changes.remove.push(p); // was imported from the file, now gone there
    else changes.onlyInApp.push(p); // entered in the app – never touched
  }
  for (const d of dues.values()) {
    const s = db.settlements.find((x) => x.lease_id === d.lease_id && Number(x.period_year) === d.period_year);
    if (!s) changes.dueAdd.push(d);
    else if (Math.abs(Number(s.amount) - d.amount) > 0.004) changes.dueUpdate.push({ ...d, id: s.id, old: Number(s.amount) });
  }
  const order = (a, b) => cmpLeasesByUnit(byId("leases", a.lease_id), byId("leases", b.lease_id)) || a.month?.localeCompare(b.month) || 0;
  ["add", "update", "remove", "onlyInApp"].forEach((k) => changes[k].sort(order));
  changes.count = changes.add.length + changes.update.length + changes.remove.length + changes.dueAdd.length + changes.dueUpdate.length;
  return changes;
}

// ---------------------------------------------------------------- 4. flow on start / on demand
async function rcRemember(hash) {
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const local = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  db.settings = await api("PUT", "settings", { rent_control_hash: hash, rent_control_read: local });
}

/** auto = called on program start: silent if the file is missing or unchanged */
async function rentControlCheck({ auto = false, force = false } = {}) {
  if (!Backend.rentControlFile) return;
  let bytes;
  try { bytes = await Backend.rentControlFile(); }
  catch (e) { if (!auto) toast(e.message, true); return; }
  if (!bytes) { if (!auto) toast("Rent Control.xlsx was not found – check the path under Settings.", true); return; }
  const hash = rcFingerprint(bytes);
  if (!force && hash === (db.settings?.rent_control_hash || "")) {
    if (!auto) toast("Rent Control.xlsx has not changed since it was last read.");
    return;
  }
  let changes;
  try {
    await rcLoadXlsx();
    changes = rcCompare(rcParse(bytes));
  } catch (e) { toast(e.message, true); return; }
  if (!changes.count) {
    await rcRemember(hash);
    toast(auto ? "Rent Control.xlsx was updated – all payments already match." : "Rent Control.xlsx read – all payments match.");
    if (!auto) render();
    return;
  }
  rcReview(changes, hash);
}

function rcReview(ch, hash) {
  drawerStack.length = 0;
  const lease = (id) => byId("leases", id);
  const who = (id) => { const l = lease(id); return `${esc(unitLabel(byId("units", l.unit_id)))} <span class="muted">· ${esc(tenantName(byId("tenants", l.tenant_id)))}</span>`; };
  const cb = (kind, i) => `<input type="checkbox" class="rc-pick" data-kind="${kind}" data-i="${i}" checked>`;
  const table = (title, kind, rows, cols, note = "") => rows.length ? `
    <h3 class="rc-h">${title} <span class="muted">(${rows.length})</span></h3>${note ? `<p class="muted">${note}</p>` : ""}
    <div class="table-wrap"><table class="compact"><thead><tr>${kind ? `<th><input type="checkbox" class="rc-all" data-kind="${kind}" checked></th>` : ""}${cols.map((c) => `<th class="${c[2] || ""}">${c[0]}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr>${kind ? `<td>${cb(kind, i)}</td>` : ""}${cols.map((c) => `<td class="${c[2] || ""}">${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
  const unit = ["Unit / tenant", (r) => who(r.lease_id)];
  const month = ["Month", (r) => fmtMonth(r.month)];
  const cat = ["Category", (r) => esc(CATEGORIES[r.category] || r.category)];

  $("#drawer").classList.add("wide");
  $("#drawerTitle").textContent = "Rent Control.xlsx has changed";
  $("#drawerBody").innerHTML = `
    <p>The Excel file was changed since it was last read. These differences to the payments in the program were found
      (${fmtMonth(ch.range[0])} – ${fmtMonth(ch.range[1])}). Untick anything you do not want to take over.
      <br><span class="muted">The Excel file itself is only read, never changed.</span></p>
    ${table("New payments", "add", ch.add, [unit, month, cat, ["Amount", (r) => fmtMoney(r.amount), "num"]])}
    ${table("Changed amounts", "update", ch.update, [unit, month, cat, ["In the program", (r) => fmtMoney(r.old), "num"], ["In Excel", (r) => `<strong>${fmtMoney(r.amount)}</strong>`, "num"]])}
    ${table("No longer in Rent Control – delete", "remove", ch.remove, [unit, month, cat, ["Amount", (r) => fmtMoney(r.amount), "num"]],
      "These payments were imported from Rent Control earlier but are no longer listed in the file.")}
    ${table("Utility settlements due (Nachzahlung fällig)", "due", [...ch.dueAdd.map((d) => ({ ...d, isNew: true })), ...ch.dueUpdate],
      [unit, ["Period", (r) => r.period_year], ["Due", (r) => fmtMonth(r.first_due_month)], ["In the program", (r) => (r.isNew ? '<span class="pill grey">new</span>' : fmtMoney(r.old)), "num"], ["In Excel", (r) => `<strong>${fmtMoney(r.amount)}</strong>`, "num"]])}
    ${ch.onlyInApp.length ? `<details class="rc-info"><summary>${ch.onlyInApp.length} payment(s) entered in the program are not in the Excel file – they stay unchanged</summary>
      ${table("", null, ch.onlyInApp, [unit, month, cat, ["Amount", (r) => fmtMoney(r.amount), "num"]])}</details>` : ""}
    ${ch.unassigned.length ? `<details class="rc-info"><summary>${ch.unassigned.length} row(s) in the Excel file cannot be assigned to a lease – they are ignored</summary>
      ${table("", null, ch.unassigned, [["Excel block", (u) => esc(u.where)], ["Row", (u) => esc(u.label)], ["Months", (u) => `${fmtMonth(u.months[0])}${u.months.length > 1 ? " – " + fmtMonth(u.months[u.months.length - 1]) : ""} <span class="muted">(${u.months.length})</span>`], ["Reason", (u) => esc(u.why)], ["Total", (u) => fmtMoney(u.amount), "num"]])}</details>` : ""}`;
  $("#drawerFoot").innerHTML = `
    <button class="btn" id="rcLater" title="Ask again on the next start">Later</button>
    <button class="btn" id="rcIgnore" title="Do not ask again until the Excel file changes">Ignore this version</button>
    <button class="btn primary" id="rcApply">${icon("check", 18)} Apply <span id="rcN"></span></button>`;
  const picks = () => [...$("#drawerBody").querySelectorAll(".rc-pick:checked")];
  const upd = () => { $("#rcN").textContent = `(${picks().length})`; $("#rcApply").disabled = !picks().length; };
  $("#drawerBody").querySelectorAll(".rc-all").forEach((a) => (a.onchange = () => {
    $("#drawerBody").querySelectorAll(`.rc-pick[data-kind="${a.dataset.kind}"]`).forEach((x) => (x.checked = a.checked)); upd();
  }));
  $("#drawerBody").querySelectorAll(".rc-pick").forEach((x) => (x.onchange = upd));
  upd();
  $("#rcLater").onclick = closeDrawer;
  $("#rcIgnore").onclick = async () => { await rcRemember(hash); closeDrawer(); toast("This version of Rent Control.xlsx will not be asked again."); };
  $("#rcApply").onclick = async () => {
    $("#rcApply").disabled = true;
    const dueRows = [...ch.dueAdd.map((d) => ({ ...d, isNew: true })), ...ch.dueUpdate];
    const lists = { add: ch.add, update: ch.update, remove: ch.remove, due: dueRows };
    let done = 0, failed = [];
    const todo = picks();
    for (const x of todo) {
      $("#rcN").textContent = `… ${done + failed.length + 1} / ${todo.length}`;
      const r = lists[x.dataset.kind][Number(x.dataset.i)];
      try {
        if (x.dataset.kind === "add") await api("POST", "payments", { lease_id: r.lease_id, month: r.month, category: r.category, amount: r.amount, notes: RC_NOTE });
        else if (x.dataset.kind === "update") await api("PUT", `payments/${r.id}`, { amount: r.amount });
        else if (x.dataset.kind === "remove") await api("DELETE", `payments/${r.id}`);
        else if (r.isNew) await api("POST", "settlements", { lease_id: r.lease_id, period_year: r.period_year, amount: r.amount, first_due_month: r.first_due_month, installments: 1, notes: RC_NOTE });
        else await api("PUT", `settlements/${r.id}`, { amount: r.amount });
        done++;
      } catch (e) { failed.push(e.message); }
    }
    if (!failed.length) await rcRemember(hash);
    await loadAll();
    closeDrawer(); render();
    toast(failed.length ? `${done} change(s) applied, ${failed.length} failed: ${failed[0]}` : `${done} change(s) from Rent Control.xlsx applied`, !!failed.length);
  };
  showDrawer();
}
