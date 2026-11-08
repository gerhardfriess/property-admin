/* Property Administration – frontend (vanilla JS). Data access goes through `Backend` (see backend.js):
 * on the PC it talks to server.py, in the browser/iPhone version it works directly on the OneDrive database. */
"use strict";

// ---------------------------------------------------------------- data & API
const db = { buildings: [], units: [], meters: [], meter_readings: [], tenants: [], leases: [], payments: [], settlements: [], reminders: [], attachments: [],
  unit_rooms: [], documents: [], keys: [], key_handovers: [], waste_bins: [], checklist: [], settings: {} };

let Backend = null; // ServerBackend (PC) or LocalBackend (OneDrive) – chosen in boot()
async function api(method, path, body) { return Backend.api(method, path, body); }
async function loadAll() { Object.assign(db, await api("GET", "all")); }

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const fmtMoney = (v) => (v == null || v === "" ? "–" : money.format(Number(v)));
const fmtAmt = (v) => Number(v).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 });
const fmtNum = (v, d = 0) => (v == null || v === "" ? "–" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d || 3 }));
const fmtDate = (iso) => { if (!iso) return "–"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const thisMonth = () => today().slice(0, 7);
const byId = (table, id) => db[table].find((r) => r.id === Number(id));
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const round2 = (v) => Math.round(v * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "–");
const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const monthsBetween = (a, b) => { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; };

function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}
const leaseTotal = (l) => (Number(l.cold_rent) || 0) + (Number(l.service_charge) || 0) + (Number(l.heating_charge) || 0) + (Number(l.other_charge) || 0);
const leaseActiveBetween = (l, from, to) => l.start_date <= to && (!l.end_date || l.end_date >= from);
const leaseActiveOn = (l, d) => leaseActiveBetween(l, d, d);
const leaseActiveInMonth = (l, ym) => { const [a, b] = monthBounds(ym); return leaseActiveBetween(l, a, b); };
const leasesInMonth = (ym) => db.leases.filter((l) => leaseActiveInMonth(l, ym));
const currentLease = (unitId, d = today()) => db.leases.filter((l) => l.unit_id === unitId && leaseActiveOn(l, d)).sort((a, b) => b.start_date.localeCompare(a.start_date))[0];

const tenantName = (t) => {
  if (!t) return "–";
  let n = [t.first_name, t.last_name].filter(Boolean).join(" ");
  if (t.co_tenant) n = n ? `${n} and ${t.co_tenant}` : t.co_tenant;
  return t.company ? (n ? `${t.company} (${n})` : t.company) : n;
};
const buildingName = (b) => (b ? (b.name || `${b.street || ""} ${b.house_no || ""}`.trim() || b.code) : "–");
const buildingLabel = buildingName;
const buildingShort = buildingName;
const unitLabel = (u, withBuilding = true) => { if (!u) return "–"; const b = byId("buildings", u.building_id); return (withBuilding && b ? buildingName(b) + " · " : "") + u.code + (u.unit_type ? ` (${u.unit_type})` : ""); };
const lastReading = (m) => db.meter_readings.filter((r) => r.meter_id === m.id).reduce((a, r) => (!a || r.reading_date > a.reading_date ? r : a), null);
/** document icon when the last reading has a photo or the meter has photos/files attached ("" otherwise) */
function meterDocIcon(m) {
  const l = lastReading(m);
  const nr = l ? attachmentsOf("meter_readings", l.id).length : 0, nm = attachmentsOf("meters", m.id).length;
  if (!nr && !nm) return "";
  const tip = [nr ? `${nr} photo${nr > 1 ? "s" : ""} with the last reading` : "", nm ? `${nm} file${nm > 1 ? "s" : ""}/photo${nm > 1 ? "s" : ""} on the meter` : ""].filter(Boolean).join(" · ");
  return `<span class="doc-ind" title="${esc(tip)}">${icon("file", 16)}</span>`;
}
const leaseLabel = (l) => (l ? `${unitLabel(byId("units", l.unit_id))} – ${tenantName(byId("tenants", l.tenant_id))}` : "–");
const leaseShort = (l) => (l ? `${tenantName(byId("tenants", l.tenant_id))} · ${byId("units", l.unit_id)?.code || "?"}` : "–");
const RENTABLE = ["Apartment", "Commercial", "House"];
const unitRank = (u) => (!u ? 9 : u.unit_type === "Apartment" || u.unit_type === "House" ? 0 : u.unit_type === "Commercial" ? 1 : 2);
const cmpUnits = (a, b) => (a?.building_id ?? 1e9) - (b?.building_id ?? 1e9) || (unitRank(a) - unitRank(b)) || String(a?.code || "").localeCompare(String(b?.code || ""), undefined, { numeric: true, sensitivity: "base" });
/** ids of the units a shared unit (e.g. a garden) belongs to */
const sharedIds = (u) => String(u?.shared_unit_ids || "").split(",").map(Number).filter(Boolean);
/** main units a unit belongs to: its one main unit, or all units it is shared with */
const ownerUnits = (u) => (u?.parent_unit_id ? [byId("units", u.parent_unit_id)] : sharedIds(u).map((i) => byId("units", i))).filter(Boolean);
/** units of a building in display order: flats, commercial, other – ancillary units directly below their main unit */
function orderedUnits(bid, repeatShared = false) {
  const all = db.units.filter((u) => u.building_id === bid);
  const owners = (u) => ownerUnits(u).filter((o) => all.includes(o));
  const mains = all.filter((u) => !owners(u).length).sort(cmpUnits);
  // a unit shared by several flats goes below each of them (repeatShared) or only below the last one,
  // always after that flat's own ancillary units
  const lastOwner = (u) => owners(u).sort(cmpUnits).pop();
  const sharedBelow = (c, p) => !c.parent_unit_id && (repeatShared ? owners(c).includes(p) : lastOwner(c) === p);
  return mains.flatMap((p) => [p, ...all.filter((c) => c.parent_unit_id === p.id).sort(cmpUnits),
    ...all.filter((c) => owners(c).length && sharedBelow(c, p)).sort(cmpUnits)]);
}
/** ancillary unit: belongs to one main unit or is shared by several */
const isAncillary = (u) => !!(u?.parent_unit_id || u?.shared_unit_ids);
const cmpLeasesByUnit = (x, y) => cmpUnits(byId("units", x.unit_id), byId("units", y.unit_id)) || y.start_date.localeCompare(x.start_date);
/** unit a list record belongs to (for sorting the Data Admin lists) */
const UNIT_OF = {
  units: (r) => r,
  keys: (r) => byId("units", r.unit_id),
  meters: (r) => byId("units", r.unit_id),
  leases: (r) => byId("units", r.unit_id),
  settlements: (r) => byId("units", byId("leases", r.lease_id)?.unit_id),
  tenants: (r) => { const l = db.leases.filter((x) => x.tenant_id === r.id).sort((a, b) => (leaseActiveOn(b, today()) - leaseActiveOn(a, today())) || b.start_date.localeCompare(a.start_date))[0]; return l ? byId("units", l.unit_id) : null; },
};

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = "toast"), 2600);
}

// ---------------------------------------------------------------- icons (outline, Lucide style, ISC licence)
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M16 14v4"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  imageX: '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-4-4-9 9"/><path d="m16 3 5 5M21 3l-5 5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  bin: '<path d="M3 6h18"/><path d="M5 6l1.5 15h11L19 6"/><path d="M9 6V3h6v3"/><path d="M10 11v6M14 11v6"/>',
  checklist: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
};
const icon = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;

// ---------------------------------------------------------------- in-app confirm (native confirm() is blocked in some browsers / web-app mode)
function askConfirm(message, okLabel = "Delete") {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "confirm-backdrop";
    wrap.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true"><p></p><div class="confirm-actions"><button class="btn" data-c="0">Cancel</button><button class="btn primary${/delete|overwrite|discard/i.test(message) ? " danger-fill" : ""}" data-c="1">${esc(/delete/i.test(message) ? okLabel : "OK")}</button></div></div>`;
    wrap.querySelector("p").textContent = message;
    const done = (v) => { wrap.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } else if (e.key === "Enter") { e.preventDefault(); done(true); } };
    wrap.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) done(b.dataset.c === "1"); else if (e.target === wrap) done(false); };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-c="1"]').focus();
  });
}

// ---------------------------------------------------------------- attachments
const ATTACHABLE = ["buildings", "units", "meters", "tenants", "leases", "settlements", "payments"];
const attachmentsOf = (entity, id) => db.attachments.filter((a) => a.entity === entity && a.record_id === Number(id));
const isImage = (a) => (a.mime || "").startsWith("image/") && !/heic/i.test(a.mime);
/** Capture date from the JPEG EXIF block (DateTimeOriginal, else DateTime) as "YYYY-MM-DDTHH:MM:SS", or null.
 *  Read before downscaling – the canvas re-encode drops all EXIF data. */
async function exifTakenAt(file) {
  try {
    if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name || "")) return null;
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marker = v.getUint16(p), len = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
        const t = p + 10, le = v.getUint16(t) === 0x4949;
        const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
        const readIfd = (off) => { const out = {}; const n = u16(off); for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), val: u32(e + 8) }; } return out; };
        const str = (e) => { let s = ""; for (let i = 0; i < Math.min(e.count, 32); i++) { const c = v.getUint8(t + e.val + i); if (!c) break; s += String.fromCharCode(c); } return s; };
        const ifd0 = readIfd(u32(4));
        const sub = ifd0[0x8769] ? readIfd(ifd0[0x8769].val) : {};
        const raw = (sub[0x9003] && str(sub[0x9003])) || (sub[0x9004] && str(sub[0x9004])) || (ifd0[0x0132] && str(ifd0[0x0132])) || "";
        const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
        return m && m[1] !== "0000" ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      p += 2 + len;
    }
  } catch { /* no readable EXIF */ }
  return null;
}
/** Downscale photos before uploading (phone pictures are often 4–8 MB). */
async function prepareFile(file) {
  const takenAt = await exifTakenAt(file);
  return { ...(await shrinkFile(file)), takenAt };
}
async function shrinkFile(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5e6) return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return { blob, name: file.name.replace(/\.\w+$/, "") + ".jpg" };
  } catch { return { blob: file, name: file.name }; }
}
async function uploadFiles(entity, recordId, files, caption) {
  for (const file of files) {
    const { blob, name, takenAt } = await prepareFile(file);
    await Backend.upload(entity, recordId, blob, name, caption, takenAt);
  }
}
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const attSrc = (a) => { const u = Backend.fileUrl(a); return u ? `src="${esc(u)}"` : `src="${PIXEL}" data-att-src="${a.id}"`; };
const attHref = (a) => { const u = Backend.fileUrl(a); return u ? `href="${esc(u)}"` : `data-att-href="${a.id}"`; };
/** fill in download links for images/files that are not cached yet (OneDrive version) */
function hydrateAttachments(root = document) {
  root.querySelectorAll("[data-att-src],[data-att-href]").forEach((el) => {
    if (el.dataset.loading) return;
    const a = byId("attachments", el.dataset.attSrc || el.dataset.attHref);
    if (!a) return;
    el.dataset.loading = "1";
    Promise.resolve(Backend.resolveFileUrl(a)).then((url) => {
      if (!url) return;
      if (el.dataset.attSrc) { el.src = url; delete el.dataset.attSrc; } else { el.href = url; delete el.dataset.attHref; }
    }).catch(() => { el.title = "File not found in OneDrive"; el.classList.add("att-missing"); });
  });
}
new MutationObserver(() => requestAnimationFrame(() => hydrateAttachments())).observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------- dd/mm/yyyy date fields
// Native date inputs always show the device's own format (often mm/dd/yyyy). Every <input type="date"> gets a
// dd/mm/yyyy text field in front of it plus a calendar button; the (hidden) native input stays the source of truth
// (ISO yyyy-mm-dd), so all code reading/writing .value keeps working.
const isoToDmy = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "");
function dmyToIso(t) {
  const m = /^\s*(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{2}|\d{4})\s*$/.exec(t || "") || /^\s*(\d{2})(\d{2})(\d{4}|\d{2})\s*$/.exec(t || "");
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
function enhanceDates(root = document) {
  root.querySelectorAll('input[type="date"]:not([data-dmy])').forEach((nat) => {
    nat.dataset.dmy = "1";
    const wrap = document.createElement("span");
    wrap.className = "dmy";
    nat.parentNode.insertBefore(wrap, nat);
    const txt = document.createElement("input");
    txt.type = "text"; txt.className = nat.className; txt.placeholder = "dd/mm/yyyy"; txt.inputMode = "numeric"; txt.autocomplete = "off";
    if (nat.id) txt.setAttribute("aria-label", nat.closest(".field")?.querySelector("label")?.textContent || "Date");
    if (nat.required) { txt.required = true; nat.required = false; }
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "dmy-btn"; btn.title = "Pick a date"; btn.tabIndex = -1; btn.innerHTML = icon("calendar", 16);
    wrap.append(txt, btn, nat);
    nat.classList.add("dmy-native"); nat.tabIndex = -1;
    txt.value = isoToDmy(nativeValue.get.call(nat));
    // keep the text field in sync when code sets .value on the native input
    Object.defineProperty(nat, "value", { configurable: true, get() { return nativeValue.get.call(this); },
      set(v) { nativeValue.set.call(this, v); txt.value = isoToDmy(v); txt.classList.remove("bad"); } });
    const commit = (final) => {
      const t = txt.value.trim();
      const iso = t ? dmyToIso(t) : "";
      if (iso === null) { if (final) txt.classList.add("bad"); return; }
      txt.classList.remove("bad");
      if (final && iso) txt.value = isoToDmy(iso);
      if (nativeValue.get.call(nat) !== iso) { nativeValue.set.call(nat, iso); nat.dispatchEvent(new Event("input", { bubbles: true })); nat.dispatchEvent(new Event("change", { bubbles: true })); }
    };
    txt.addEventListener("input", () => commit(false));
    txt.addEventListener("blur", () => commit(true));
    txt.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(true); });
    nat.addEventListener("change", () => { txt.value = isoToDmy(nativeValue.get.call(nat)); txt.classList.remove("bad"); });
    btn.onclick = () => { try { nat.showPicker(); } catch { nat.focus(); nat.click(); } };
  });
}
new MutationObserver(() => enhanceDates()).observe(document.body, { childList: true, subtree: true });

function attachmentTiles(list, deletable = true) {
  return list.map((a) => `<div class="att">
      <a ${attHref(a)} target="_blank" rel="noopener" title="${esc(a.filename)}">${isImage(a) ? `<img ${attSrc(a)} loading="lazy" alt="">` : `<span class="att-file">${icon("file", 28)}<span>${esc(a.filename.split(".").pop().toUpperCase())}</span></span>`}</a>
      <div class="att-name" title="${esc(a.filename + (a.taken_at ? ` · taken ${fmtDate(a.taken_at.slice(0, 10))} ${a.taken_at.slice(11, 16)}` : ""))}">${esc(a.caption || a.filename.replace(/^\d{8}-\d{6}_[0-9a-f]{4}_/, ""))}</div>
      ${deletable ? `<button class="att-del" data-del-att="${a.id}" title="Delete ${isImage(a) ? "photo" : "file"}">${icon(isImage(a) ? "imageX" : "x", 16)}</button>` : ""}</div>`).join("");
}
function attachmentsBlock(entity, record) {
  const list = attachmentsOf(entity, record.id);
  return `<div class="section-title"><span>${icon("paperclip", 16)} Files & photos (${list.length})</span>
      <span class="att-actions">
        <label class="btn small">${icon("camera", 16)} Photo<input type="file" accept="image/*" capture="environment" data-upload="${entity}:${record.id}" hidden></label>
        <label class="btn small">${icon("upload", 16)} Upload<input type="file" accept="image/*,.pdf,.heic,.docx,.doc,.xlsx,.odt" multiple data-upload="${entity}:${record.id}" hidden></label>
      </span></div>
    <div class="att-drop" data-drop="${entity}:${record.id}">${list.length ? `<div class="att-grid">${attachmentTiles(list)}</div>` : `<div class="muted">${icon("image", 18)} Drop images or PDFs here, take a photo or upload files.</div>`}</div>`;
}
function bindAttachments(root, after) {
  const doUpload = async (target, files) => {
    if (!files.length) return;
    const [entity, id] = target.split(":");
    try { toast("Uploading …"); await uploadFiles(entity, id, files); await loadAll(); toast(files.length > 1 ? `${files.length} files saved` : "File saved"); after(); }
    catch (err) { toast(err.message, true); }
  };
  root.querySelectorAll("input[data-upload]").forEach((inp) => (inp.onchange = () => doUpload(inp.dataset.upload, [...inp.files])));
  root.querySelectorAll("[data-drop]").forEach((zone) => {
    zone.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; zone.classList.add("over"); };
    zone.ondragleave = (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("over"); };
    zone.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove("over"); doUpload(zone.dataset.drop, [...e.dataTransfer.files]); };
  });
  root.querySelectorAll("[data-del-att]").forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!await askConfirm("Delete this file?")) return;
    try { await api("DELETE", `attachments/${b.dataset.delAtt}`); await loadAll(); toast("File deleted"); after(); }
    catch (err) { toast(err.message, true); }
  }));
}

// ---------------------------------------------------------------- rent control logic
const CATEGORIES = { rent: "Rent", service: "Service charges", settlement: "Utility settlement", deposit: "Deposit" };
const trackingStart = () => db.settings.tracking_start || "2025-01";
const graceDays = () => Number(db.settings.rent_grace_days || 5);

function splitInstallments(amount, n, firstMonth) {
  n = Math.max(1, Number(n) || 1);
  const base = Math.trunc((amount / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({ ym: addMonths(firstMonth, i), amount: i === n - 1 ? round2(amount - base * (n - 1)) : base, k: i + 1, n }));
}
const settlementSchedule = (s) => splitInstallments(Number(s.amount) || 0, s.installments, s.first_due_month).map((x) => ({ ...x, settlement: s }));
function depositSchedule(l) {
  const startYm = l.start_date.slice(0, 7);
  if (!Number(l.deposit) || startYm < trackingStart()) return [];
  return splitInstallments(Number(l.deposit), l.deposit_installments, startYm);
}
const leaseSettlements = (l) => db.settlements.filter((s) => s.lease_id === l.id).sort((a, b) => a.first_due_month.localeCompare(b.first_due_month));
function scheduleFor(l, cat) {
  if (cat === "settlement") return leaseSettlements(l).flatMap(settlementSchedule);
  if (cat === "deposit") return depositSchedule(l);
  return [];
}
function expected(l, ym, cat) {
  if (cat === "rent") return leaseActiveInMonth(l, ym) && ym >= trackingStart() ? (Number(l.cold_rent) || 0) + (Number(l.other_charge) || 0) : 0;
  if (cat === "service") return leaseActiveInMonth(l, ym) && ym >= trackingStart() ? (Number(l.service_charge) || 0) + (Number(l.heating_charge) || 0) : 0;
  return round2(sum(scheduleFor(l, cat).filter((x) => x.ym === ym), (x) => x.amount));
}
const paymentRow = (l, ym, cat) => db.payments.find((p) => p.lease_id === l.id && p.month === ym && p.category === cat);
const paid = (l, ym, cat) => Number(paymentRow(l, ym, cat)?.amount) || 0;
const paidTotal = (l, cat, upTo = "9999-12") => sum(db.payments.filter((p) => p.lease_id === l.id && p.category === cat && p.month <= upTo), (p) => p.amount);
/** Is the given month already due for payment (considering the grace period)? */
function isDue(l, ym) {
  const cur = thisMonth();
  if (ym < cur) return true;
  if (ym > cur) return false;
  return Number(today().slice(8, 10)) > (Number(l.payment_day) || graceDays());
}
const lastDueMonth = (l) => (isDue(l, thisMonth()) ? thisMonth() : addMonths(thisMonth(), -1));
/** cumulative balance for settlement / deposit (positive = tenant still owes) */
function cumulativeOutstanding(l, cat, upTo = lastDueMonth(l)) {
  const due = sum(scheduleFor(l, cat).filter((x) => x.ym <= upTo), (x) => x.amount);
  return round2(due - paidTotal(l, cat));
}
function rentArrears(l) {
  const from = [trackingStart(), l.start_date.slice(0, 7)].sort().pop();
  const to = [lastDueMonth(l), l.end_date ? l.end_date.slice(0, 7) : "9999-12"].sort()[0];
  if (from > to) return [];
  return monthsBetween(from, to).flatMap((ym) => ["rent", "service"].map((cat) => ({ ym, cat, missing: round2(expected(l, ym, cat) - paid(l, ym, cat)) })))
    .filter((x) => x.missing > 0.009);
}
function cellState(l, ym, cat) {
  const exp = expected(l, ym, cat), got = paid(l, ym, cat);
  if (cat === "settlement" || cat === "deposit") {
    // installment plans are reconciled cumulatively (payments may come later or earlier)
    if (!exp && !got) return "none";
    if (!exp) return "extra";
    const settledUpTo = round2(paidTotal(l, cat, ym) - sum(scheduleFor(l, cat).filter((x) => x.ym <= ym), (x) => x.amount));
    if (settledUpTo >= -0.009) return "ok";
    return isDue(l, ym) ? "overdue" : "pending";
  }
  if (!exp && !got) return "none";
  if (!exp) return "extra";
  if (got >= exp - 0.009) return "ok";
  return isDue(l, ym) ? "overdue" : (got ? "partial" : "pending");
}

/** All computed reminders (sorted by severity). */
function computeReminders() {
  const out = [];
  const cur = thisMonth();
  const curYear = Number(cur.slice(0, 4));
  for (const l of db.leases) {
    const who = leaseShort(l);
    // 1) rent / service charge arrears
    const arrears = rentArrears(l);
    if (arrears.length) {
      const total = round2(sum(arrears, (a) => a.missing));
      const months = [...new Set(arrears.map((a) => a.ym))];
      out.push({ level: "danger", lease: l, title: `Missing rent payments – ${who}`,
        text: `${fmtMoney(total)} outstanding for ${months.map(fmtMonth).join(", ")}.`, action: "record" });
    }
    // 2) utility settlements incl. installment plans
    for (const s of leaseSettlements(l)) {
      const sched = settlementSchedule(s);
      const lastYm = sched[sched.length - 1].ym;
      if (Number(s.amount) < 0) {
        // refund to the tenant: remind until a (negative) payment is recorded
        if (paidTotal(l, "settlement") > Number(s.amount) + 0.009 && s.first_due_month <= cur)
          out.push({ level: "warn", lease: l, settlement: s, title: `Refund utility settlement ${s.period_year} – ${who}`,
            text: `Refund of ${fmtMoney(-s.amount)} to the tenant has not been recorded yet.`, action: "settlement" });
      }
    }
    const setOut = cumulativeOutstanding(l, "settlement");
    const plans = leaseSettlements(l).filter((s) => Number(s.amount) > 0);
    if (setOut > 0.009) {
      const dueNow = plans.flatMap(settlementSchedule).filter((x) => x.ym <= lastDueMonth(l));
      const plan = plans.find((s) => s.installments > 1 && settlementSchedule(s).some((x) => x.ym >= cur));
      const instThisMonth = plans.flatMap(settlementSchedule).find((x) => x.ym === cur && x.n > 1);
      out.push({ level: "warn", lease: l, title: `Collect utility settlement – ${who}`,
        text: `${fmtMoney(setOut)} outstanding` + (instThisMonth ? ` · installment ${instThisMonth.k} of ${instThisMonth.n} (${fmtMoney(instThisMonth.amount)}) is due with the ${fmtMonth(cur)} rent` : "")
          + (plan && !instThisMonth ? ` · installment plan ${plan.period_year}: ${plan.installments} × ${fmtMoney(settlementSchedule(plan)[0].amount)}` : "")
          + (dueNow.length ? "." : ""), action: "record" });
    } else {
      // installment plan running and up to date → announce the next installment
      // first installment that is not yet covered by the payments received so far
      const paidSoFar = paidTotal(l, "settlement");
      let acc = 0;
      const next = plans.flatMap(settlementSchedule).sort((a, b) => a.ym.localeCompare(b.ym)).find((x) => (acc += x.amount) > paidSoFar + 0.009);
      if (next && next.n > 1 && next.ym <= addMonths(cur, 1)) {
        out.push({ level: "warn", lease: l, title: `Installment due – ${who}`,
          text: `Utility settlement ${next.settlement.period_year}: installment ${next.k} of ${next.n} (${fmtMoney(next.amount)}) is due in ${fmtMonth(next.ym)} in addition to the monthly rent.`, action: "record" });
      }
    }
    // 3) deposit
    const depOut = cumulativeOutstanding(l, "deposit");
    if (depOut > 0.009) {
      const n = Number(l.deposit_installments) || 1;
      out.push({ level: "warn", lease: l, title: `Collect deposit – ${who}`,
        text: `${fmtMoney(depOut)} of the ${fmtMoney(l.deposit)} deposit is outstanding${n > 1 ? ` (${n} installments of ${fmtMoney(depositSchedule(l)[0]?.amount)})` : ""}.`, action: "record" });
    }
    // 4) settlement for last year not entered yet
    const prevYear = curYear - 1;
    if (leaseActiveBetween(l, `${prevYear}-01-01`, `${prevYear}-12-31`) && Number(l.service_charge) > 0
        && !db.settlements.some((s) => s.lease_id === l.id && s.period_year === prevYear)) {
      out.push({ level: "info", lease: l, title: `Utility settlement ${prevYear} not entered – ${who}`,
        text: `The settlement for ${prevYear} must reach the tenant by 31/12/${curYear}.`, action: "newSettlement", year: prevYear });
    }
  }
  // 5) manual reminders
  for (const r of db.reminders.filter((x) => !x.done)) {
    const unit = r.unit_id ? byId("units", r.unit_id) : null;
    const lease = r.lease_id ? byId("leases", r.lease_id) : (unit ? currentLease(unit.id) : null);
    let level = "info";
    let text = r.notes || "";
    if (r.kind === "settlement") {
      // escalate when the settlement for last year is being prepared (Jan–Dec of the following year) and not yet entered
      const prevYear = curYear - 1;
      const pending = lease && leaseActiveBetween(lease, `${prevYear}-01-01`, `${prevYear}-12-31`) && !db.settlements.some((s) => s.lease_id === lease.id && s.period_year === prevYear);
      level = pending ? "warn" : "info";
      text = `Before the utility settlement${unit ? " for " + unit.code : ""}: ${r.title}${r.amount ? ` (${fmtMoney(r.amount)})` : ""}.` + (r.notes ? " " + r.notes : "");
    } else if (r.due_date) {
      const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      level = r.due_date <= today() ? "warn" : r.due_date <= soon ? "warn" : "info";
      text = `Due ${fmtDate(r.due_date)}${r.amount ? ` · ${fmtMoney(r.amount)}` : ""}. ${r.notes || ""}`;
    }
    out.push({ level, reminder: r, lease, title: r.kind === "settlement" ? `Settlement note – ${unit ? unitLabel(unit) : r.title}` : r.title, text, action: "reminder" });
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---------------------------------------------------------------- entities (Data Admin & Rent Control)
const UNIT_TYPES = ["Apartment", "Commercial", "House", "Cellar", "Parking space", "Garage", "Garden", "Storage", "Other"];
const METER_TYPES = { "Cold water": "m³", "Hot water": "m³", "Water (washing machine)": "m³", "Water (garden)": "m³", "Electricity": "kWh", "Electricity (common)": "kWh", "Gas": "m³", "Heat": "kWh", "Heat cost allocator": "units", "Smoke detector": "", "Other": "" };
// Small inline icons shown in front of the meter type (Data Admin → Meters).
const METER_ICON_SVG = {
  snow: ["#2b8fd6", '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>'],
  flame: ["#e0522b", '<path d="M12 22c4 0 7-2.7 7-6.6 0-3.3-2.2-5.6-3.6-7.4-.4 1.8-1.4 3-2.6 3.4.2-3.4-1.3-6.6-4.3-8.4.3 3.2-1.6 5.3-3 7.2C4.4 11.8 5 13.7 5 15.4 5 19.3 8 22 12 22z"/>'],
  bolt: ["#e5a50a", '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'],
  washer: ["#6a5acd", '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7 6h2M13 6h4"/>'],
  drop: ["#2e9e4f", '<path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/>'],
  smoke: ["#6b7280", '<path d="M7 22c-2-2.5 2-4.5 0-7s2-4.5 0-7"/><path d="M12 22c-2-2.5 2-4.5 0-7s2-4.5 0-7 2-4 0-6"/><path d="M17 22c-2-2.5 2-4.5 0-7s2-4.5 0-7"/>'],
  gas: ["#3b6fd6", '<path d="M12 22c4 0 7-2.7 7-6.6 0-3.3-2.2-5.6-3.6-7.4-.4 1.8-1.4 3-2.6 3.4.2-3.4-1.3-6.6-4.3-8.4.3 3.2-1.6 5.3-3 7.2C4.4 11.8 5 13.7 5 15.4 5 19.3 8 22 12 22z"/>'],
};
const meterIcon = (type) => {
  const t = (type || "").toLowerCase();
  const k = t.includes("smoke") ? "smoke" : t.includes("washing") ? "washer" : t.includes("garden") ? "drop" : t.includes("cold") ? "snow"
    : t.includes("hot") || t.includes("heat") ? "flame" : t.includes("electric") ? "bolt" : t.includes("gas") ? "gas" : null;
  if (!k) return "";
  const [color, body] = METER_ICON_SVG[k];
  return `<svg class="meter-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px;margin-right:6px">${body}</svg>`;
};
const optionsFrom = (arr) => arr.map((v) => ({ value: v, label: v }));
const meterTypeOptions = () => optionsFrom([...new Set([...Object.keys(METER_TYPES), ...db.meters.map((m) => m.meter_type)])]);
const buildingOptions = () => db.buildings.map((b) => ({ value: b.id, label: buildingLabel(b) }));
const leaseOptions = () => [...db.leases].sort(cmpLeasesByUnit).map((l) => ({ value: l.id, label: leaseLabel(l) + (l.end_date && l.end_date < today() ? " (ended)" : "") }));

// ---------------------------------------------------------------- documents, keys, waste bins, checklist
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const COUNTRIES = ["Germany", "Spain", "Austria", "Switzerland", "Other"];
/** language of the documents of a building: German buildings get German documents */
const DOC_LANG = { Germany: "German", Austria: "German", Switzerland: "German", Spain: "Spanish" };
const docLanguage = (b) => DOC_LANG[b?.country] || "English";
const DOC_TYPES = {
  self_disclosure: "Tenant self-disclosure (Mieterselbstauskunft)",
  credit_check: "Credit check / SCHUFA",
  income_proof: "Proof of income",
  landlord_reference: "Previous landlord reference (Mietschuldenfreiheit)",
  lease: "Lease contract (Mietvertrag)",
  house_rules: "House rules (Hausordnung)",
  handover: "Handover protocol (Übergabeprotokoll)",
  landlord_confirmation: "Landlord confirmation (Wohnungsgeberbestätigung)",
  deposit_account: "Deposit account form (Mietkautionskonto)",
  energy_certificate: "Energy certificate (Energieausweis)",
  termination: "Notice of termination (Kündigung)",
  deposit_settlement: "Deposit settlement (Kautionsabrechnung)",
  waste: "Waste collection (Müllabfuhr)",
  other: "Other",
};
const DOC_STATUS = ["Draft", "Sent to tenant", "Signed / returned", "Filed", "Template"];
const DOC_DONE = ["Signed / returned", "Filed"];
const docTypeLabel = (t) => DOC_TYPES[t] || t || "";
const docShort = (t) => docTypeLabel(t).replace(/ \(.*\)$/, "");
const docStatusPill = (s) => (!s ? "" : `<span class="pill ${DOC_DONE.includes(s) ? "ok" : s === "Draft" || s === "Template" ? "grey" : "free"}">${esc(s)}</span>`);
const KEY_TYPES = ["Central lock (front door / flat / cellar access)", "Mailbox", "Cellar (private)", "Garage", "Storage room", "Bicycle room", "Other"];
const BIN_TYPES = ["Residual waste (Restmüll)", "Organic waste (Biotonne)", "Paper (Papiertonne)", "Yellow bin / bag (Gelbe Tonne)", "Glass", "Other"];
const binIds = (b) => String(b?.unit_ids || "").split(",").map(Number).filter(Boolean);
const binUsers = (b) => { const ids = binIds(b); return ids.length ? ids.map((i) => byId("units", i)?.code).filter(Boolean).join(", ") : "all units"; };
const roomArea = (r) => (Number(r.base_area) || 0) * (r.factor ?? 1);
const unitRooms = (uid) => db.unit_rooms.filter((r) => r.unit_id === uid).sort((a, b) => (a.sort_no ?? 999) - (b.sort_no ?? 999) || a.id - b.id);
const roomsArea = (uid) => Math.round(unitRooms(uid).reduce((t, r) => t + roomArea(r), 0) * 100) / 100;
const FACTORS = [{ value: 1, label: "100 % – full height (≥ 2 m)" }, { value: 0.5, label: "50 % – height 1–2 m (sloped ceiling)" },
  { value: 0.25, label: "25 % – balcony / loggia / terrace" }, { value: 0, label: "0 % – height < 1 m" }];
const keysOut = (k) => db.key_handovers.filter((h) => h.key_id === k.id).reduce((t, h) => t + (h.quantity || 0) - (h.returned_quantity || 0), 0);
const unitOptionsOf = (bid, filter = () => true) => orderedUnits(Number(bid)).filter(filter).map((u) => ({ value: u.id, label: unitLabel(u, false) }));

/** move-in / move-out checklist (from "Checkliste - Ein und Auszug"). doc = ticks itself when such a document is signed / filed */
const CHECKLIST = {
  in: [
    { section: "Before signing", items: [
      { key: "self_disclosure", label: "Tenant self-disclosure filled in and signed", doc: "self_disclosure" },
      { key: "credit_check", label: "SCHUFA / credit check", doc: "credit_check" },
      { key: "income_proof", label: "Proof of income (last 2–3 payslips or employment contract; self-employed: tax assessment / BWA)", doc: "income_proof" },
      { key: "landlord_reference", label: "Previous landlord reference (optional)", doc: "landlord_reference" },
      { key: "id_check", label: "ID checked (do not keep a copy – GDPR)" },
    ] },
    { section: "At signing", items: [
      { key: "lease", label: "Lease contract signed (two copies)", doc: "lease" },
      { key: "house_rules", label: "House rules attached to the lease", doc: "house_rules" },
      { key: "handover", label: "Handover protocol with meter readings", doc: "handover" },
      { key: "condition_photos", label: "Condition documented (photos, existing defects)" },
      { key: "keys", label: "Keys handed over and recorded", auto: "keys" },
      { key: "deposit_agreement", label: "Deposit agreed (amount, lump sum or 3 installments, § 551 BGB)" },
      { key: "energy_certificate", label: "Energy certificate shown", doc: "energy_certificate" },
    ] },
    { section: "After moving in", items: [
      { key: "landlord_confirmation", label: "Landlord confirmation issued (§ 19 BMG – tenant must register within 14 days)", doc: "landlord_confirmation" },
      { key: "deposit_account_form", label: "Deposit account form returned by the tenant", doc: "deposit_account" },
      { key: "deposit_account", label: "Deposit paid into a separate deposit account" },
    ] },
  ],
  out: [
    { section: "Before the move-out date", items: [
      { key: "termination", label: "Written notice received, notice period checked", doc: "termination" },
      { key: "appointment", label: "Handover appointment arranged" },
      { key: "pre_inspection", label: "Pre-inspection for defects (optional)" },
    ] },
    { section: "At the handover", items: [
      { key: "handover", label: "Handover protocol (condition, meter readings, defects, keys)", doc: "handover" },
      { key: "condition_photos", label: "Photos of the condition" },
      { key: "compare_move_in", label: "Compared with the move-in protocol (wear vs. damage)" },
      { key: "keys_returned", label: "All keys returned and counted", auto: "keys_returned" },
    ] },
    { section: "After moving out", items: [
      { key: "utility_settlement", label: "Utility settlement sent (within 12 months after the billing period)" },
      { key: "deposit_settlement", label: "Deposit settled and repaid (usually 3–6 months)", doc: "deposit_settlement" },
      { key: "damages", label: "Damages: quotes obtained, offset against deposit, documented" },
      { key: "move_out_confirmation", label: "Move-out confirmed to the tenant if needed for deregistration" },
    ] },
  ],
};
const leaseDocs = (l, type, phase) => db.documents.filter((d) => d.lease_id === l.id && d.doc_type === type && (!phase || !d.phase || d.phase === phase));
/** state of one checklist item: {done, auto, row} */
function checkState(l, phase, it) {
  const row = db.checklist.find((c) => c.lease_id === l.id && c.phase === phase && c.item_key === it.key);
  let auto = false;
  if (it.doc) auto = leaseDocs(l, it.doc, phase === "in" ? "Move-in" : "Move-out").some((d) => DOC_DONE.includes(d.status));
  if (it.auto === "keys") auto = db.key_handovers.some((h) => h.lease_id === l.id && h.quantity > 0);
  if (it.auto === "keys_returned") { const hs = db.key_handovers.filter((h) => h.lease_id === l.id); auto = hs.length > 0 && hs.every((h) => (h.returned_quantity || 0) >= h.quantity); }
  return { done: auto || !!row?.done, auto, row };
}
function checklistProgress(l, phase) {
  const items = CHECKLIST[phase].flatMap((s) => s.items);
  return { done: items.filter((it) => checkState(l, phase, it).done).length, total: items.length };
}
const leaseHasMoveOut = (l) => !!l.end_date || db.checklist.some((c) => c.lease_id === l.id && c.phase === "out");
/** phase that currently matters for a lease: move-out when it ends within 60 days or has ended */
const currentPhase = (l) => (l.end_date && l.end_date <= addDays(today(), 60) ? "out" : "in");

const ENTITIES = {
  buildings: {
    title: "Buildings", singular: "Building", newLabel: "New building",
    display: (r) => buildingLabel(r),
    fields: [
      { key: "code", label: "Code", required: true, hint: "Unique, e.g. ZS36" },
      { key: "name", label: "Name" },
      { key: "street", label: "Street", required: true },
      { key: "house_no", label: "House no." },
      { key: "zip", label: "Postcode" },
      { key: "city", label: "City", required: true },
      { key: "country", label: "Country", type: "select", required: true, default: "Germany", options: () => optionsFrom(COUNTRIES), hint: "Sets the language of the documents (Germany → German)" },
      { key: "building_type", label: "Building type", list: ["Residential building", "Apartment building", "Mixed-use building", "Commercial", "Holiday home"] },
      { key: "year_built", label: "Year built", type: "number" },
      { key: "plot_area", label: "Plot area (m²)", type: "number" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Name", value: (r) => `<strong>${esc(buildingName(r))}</strong>` },
      { label: "Address", value: (r) => esc(`${r.street || ""} ${r.house_no || ""}, ${r.zip || ""} ${r.city || ""}`) },
      { label: "Country", value: (r) => esc(r.country || "") },
      { label: "Documents in", value: (r) => esc(docLanguage(r)) },
      { label: "Year built", value: (r) => esc(r.year_built ?? ""), num: true },
      { label: "Units", value: (r) => db.units.filter((u) => u.building_id === r.id).length, num: true },
      { label: "Meters", value: (r) => db.meters.filter((m) => m.building_id === r.id).length, num: true },
    ],
    related: (r) => [
      relatedBlock("Units in this building", "units", db.units.filter((u) => u.building_id === r.id),
        [["Unit", (u) => esc(u.code)], ["Type", (u) => esc(u.unit_type)], ["Area", (u) => (u.area ? fmtNum(u.area) + " m²" : "–")], ["Tenant", (u) => esc(tenantName(byId("tenants", currentLease(u.id)?.tenant_id)))]],
        { building_id: r.id }, "+ Unit"),
      relatedBlock("Meters in this building", "meters", db.meters.filter((m) => m.building_id === r.id),
        [["Meter type", (m) => esc(m.meter_type)], ["Number", (m) => esc(m.number)], ["Assigned to", (m) => esc(m.unit_id ? byId("units", m.unit_id)?.code : "Common")]],
        { building_id: r.id }, "+ Meter"),
      relatedBlock("Building documents (house rules, waste collection, …)", "documents", db.documents.filter((d) => d.building_id === r.id && !d.lease_id && !d.unit_id),
        [["Type", (d) => esc(docShort(d.doc_type))], ["Title / version", (d) => esc([d.title, d.version].filter(Boolean).join(" · "))], ["Date", (d) => fmtDate(d.doc_date)], ["Status", (d) => docStatusPill(d.status)]],
        { building_id: r.id, doc_type: "house_rules", status: "Filed" }, "+ Document"),
      relatedBlock("Waste bins", "waste_bins", db.waste_bins.filter((w) => w.building_id === r.id),
        [["Bin", (w) => esc(w.bin_type)], ["Size", (w) => (w.size_l ? w.size_l + " l" : "–")], ["Used by", (w) => esc(binUsers(w))], ["Pickup", (w) => esc(w.pickup || "")]],
        { building_id: r.id, active: 1 }, "+ Waste bin"),
      relatedBlock("Keys", "keys", db.keys.filter((k) => k.building_id === r.id),
        [["Key", (k) => esc(k.key_type)], ["No.", (k) => esc(k.key_no || "")], ["Unit", (k) => esc(byId("units", k.unit_id)?.code || "all")], ["Total / out", (k) => `${k.quantity ?? "–"} / ${keysOut(k)}`]],
        { building_id: r.id }, "+ Key"),
    ],
  },

  units: {
    title: "Units", singular: "Unit", newLabel: "New unit",
    display: (r) => unitLabel(r),
    fields: [
      { key: "building_id", label: "Building", type: "select", required: true, options: buildingOptions, full: true },
      { key: "code", label: "Name / no.", required: true, hint: "e.g. Flat 1 Ground Floor, Cellar 3, Parking 5" },
      { key: "unit_type", label: "Type", type: "select", required: true, options: () => optionsFrom(UNIT_TYPES), default: "Apartment" },
      { key: "doc_label", label: "Name in documents", hint: "Short German name used in forms, e.g. WHG_04_DG" },
      { key: "floor", label: "Floor / location", list: ["Basement", "Ground floor", "Upper floor", "1st floor", "2nd floor", "Attic floor", "Outside"] },
      { key: "area", label: "Area (m²)", type: "number", hint: "Calculated automatically once rooms are entered below" },
      { key: "rooms", label: "Rooms", type: "number" },
      { key: "parent_unit_id", label: "Belongs to (main unit)", type: "select", full: true, dependsOn: "building_id", emptyLabel: "– independent –",
        hint: "e.g. a cellar, parking space or garden that belongs to an apartment",
        options: (f) => db.units.filter((u) => u.building_id === Number(f.building_id) && u.id !== Number(f.id) && !u.parent_unit_id && !u.shared_unit_ids).map((u) => ({ value: u.id, label: unitLabel(u, false) })) },
      { key: "shared_unit_ids", label: "Shared by (several main units)", type: "multi", full: true, dependsOn: "building_id",
        hint: "e.g. a garden used by several apartments – leave \"Belongs to\" empty then",
        options: (f) => db.units.filter((u) => u.building_id === Number(f.building_id) && u.id !== Number(f.id) && !u.parent_unit_id && !u.shared_unit_ids).sort(cmpUnits).map((u) => ({ value: u.id, label: unitLabel(u, false) })) },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Unit", value: (r) => `<strong>${esc(r.code)}</strong>` },
      { label: "Belongs to", value: (r) => esc(ownerUnits(r).map((u) => u.code).join(", ")) },
      { label: "Type", value: (r) => esc(r.unit_type) },
      { label: "Floor", value: (r) => esc(r.floor || "") },
      { label: "Area", value: (r) => (r.area ? fmtNum(r.area) + " m²" : "–"), num: true },
      { label: "Rooms", value: (r) => (r.rooms ?? "–"), num: true },
      { label: "Meters", value: (r) => db.meters.filter((m) => m.unit_id === r.id).length, num: true },
      { label: "Status", value: (r) => statusPill(r) },
    ],
    related: (r) => [
      ...(r.parent_unit_id || r.shared_unit_ids ? [] : [relatedBlock("Ancillary units (cellar, parking, …)", "units", db.units.filter((u) => u.parent_unit_id === r.id || sharedIds(u).includes(r.id)),
        [["Unit", (u) => esc(u.code)], ["Type", (u) => esc(u.unit_type)], ["Notes", (u) => esc((u.notes || "").slice(0, 40))]],
        { building_id: r.building_id, parent_unit_id: r.id }, "+ Ancillary unit")]),
      roomsBlock(r),
      relatedBlock("Assigned meters", "meters", db.meters.filter((m) => m.unit_id === r.id),
        [["Meter type", (m) => esc(m.meter_type)], ["Number", (m) => esc(m.number)], ["Location", (m) => esc(m.location || "")]],
        { building_id: r.building_id, unit_id: r.id }, "+ Meter"),
      relatedBlock("Leases", "leases", db.leases.filter((l) => l.unit_id === r.id).sort((a, b) => b.start_date.localeCompare(a.start_date)),
        [["Tenant", (l) => esc(tenantName(byId("tenants", l.tenant_id)))], ["Start", (l) => fmtDate(l.start_date)], ["End", (l) => fmtDate(l.end_date)], ["Total", (l) => fmtMoney(leaseTotal(l))]],
        { unit_id: r.id }, "+ Lease"),
      relatedBlock("Reminders for this unit", "reminders", db.reminders.filter((x) => x.unit_id === r.id),
        [["Reminder", (x) => esc(x.title)], ["Amount", (x) => fmtMoney(x.amount)], ["Status", (x) => (x.done ? '<span class="pill grey">done</span>' : '<span class="pill free">open</span>')]],
        { unit_id: r.id, kind: "settlement" }, "+ Reminder"),
    ],
  },

  meters: {
    title: "Meters", singular: "Meter", newLabel: "New meter",
    display: (r) => `${r.meter_type} ${r.number || "(no number)"}`,
    fields: [
      { key: "building_id", label: "Building", type: "select", required: true, options: buildingOptions, full: true },
      { key: "unit_id", label: "Unit", type: "select", full: true, emptyLabel: "– Common (building meter) –", dependsOn: "building_id",
        options: (f) => db.units.filter((u) => u.building_id === Number(f.building_id)).map((u) => ({ value: u.id, label: unitLabel(u, false) })) },
      { key: "meter_type", label: "Meter type", type: "select", required: true, options: meterTypeOptions },
      { key: "number", label: "Meter number", hint: "can be added later" },
      { key: "measure_unit", label: "Unit of measure", list: ["m³", "kWh", "MWh", "units"] },
      { key: "location", label: "Location", list: ["Basement", "Bathroom", "Kitchen", "Hallway", "Laundry room", "Boiler room", "Storage cellar", "Outside"] },
      { key: "supplier", label: "Supplier", list: () => [...new Set(db.meters.map((m) => m.supplier).filter(Boolean))].sort() },
      { key: "active", label: "Meter active", type: "checkbox", default: 1 },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Assigned to", hideMobile: true, value: (r) => (r.unit_id ? esc(byId("units", r.unit_id)?.code) : '<span class="muted">Common</span>') },
      { label: "Meter type", value: (r) => meterIcon(r.meter_type) + esc(r.meter_type) },
      { label: "Number", value: (r) => (r.number ? `<strong>${esc(r.number)}</strong>` : '<span class="pill free">missing</span>') },
      { label: "Unit", value: (r) => esc(r.measure_unit || "") },
      { label: "Location", value: (r) => esc(r.location || "") },
      { label: "Supplier", value: (r) => esc(r.supplier || "") },
      { label: "Last reading", value: (r) => { const l = lastReading(r); const d = meterDocIcon(r); return (l ? fmtDate(l.reading_date) : '<span class="muted">–</span>') + (d ? " " + d : ""); } },
      { label: "Status", value: (r) => (r.active ? '<span class="pill ok">active</span>' : '<span class="pill grey">inactive</span>') },
    ],
    related: (r) => [readingsBlock(r)],
  },

  tenants: {
    title: "Tenants", singular: "Tenant", newLabel: "New tenant",
    display: (r) => tenantName(r),
    fields: [
      { key: "salutation", label: "Salutation", type: "select", options: () => optionsFrom(["Mr.", "Ms.", "Mr. and Mrs.", "Company", "Other"]) },
      { key: "company", label: "Company" },
      { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name", hint: "Enter a last name or a company" },
      { key: "co_tenant", label: "Co-tenant / partner", full: true, hint: "e.g. spouse who also signed the lease" },
      { key: "street", label: "Street / no.", full: true, hint: "Postal address (if different from the unit)" },
      { key: "zip", label: "Postcode" },
      { key: "city", label: "City" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email", type: "email" },
      { key: "iban", label: "IBAN", full: true },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Name", value: (r) => `<strong>${esc(tenantName(r))}</strong>` },
      { label: "Phone", value: (r) => esc(r.phone || "") },
      { label: "Email", value: (r) => esc(r.email || "") },
      { label: "Current unit", value: (r) => esc(db.leases.filter((l) => l.tenant_id === r.id && leaseActiveOn(l, today())).map((l) => unitLabel(byId("units", l.unit_id), false)).join(", ") || "–") },
    ],
    related: (r) => [
      relatedBlock("Leases", "leases", db.leases.filter((l) => l.tenant_id === r.id),
        [["Unit", (l) => esc(unitLabel(byId("units", l.unit_id)))], ["Start", (l) => fmtDate(l.start_date)], ["End", (l) => fmtDate(l.end_date)], ["Total", (l) => fmtMoney(leaseTotal(l))]],
        { tenant_id: r.id }, "+ Lease"),
    ],
  },

  leases: {
    title: "Leases", singular: "Lease", newLabel: "New lease",
    display: (r) => leaseLabel(r),
    fields: [
      { key: "unit_id", label: "Unit", type: "select", required: true, full: true,
        options: () => [...db.units].sort(cmpUnits).map((u) => ({ value: u.id, label: unitLabel(u) })) },
      { key: "tenant_id", label: "Tenant", type: "select", required: true, full: true,
        options: () => db.tenants.map((t) => ({ value: t.id, label: tenantName(t) })) },
      { key: "start_date", label: "Lease start", type: "date", required: true },
      { key: "end_date", label: "Lease end", type: "date", hint: "empty = open-ended" },
      { key: "cold_rent", label: "Base rent (€)", type: "number", required: true },
      { key: "service_charge", label: "Service charge prepayment (€)", type: "number" },
      { key: "heating_charge", label: "Heating prepayment (€)", type: "number" },
      { key: "other_charge", label: "Other (€)", type: "number", hint: "e.g. parking space, garage" },
      { key: "deposit", label: "Deposit (€)", type: "number" },
      { key: "deposit_installments", label: "Deposit installments", type: "number", default: 1, hint: "1–12, first installment due at lease start" },
      { key: "payment_day", label: "Payment due day (day of month)", type: "number", hint: `empty = overdue after day ${5}` },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Unit", value: (r) => esc(unitLabel(byId("units", r.unit_id), false)) },
      { label: "Tenant", value: (r) => `<strong>${esc(tenantName(byId("tenants", r.tenant_id)))}</strong>` },
      { label: "Start", value: (r) => fmtDate(r.start_date) },
      { label: "End", value: (r) => fmtDate(r.end_date) },
      { label: "Base rent", value: (r) => fmtMoney(r.cold_rent), num: true },
      { label: "Total / month", value: (r) => fmtMoney(leaseTotal(r)), num: true },
      { label: "Deposit", value: (r) => fmtMoney(r.deposit), num: true },
      { label: "Status", value: (r) => leaseStatus(r) },
    ],
    related: (r) => [
      relatedBlock("Utility settlements", "settlements", leaseSettlements(r),
        [["Period", (s) => s.period_year], ["Amount", (s) => fmtMoney(s.amount)], ["Plan", (s) => (s.installments > 1 ? `${s.installments} × from ${fmtMonth(s.first_due_month)}` : `due ${fmtMonth(s.first_due_month)}`)]],
        { lease_id: r.id, period_year: new Date().getFullYear() - 1, first_due_month: thisMonth(), installments: 1 }, "+ Settlement"),
      checklistBlock(r, "in"),
      ...(leaseHasMoveOut(r) ? [checklistBlock(r, "out")] : []),
      generateBar(r),
      relatedBlock("Documents", "documents", db.documents.filter((d) => d.lease_id === r.id).sort((a, b) => (b.doc_date || "").localeCompare(a.doc_date || "")),
        [["Type", (d) => esc(docShort(d.doc_type))], ["Phase", (d) => esc(d.phase || "")], ["Date", (d) => fmtDate(d.doc_date)], ["Status", (d) => docStatusPill(d.status)], ["Files", (d) => attachmentsOf("documents", d.id).length || "–"]],
        { building_id: byId("units", r.unit_id)?.building_id, unit_id: r.unit_id, lease_id: r.id, tenant_id: r.tenant_id, phase: currentPhase(r) === "out" ? "Move-out" : "Move-in", status: "Draft" }, "+ Document"),
      relatedBlock("Keys handed over", "key_handovers", db.key_handovers.filter((h) => h.lease_id === r.id),
        [["Key", (h) => esc(keyLabel(byId("keys", h.key_id)))], ["Handed over", (h) => `${h.quantity} × ${h.handed_on ? fmtDate(h.handed_on) : ""}`], ["Returned", (h) => (h.returned_quantity ? `${h.returned_quantity} × ${fmtDate(h.returned_on)}` : "–")]],
        { lease_id: r.id, quantity: 1, handed_on: r.start_date }, "+ Key handover"),
    ],
  },

  unit_rooms: {
    title: "Rooms", singular: "Room", newLabel: "New room",
    display: (r) => `${r.name} – ${byId("units", r.unit_id)?.code || ""}`,
    fields: [
      { key: "unit_id", label: "Unit", type: "select", required: true, full: true, options: () => [...db.units].sort(cmpUnits).map((u) => ({ value: u.id, label: unitLabel(u) })) },
      { key: "name", label: "Room (Raumbezeichnung)", required: true, list: ["Wohnen", "Schlafen", "Essen / Kochen", "Essen / Kochen / Wohnen", "Kind", "Bad", "WC", "Flur", "Abstellraum", "Balkon", "Loggia", "Terrasse"] },
      { key: "sort_no", label: "Order", type: "number", hint: "Position in the room list" },
      { key: "base_area", label: "Floor area (m²)", type: "number", hint: "Grundfläche – or the area already measured to the 1.5 m line" },
      { key: "factor", label: "Counts with", type: "select", required: true, default: 1, options: () => FACTORS },
      { key: "area_note", label: "Deduction note (shown in the lease)", full: true, list: ["m² bis 1,5m - Linie", "-"], hint: "e.g. “m² bis 1,5m - Linie” for rooms under the roof slope" },
    ],
    columns: [],
  },

  documents: {
    title: "Documents", singular: "Document", newLabel: "New document",
    display: (r) => `${docShort(r.doc_type)}${r.lease_id ? " – " + leaseShort(byId("leases", r.lease_id)) : ""}`,
    fields: [
      { key: "doc_type", label: "Document type", type: "select", required: true, full: true, options: () => Object.entries(DOC_TYPES).map(([value, label]) => ({ value, label })) },
      { key: "building_id", label: "Building", type: "select", required: true, options: buildingOptions },
      { key: "unit_id", label: "Unit", type: "select", dependsOn: "building_id", emptyLabel: "– whole building –", options: (f) => unitOptionsOf(f.building_id) },
      { key: "lease_id", label: "Lease", type: "select", full: true, emptyLabel: "– none (e.g. house rules, applicant) –", options: leaseOptions },
      { key: "tenant_id", label: "Tenant / applicant", type: "select", full: true, emptyLabel: "– none –", options: () => db.tenants.map((t) => ({ value: t.id, label: tenantName(t) })), hint: "Taken from the lease if left empty" },
      { key: "phase", label: "Move-in / move-out", type: "select", emptyLabel: "–", options: () => optionsFrom(["Move-in", "Move-out"]) },
      { key: "status", label: "Status", type: "select", emptyLabel: "–", default: "Draft", options: () => optionsFrom(DOC_STATUS),
        hint: "Template = Word file with {{placeholders}} used for “Create from template” (a template with a unit is used only for that unit)" },
      { key: "doc_date", label: "Date", type: "date" },
      { key: "version", label: "Version", hint: "e.g. v2026-06-29 (house rules)" },
      { key: "title", label: "Title", full: true },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Type", value: (r) => `<strong>${esc(docShort(r.doc_type))}</strong>${r.title ? `<div class="muted">${esc(r.title)}</div>` : ""}` },
      { label: "Unit", value: (r) => esc(byId("units", r.unit_id)?.code || "–") },
      { label: "Tenant", value: (r) => esc(r.tenant_id ? tenantName(byId("tenants", r.tenant_id)) : "") },
      { label: "Phase", value: (r) => esc(r.phase || "") },
      { label: "Date", value: (r) => fmtDate(r.doc_date) },
      { label: "Version", value: (r) => esc(r.version || "") },
      { label: "Files", value: (r) => attachmentsOf("documents", r.id).length || '<span class="pill free">none</span>', num: true },
      { label: "Status", value: (r) => docStatusPill(r.status) },
    ],
  },

  keys: {
    title: "Keys", singular: "Key", newLabel: "New key",
    display: (r) => keyLabel(r),
    fields: [
      { key: "building_id", label: "Building", type: "select", required: true, options: buildingOptions },
      { key: "unit_id", label: "Unit", type: "select", dependsOn: "building_id", emptyLabel: "– general (whole building) –", options: (f) => unitOptionsOf(f.building_id) },
      { key: "key_type", label: "Key", required: true, full: true, list: KEY_TYPES },
      { key: "key_no", label: "Key / lock number", hint: "e.g. 52374-4" },
      { key: "quantity", label: "Number of keys in total", type: "number" },
      { key: "opens", label: "Opens", full: true, hint: "e.g. front door = flat door = cellar access = bicycle room" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Key", value: (r) => `<strong>${esc(r.key_type)}</strong>${r.opens ? `<div class="muted">${esc(r.opens)}</div>` : ""}` },
      { label: "No.", value: (r) => esc(r.key_no || "") },
      { label: "Unit", value: (r) => esc(byId("units", r.unit_id)?.code || "all") },
      { label: "Total", value: (r) => r.quantity ?? "–", num: true },
      { label: "Handed out", value: (r) => keysOut(r), num: true },
      { label: "With", value: (r) => esc(db.key_handovers.filter((h) => h.key_id === r.id && h.quantity > (h.returned_quantity || 0)).map((h) => leaseShort(byId("leases", h.lease_id))).join(", ")) },
    ],
    related: (r) => [relatedBlock("Handovers", "key_handovers", db.key_handovers.filter((h) => h.key_id === r.id),
      [["Lease", (h) => esc(leaseShort(byId("leases", h.lease_id)))], ["Handed over", (h) => `${h.quantity} × ${fmtDate(h.handed_on)}`], ["Returned", (h) => (h.returned_quantity ? `${h.returned_quantity} × ${fmtDate(h.returned_on)}` : "–")]],
      { key_id: r.id, quantity: 1 }, "+ Handover")],
  },

  key_handovers: {
    title: "Key handovers", singular: "Key handover", newLabel: "New key handover",
    display: (r) => `${keyLabel(byId("keys", r.key_id))} – ${leaseShort(byId("leases", r.lease_id))}`,
    fields: [
      { key: "lease_id", label: "Lease", type: "select", required: true, full: true, options: leaseOptions },
      { key: "key_id", label: "Key", type: "select", required: true, full: true, dependsOn: "lease_id",
        options: (f) => { const bid = byId("units", byId("leases", f.lease_id)?.unit_id)?.building_id; return db.keys.filter((k) => !bid || k.building_id === bid).map((k) => ({ value: k.id, label: keyLabel(k) + (k.quantity ? ` (${k.quantity - keysOut(k)} available)` : "") })); } },
      { key: "quantity", label: "Number handed over", type: "number", required: true, default: 1 },
      { key: "handed_on", label: "Handed over on", type: "date" },
      { key: "returned_quantity", label: "Number returned", type: "number" },
      { key: "returned_on", label: "Returned on", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [],
  },

  waste_bins: {
    title: "Waste bins", singular: "Waste bin", newLabel: "New waste bin",
    display: (r) => `${r.bin_type}${r.size_l ? " " + r.size_l + " l" : ""}`,
    fields: [
      { key: "building_id", label: "Building", type: "select", required: true, options: buildingOptions },
      { key: "bin_type", label: "Bin", required: true, list: BIN_TYPES },
      { key: "size_l", label: "Size (litres)", type: "number", list: ["60", "80", "120", "240", "1100"] },
      { key: "bin_no", label: "Bin / chip number" },
      { key: "provider", label: "Provider", hint: "e.g. Landkreis Günzburg" },
      { key: "pickup", label: "Pickup", hint: "e.g. every 2 weeks, Tuesday" },
      { key: "unit_ids", label: "Used by", type: "multi", full: true, dependsOn: "building_id", hint: "Tick the units sharing this bin – none ticked = all units of the building",
        options: (f) => unitOptionsOf(f.building_id, (u) => !isAncillary(u)) },
      { key: "active", label: "In use", type: "checkbox", default: 1 },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Bin", value: (r) => `<strong>${esc(r.bin_type)}</strong>` },
      { label: "Size", value: (r) => (r.size_l ? r.size_l + " l" : "–"), num: true },
      { label: "No.", value: (r) => esc(r.bin_no || "") },
      { label: "Used by", value: (r) => esc(binUsers(r)) },
      { label: "Pickup", value: (r) => esc(r.pickup || "") },
      { label: "Provider", value: (r) => esc(r.provider || "") },
      { label: "Status", value: (r) => (r.active ? '<span class="pill ok">in use</span>' : '<span class="pill grey">not in use</span>') },
    ],
  },

  payments: {
    title: "Payments", singular: "Payment", newLabel: "New payment",
    display: (r) => `${CATEGORIES[r.category] || r.category} ${fmtMonth(r.month)} – ${leaseShort(byId("leases", r.lease_id))}`,
    fields: [
      { key: "lease_id", label: "Lease", type: "select", required: true, full: true, options: leaseOptions },
      { key: "month", label: "Month", type: "month", required: true },
      { key: "category", label: "Category", type: "select", required: true, options: () => Object.entries(CATEGORIES).map(([value, label]) => ({ value, label })) },
      { key: "amount", label: "Amount received (€)", type: "number", required: true, hint: "negative = refund to the tenant" },
      { key: "paid_on", label: "Received on", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [],
  },

  settlements: {
    title: "Utility settlements", singular: "Utility settlement", newLabel: "New utility settlement",
    display: (r) => `${r.period_year} – ${leaseShort(byId("leases", r.lease_id))}`,
    fields: [
      { key: "lease_id", label: "Lease", type: "select", required: true, full: true, options: leaseOptions },
      { key: "period_year", label: "Billing period (year)", type: "number", required: true, default: new Date().getFullYear() - 1 },
      { key: "amount", label: "Balance (€)", type: "number", required: true, hint: "positive = tenant pays extra · negative = refund" },
      { key: "issued_on", label: "Sent to tenant on", type: "date" },
      { key: "first_due_month", label: "First payment due", type: "month", required: true, default: thisMonth() },
      { key: "installments", label: "Number of monthly installments", type: "number", required: true, default: 1, hint: "> 1 = paid in installments together with the monthly rent" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Period", value: (r) => `<strong>${r.period_year}</strong>` },
      { label: "Lease", value: (r) => esc(leaseLabel(byId("leases", r.lease_id))) },
      { label: "Balance", value: (r) => fmtMoney(r.amount), num: true },
      { label: "Payment plan", value: (r) => (r.installments > 1 ? `${r.installments} × ${fmtMoney(settlementSchedule(r)[0].amount)} from ${fmtMonth(r.first_due_month)}` : `due ${fmtMonth(r.first_due_month)}`) },
      { label: "Status", value: (r) => settlementStatus(r) },
    ],
    related: (r) => [settlementPlanBlock(r), settlementNotesBlock(r)],
    formTop: (values) => settlementNotesBlock({ lease_id: values.lease_id }),
  },

  reminders: {
    title: "Reminders", singular: "Reminder", newLabel: "New reminder",
    display: (r) => r.title,
    fields: [
      { key: "kind", label: "When to remind", type: "select", required: true, full: true, default: "settlement",
        options: () => [{ value: "settlement", label: "Before the utility settlement of the unit" }, { value: "date", label: "On a specific date" }] },
      { key: "unit_id", label: "Unit", type: "select", full: true, emptyLabel: "– none –", options: () => [...db.units].sort(cmpUnits).map((u) => ({ value: u.id, label: unitLabel(u) })) },
      { key: "title", label: "Reminder", required: true, full: true, hint: "e.g. Include insurance costs" },
      { key: "amount", label: "Amount (€)", type: "number" },
      { key: "due_date", label: "Due date", type: "date", hint: "only for date reminders" },
      { key: "done", label: "Done", type: "checkbox", default: 0 },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    columns: [
      { label: "Reminder", value: (r) => `<strong>${esc(r.title)}</strong>` },
      { label: "When", value: (r) => (r.kind === "settlement" ? "Before utility settlement" : `On ${fmtDate(r.due_date)}`) },
      { label: "Unit", value: (r) => esc(r.unit_id ? unitLabel(byId("units", r.unit_id)) : "–") },
      { label: "Amount", value: (r) => fmtMoney(r.amount), num: true },
      { label: "Status", value: (r) => (r.done ? '<span class="pill grey">done</span>' : '<span class="pill free">open</span>') },
    ],
  },
};

function statusPill(unit) {
  const l = currentLease(unit.id);
  if (l) return '<span class="pill ok">let</span>';
  if (unit.parent_unit_id) {
    const p = byId("units", unit.parent_unit_id);
    return `<span class="pill ${p && currentLease(p.id) ? "ok" : "grey"}">with ${esc(p?.code || "?")}</span>`;
  }
  if (unit.shared_unit_ids) {
    const owners = ownerUnits(unit);
    return `<span class="pill ${owners.some((o) => currentLease(o.id)) ? "ok" : "grey"}" title="${esc(owners.map((o) => o.code).join(", "))}">shared (${owners.length})</span>`;
  }
  const future = db.leases.find((x) => x.unit_id === unit.id && x.start_date > today());
  if (future) return `<span class="pill grey">from ${fmtDate(future.start_date)}</span>`;
  return '<span class="pill free">vacant</span>';
}
function leaseStatus(l) {
  const t = today();
  if (l.start_date > t) return '<span class="pill grey">planned</span>';
  if (l.end_date && l.end_date < t) return '<span class="pill grey">ended</span>';
  return '<span class="pill ok">active</span>';
}
/** FIFO allocation of settlement payments to the lease's settlements */
function settlementAllocation(l) {
  let pool = paidTotal(l, "settlement");
  return Object.fromEntries(leaseSettlements(l).map((s) => {
    const amt = Number(s.amount) || 0;
    let covered;
    if (amt >= 0) { covered = Math.max(0, Math.min(amt, pool)); pool -= covered; }
    else { covered = Math.min(0, Math.max(amt, pool)); pool -= covered; }
    return [s.id, round2(covered)];
  }));
}
function settlementStatus(s) {
  const l = byId("leases", s.lease_id);
  if (!l) return "";
  const covered = settlementAllocation(l)[s.id] || 0;
  const amt = Number(s.amount) || 0;
  if (Math.abs(amt - covered) < 0.01) return `<span class="pill ok">${amt < 0 ? "refunded" : "paid"}</span>`;
  const sched = settlementSchedule(s);
  const dueNow = round2(sum(sched.filter((x) => x.ym <= lastDueMonth(l)), (x) => x.amount));
  const open = fmtMoney(Math.abs(amt - covered));
  if (amt > 0 && covered < dueNow - 0.009) return `<span class="pill danger">${open} overdue</span>`;
  return `<span class="pill free">${open} open</span>`;
}
function settlementPlanBlock(s) {
  const l = byId("leases", s.lease_id);
  const sched = settlementSchedule(s);
  let pool = (l && settlementAllocation(l)[s.id]) || 0;
  return `<div class="section-title"><span>Payment plan</span></div>
    <div class="related"><table><thead><tr><th>#</th><th>Due</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
    ${sched.map((x) => { const c = Math.min(Math.abs(pool), Math.abs(x.amount)); pool = Math.sign(pool) * (Math.abs(pool) - c);
      const ok = Math.abs(c - Math.abs(x.amount)) < 0.01;
      return `<tr><td>${x.k}/${x.n}</td><td>${fmtMonth(x.ym)}</td><td class="num">${fmtMoney(x.amount)}</td><td>${ok ? '<span class="pill ok">paid</span>' : l && x.ym <= lastDueMonth(l) ? '<span class="pill danger">overdue</span>' : '<span class="pill grey">upcoming</span>'}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="muted" style="font-size:12px">Payments are recorded on the <a class="link" href="#/rent/payments">Payments</a> page (row “Utility settlement”) and allocated to the oldest open settlement first.</p>`;
}
function settlementNotesBlock(s) {
  const l = s.lease_id ? byId("leases", s.lease_id) : null;
  const notes = l ? db.reminders.filter((r) => r.kind === "settlement" && !r.done && (r.unit_id === l.unit_id || r.lease_id === l.id)) : [];
  if (!notes.length) return "";
  return `<div class="callout warn" style="margin-top:14px"><strong>Remember for this settlement:</strong><ul>${notes.map((r) => `<li>${esc(r.title)}${r.amount ? ` – <strong>${fmtMoney(r.amount)}</strong>` : ""}${r.notes ? ` <span class="muted">(${esc(r.notes)})</span>` : ""}</li>`).join("")}</ul></div>`;
}

// ---------------------------------------------------------------- navigation
// Three sections (bottom tab bar on phones, sidebar on PC) → sub-pages (chip row on phones).
const NAV = [
  { group: "Overview", icon: "dashboard", items: [
    { id: "overview/rent", label: "Rental Income", icon: "banknote", render: renderRent },
    { id: "overview/tenants", label: "Tenants & Units", icon: "users", render: renderTenantsUnits },
    { id: "overview/meters", label: "Meter Data", icon: "gauge", render: renderMeterData },
  ] },
  { group: "Rent Control", icon: "wallet", badge: () => computeReminders().filter((r) => r.level !== "info").length, items: [
    { id: "rent/by-tenant", label: "By Tenant", icon: "user", render: () => renderRentCards("tenant") },
    { id: "rent/by-unit", label: "By Unit", icon: "home", render: () => renderRentCards("unit") },
    { id: "rent/payments", label: "Payment Grid", icon: "calendar", render: renderPayments },
    { id: "rent/settlements", label: "Utility Settlements", icon: "calculator", entity: "settlements", noCount: true },
    { id: "rent/deposits", label: "Deposits", icon: "shield", render: renderDeposits },
    { id: "rent/reminders", label: "Reminders", icon: "bell", render: renderReminders, badge: () => computeReminders().filter((r) => r.level !== "info").length },
  ] },
  { group: "Data Setup", icon: "database", items: [
    { id: "admin/buildings", label: "Buildings", icon: "building", entity: "buildings" },
    { id: "admin/units", label: "Units", icon: "home", entity: "units" },
    { id: "admin/tenants", label: "Tenants", icon: "user", entity: "tenants" },
    { id: "admin/meters", label: "Meters", icon: "gauge", entity: "meters" },
    { id: "admin/leases", label: "Leases", icon: "file", entity: "leases" },
    { id: "admin/checklists", label: "Move-in / Move-out", icon: "checklist", render: renderChecklists, badge: () => openMoveTasks() },
    { id: "admin/templates", label: "Document Templates", icon: "layers", entity: "documents", filter: (r) => r.status === "Template", presets: { status: "Template" }, newLabel: "New template" },
    { id: "admin/documents", label: "Documents", icon: "folder", entity: "documents", filter: (r) => r.status !== "Template" },
    { id: "admin/keys", label: "Keys", icon: "key", entity: "keys" },
    { id: "admin/waste", label: "Waste bins", icon: "bin", entity: "waste_bins" },
  ] },
];
const SETTINGS_ITEM = { id: "admin/settings", label: "Settings", icon: "settings", render: () => renderSettings(), group: "Settings" };
const allNavItems = () => NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
const currentRoute = () => location.hash.replace(/^#\/?/, "") || "home";
const phoneMQ = window.matchMedia("(max-width: 820px)");
const isPhone = () => phoneMQ.matches;

/** route → page; "admin/tenants/12" is the Tenant Details page below Data Setup → Tenants */
function routeItem(route) {
  if (route === "overview/checklists") route = "admin/checklists"; // old bookmark
  if (route === "home") return { id: "home", group: "", label: "Property Administration", render: renderHome };
  const m = route.match(/^admin\/tenants\/(\d+)$/);
  if (m) return { id: route, parent: "admin/tenants", group: "Data Setup", label: "Tenant Details", render: () => renderTenantDetail(Number(m[1])) };
  if (route === SETTINGS_ITEM.id) return { ...SETTINGS_ITEM };
  return allNavItems().find((i) => i.id === route) || allNavItems()[0];
}

// last visited sub-page per section, so the bottom tabs return to where you were
const lastSub = (() => { try { return JSON.parse(localStorage.getItem("pa_last_sub") || "{}"); } catch { return {}; } })();
function rememberSub(group, id) {
  if (!NAV.some((g) => g.group === group)) return;
  lastSub[group] = id;
  try { localStorage.setItem("pa_last_sub", JSON.stringify(lastSub)); } catch {}
}

function renderNav(activeId, activeGroup) {
  const countOf = (i) => (i.filter ? db[i.entity].filter(i.filter).length : db[i.entity].length);
  // PC sidebar like the sketch: three section buttons; the active one unfolds its sub-pages below it
  $("#nav").innerHTML = NAV.map((g) => { const open = g.group === activeGroup, gBadge = g.badge ? g.badge() : 0;
    return `<div class="nav-group${open ? " open" : ""}">
      <a class="nav-section${open ? " active" : ""}" href="#/${open ? g.items[0].id : lastSub[g.group] || g.items[0].id}">${icon(g.icon, 20)}<span>${esc(g.group)}</span>${gBadge && !open ? `<span class="nav-count alert">${gBadge}</span>` : ""}</a>
      ${open ? `<div class="nav-subs">${g.items.map((i) => { const badge = i.badge ? i.badge() : 0;
        return `<a class="nav-link ${activeId === i.id ? "active" : ""}" href="#/${i.id}">
        <span class="nav-label">${icon(i.icon, 18)}<span>${esc(i.label)}</span></span>${badge ? `<span class="nav-count alert">${badge}</span>` : i.entity && !i.noCount ? `<span class="nav-count">${countOf(i)}</span>` : ""}</a>`; }).join("")}</div>` : ""}
    </div>`; }).join("") + `<div class="nav-group nav-settings"><a class="nav-link ${activeId === SETTINGS_ITEM.id ? "active" : ""}" href="#/${SETTINGS_ITEM.id}"><span class="nav-label">${icon("settings", 18)}<span>Settings</span></span></a></div>`;
}

/** start page: one big tile per section (Overview / Rent Control / Data Setup) */
function renderHome() {
  $("#crumb").textContent = "";
  $("#view").innerHTML = `<div class="home-tiles">${NAV.map((g) => { const badge = g.badge ? g.badge() : 0;
    return `<a class="home-tile" href="#/${lastSub[g.group] || g.items[0].id}">
      <div class="ht-head">${icon(g.icon, 34)}<span class="ht-title">${esc(g.group)}</span>${badge ? `<span class="nav-count alert">${badge}</span>` : ""}</div>
      <div class="ht-subs">${g.items.map((i) => `<span>${esc(i.label)}</span>`).join("")}</div></a>`; }).join("")}</div>`;
}

/** phone: bottom tab bar with the three sections */
function renderTabbar(item) {
  $("#tabbar").innerHTML = NAV.map((g) => { const badge = g.badge ? g.badge() : 0;
    const target = lastSub[g.group] || g.items[0].id;
    return `<a class="tab ${item.group === g.group ? "active" : ""}" href="#/${item.group === g.group ? g.items[0].id : target}">
      <span class="tab-ic">${icon(g.icon, 22)}${badge ? `<span class="tab-badge">${badge}</span>` : ""}</span><span>${esc(g.group)}</span></a>`; }).join("");
}

/** phone: horizontally scrolling chips with the sub-pages of the current section */
function renderSubnav(activeId, group) {
  const g = NAV.find((x) => x.group === group);
  const el = $("#subnav");
  if (!g) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = g.items.map((i) => { const badge = i.badge ? i.badge() : 0;
    return `<a class="chip ${activeId === i.id ? "active" : ""}" href="#/${i.id}">${esc(i.label)}${badge ? `<span class="chip-badge">${badge}</span>` : ""}</a>`; }).join("");
  const act = el.querySelector(".chip.active");
  if (act) el.scrollLeft = Math.max(0, act.offsetLeft - (el.clientWidth - act.offsetWidth) / 2);
}

/** distinct colour per unit (stable within a building); common meters are grey */
const UNIT_PALETTE = ["#2f7fd1", "#d98a1c", "#2a9d8f", "#8e5bd6", "#d1495b", "#4c9a2a", "#c2185b", "#0097a7", "#a1887f", "#5c6bc0", "#e0a100", "#00897b", "#7cb342", "#6d4c41"];
function unitColor(buildingId, unitId) {
  if (!unitId) return "#8a96a3";
  const ids = db.units.filter((u) => u.building_id === Number(buildingId)).map((u) => u.id);
  const i = ids.indexOf(Number(unitId));
  return UNIT_PALETTE[(i < 0 ? 0 : i) % UNIT_PALETTE.length];
}
/** unit sections inside the building sections (Data Admin lists) */
const SUBGROUP_BY = { meters: (r) => r.unit_id || null };

/** building a record belongs to (used to section the Data Admin lists) */
const GROUP_BY = {
  documents: (r) => r.building_id,
  keys: (r) => r.building_id,
  waste_bins: (r) => r.building_id,
  units: (r) => r.building_id,
  meters: (r) => r.building_id,
  leases: (r) => byId("units", r.unit_id)?.building_id,
  settlements: (r) => byId("units", byId("leases", r.lease_id)?.unit_id)?.building_id,
  tenants: (r) => {
    const ls = db.leases.filter((l) => l.tenant_id === r.id).sort((a, b) => (leaseActiveOn(b, today()) - leaseActiveOn(a, today())) || b.start_date.localeCompare(a.start_date));
    return ls[0] ? byId("units", ls[0].unit_id)?.building_id : null;
  },
};

const pageState = {}; // remember filters per page
function render() {
  const route = currentRoute();
  const item = routeItem(route);
  const navId = item.parent || item.id;
  rememberSub(item.group, navId);
  renderNav(navId, item.group);
  renderTabbar(item);
  renderSubnav(navId, item.group);
  $("#crumb").textContent = item.group;
  $("#title").textContent = item.label;
  $("#backBtn").hidden = !item.parent;
  $("#backBtn").onclick = () => { location.hash = "#/" + item.parent; };
  $("#topActions").innerHTML = "";
  if (item.entity) renderEntityList(item.entity, item);
  else item.render();
  updateStickyOffset();
}
let _lastPhone = isPhone();
phoneMQ.addEventListener?.("change", () => { if (isPhone() !== _lastPhone) { _lastPhone = isPhone(); if (db.buildings.length || db.units.length) render(); } });

// ---------------------------------------------------------------- Data Admin lists
function renderEntityList(key, item = {}) {
  const ent = ENTITIES[key];
  const st = (pageState[item.id || key] ||= { q: "" });
  const newLabel = item.newLabel || ent.newLabel;
  const openNew = () => openForm(key, null, item.presets || {});
  // tenants open their own detail page (Name & rent · Meters · Documents); everything else the edit form
  const openRow = (id) => (key === "tenants" ? (location.hash = `#/admin/tenants/${id}`) : openForm(key, byId(key, id)));
  $("#topActions").innerHTML = `
    <div class="search-wrap">${icon("search", 18)}<input class="input search" id="search" placeholder="Search …" value="${esc(st.q)}"></div>
    <button class="btn primary" id="newBtn" title="${esc(newLabel)}">${icon("plus", 18)} <span class="btn-text">${esc(newLabel)}</span></button>`;
  $("#newBtn").onclick = openNew;
  const search = $("#search");
  search.oninput = () => { st.q = search.value; drawTable(); };

  function drawTable() {
    const q = st.q.trim().toLowerCase();
    const all = item.filter ? db[key].filter(item.filter) : db[key];
    const rows = all.filter((r) => !q || ent.columns.map((c) => String(c.value(r)).replace(/<[^>]+>/g, "")).join(" ").toLowerCase().includes(q));
    if (UNIT_OF[key]) rows.sort((a, b) => cmpUnits(UNIT_OF[key](a), UNIT_OF[key](b)) || (a.meter_type || "").localeCompare(b.meter_type || "") || (b.period_year || 0) - (a.period_year || 0));
    drawCards(rows, q, all);
  }

  /** one tappable card per record, foldable sections per building (and per unit for meters) */
  function drawCards(rows, q, all) {
    const cols = ent.columns.filter((c) => !c.hideMobile);
    const card = (r, color) => {
      const vals = cols.map((c) => ({ c, v: String(c.value(r) ?? "") }));
      const side = vals.filter((x) => x.c.label === "Status").map((x) => x.v).join("");
      const [first, ...rest] = vals.filter((x) => x.c.label !== "Status");
      const meta = rest.filter((x) => x.v.replace(/<[^>]+>/g, "").trim() && x.v !== "–").map((x) => `<span class="mc-meta"><em>${esc(x.c.label)}</em> ${x.v}</span>`).join("");
      return `<button type="button" class="mcard" data-id="${r.id}"${color ? ` style="--uc:${color}"` : ""}>
        <div class="mc-main"><div class="mc-title">${first ? first.v : esc(ent.display(r))}</div><div class="mc-metas">${meta}</div></div>${side ? `<div class="mc-side">${side}</div>` : ""}${icon("chevronRight", 18)}</button>`;
    };
    const groupOf = GROUP_BY[key], subOf = SUBGROUP_BY[key];
    let body;
    if (groupOf) {
      const sections = [...db.buildings.map((b) => ({ id: b.id, label: buildingShort(b) })), { id: null, label: key === "tenants" ? "Without lease" : "Without building" }]
        .map((s) => ({ ...s, rs: rows.filter((r) => (groupOf(r) ?? null) === s.id) })).filter((s) => s.rs.length);
      const toggled = (st.mopen ||= new Set());
      body = sections.map((s) => {
        const open = !!q || sections.length === 1 || (isPhone() === toggled.has(`b:${s.id}`)); // PC: open by default, phone: closed
        let inner = "";
        if (open) inner = !subOf ? s.rs.map((r) => card(r)).join("") : [...orderedUnits(s.id).map((u) => u.id), null].map((uid) => {
          const sub = s.rs.filter((r) => (subOf(r) ?? null) === uid);
          if (!sub.length) return "";
          const u = uid ? byId("units", uid) : null, c = unitColor(s.id, uid);
          return `<div class="mc-sub"><span class="dot" style="background:${c}"></span>${u ? esc(u.code) : "Common (building)"}<span class="muted">${sub.length}</span></div>${sub.map((r) => card(r, c)).join("")}`;
        }).join("");
        return `<section class="mgroup${open ? " open" : ""}"><button type="button" class="mg-head" data-fold="b:${s.id}">${icon("building", 16)}<span>${esc(s.label)}</span><span class="mg-count">${s.rs.length}</span>${icon("chevronRight", 16)}</button>${inner}</section>`;
      }).join("");
    } else body = rows.map((r) => card(r)).join("");
    $("#view").innerHTML = rows.length ? `<div class="mlist">${body}</div>`
      : `<div class="card"><div class="empty">${all.length ? "No matches." : `No ${esc((item.label || ent.title).toLowerCase())} yet.<br><br><button class="btn primary" id="emptyNew">${icon("plus", 18)} ${esc(newLabel)}</button>`}</div></div>`;
    $("#view").querySelectorAll(".mcard").forEach((c) => (c.onclick = () => openRow(c.dataset.id)));
    $("#view").querySelectorAll(".mg-head").forEach((h) => (h.onclick = () => { if (q) return; const k = h.dataset.fold, o = st.mopen; o.has(k) ? o.delete(k) : o.add(k); drawTable(); }));
    const en = $("#emptyNew"); if (en) en.onclick = openNew;
  }
  drawTable();
}

// ---------------------------------------------------------------- form drawer
const drawerStack = [];

function showDrawer() {
  $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
  $("#backdrop").classList.add("open");
}
function openForm(key, record, presets = {}, push = false) {
  if (!push) drawerStack.length = 0;
  drawerStack.push({ key, id: record?.id ?? null, presets });
  drawForm();
  showDrawer();
}
function closeDrawer() {
  drawerStack.length = 0;
  $("#drawer").classList.remove("wide");
  $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true");
  $("#backdrop").classList.remove("open");
}
function drawerBack() { drawerStack.pop(); drawerStack.length ? drawForm() : closeDrawer(); }

function fieldHtml(f, values) {
  const v = values[f.key] ?? "";
  const id = "f_" + f.key;
  const label = `<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label>`;
  const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : "";
  const cls = "field" + (f.full || f.type === "textarea" ? " full" : "");
  if (f.type === "checkbox") {
    return `<div class="${cls} check"><input type="checkbox" id="${id}" name="${f.key}" ${Number(v) ? "checked" : ""}><label for="${id}">${esc(f.label)}</label></div>`;
  }
  if (f.type === "select") {
    const opts = f.options(values);
    const empty = f.required ? '<option value="">– please select –</option>' : `<option value="">${esc(f.emptyLabel || "–")}</option>`;
    return `<div class="${cls}">${label}<select class="input" id="${id}" name="${f.key}">${empty}${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${hint}</div>`;
  }
  if (f.type === "multi") {
    return `<div class="${cls}"><label>${esc(f.label)}</label><div class="multi-checks" id="${id}">${multiChecks(f, values)}</div>${hint}</div>`;
  }
  if (f.type === "textarea") return `<div class="${cls}">${label}<textarea class="input" rows="3" id="${id}" name="${f.key}">${esc(v)}</textarea>${hint}</div>`;
  const type = f.type === "number" ? "text" : (f.type || "text");
  const mode = f.type === "number" ? ' inputmode="decimal"' : "";
  const list = f.list ? ` list="dl_${f.key}"` : "";
  const dl = f.list ? `<datalist id="dl_${f.key}">${(typeof f.list === "function" ? f.list() : f.list).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
  return `<div class="${cls}">${label}<input class="input" type="${type}"${mode}${list} id="${id}" name="${f.key}" value="${esc(v)}">${dl}${hint}</div>`;
}

function multiChecks(f, values) {
  const sel = new Set(String(values[f.key] ?? "").split(",").filter(Boolean));
  const opts = f.options(values);
  if (!opts.length) return '<span class="muted">– no units in this building –</span>';
  return opts.map((o) => `<label class="check"><input type="checkbox" value="${esc(o.value)}" ${sel.has(String(o.value)) ? "checked" : ""}> ${esc(o.label)}</label>`).join("");
}

function readForm(ent) {
  const out = {};
  for (const f of ent.fields) {
    const el = document.getElementById("f_" + f.key);
    if (!el) continue;
    out[f.key] = f.type === "checkbox" ? (el.checked ? 1 : 0)
      : f.type === "multi" ? [...el.querySelectorAll("input:checked")].map((c) => c.value).join(",") : el.value;
  }
  return out;
}

function drawForm() {
  $("#drawer").classList.remove("wide");
  const { key, id, presets } = drawerStack[drawerStack.length - 1];
  const ent = ENTITIES[key];
  const record = id ? byId(key, id) : null;
  const values = record ? { ...record } : Object.fromEntries(ent.fields.map((f) => [f.key, f.default ?? ""]));
  Object.assign(values, presets);

  $("#drawerTitle").textContent = record ? `${ent.singular}: ${ent.display(record)}` : ent.newLabel;
  const related = record && ent.related ? ent.related(record).join("") : "";
  $("#drawerBody").innerHTML = `
    <div class="form-error" id="formError"></div>
    <div id="formTop">${!record && ent.formTop ? ent.formTop(values) : ""}</div>
    <form id="entityForm" class="form-grid" autocomplete="off">${ent.fields.map((f) => fieldHtml(f, values)).join("")}</form>
    ${related}
    ${record && ATTACHABLE.includes(key) ? attachmentsBlock(key, record) : ""}
    ${!record && (ent.related || ATTACHABLE.includes(key)) && key !== "settlements" ? '<p class="muted" style="margin-top:18px">Linked records, photos and files can be added here after saving.</p>' : ""}`;
  $("#drawerFoot").innerHTML = `
    ${drawerStack.length > 1 ? `<button class="btn" id="backBtn">${icon("arrowLeft", 18)} Back</button>` : ""}
    ${record ? `<button class="btn danger" id="delBtn">${icon("trash", 18)} Delete</button>` : ""}
    <div class="right"><button class="btn" id="cancelBtn">Cancel</button><button class="btn primary" id="saveBtn">${icon("check", 18)} Save</button></div>`;

  // dependent selects (e.g. the unit depends on the building)
  const form = $("#entityForm");
  form.addEventListener("change", (e) => {
    const changed = e.target.name;
    ent.fields.filter((f) => f.dependsOn === changed).forEach((f) => {
      const cur = { ...readForm(ent), id };
      const el = document.getElementById("f_" + f.key);
      if (f.type === "multi") { el.innerHTML = multiChecks(f, { ...cur, [f.key]: "" }); return; }
      const opts = f.options(cur);
      el.innerHTML = `<option value="">${esc(f.emptyLabel || "–")}</option>` + opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    });
    if (key === "meters" && changed === "meter_type") {
      const mu = $("#f_measure_unit");
      if (!mu.value) mu.value = METER_TYPES[e.target.value] || "";
    }
    if (ent.formTop && !record && changed === "lease_id") $("#formTop").innerHTML = ent.formTop(readForm(ent));
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });

  async function save() {
    try {
      const payload = readForm(ent);
      const pending = key === "meters" ? pendingReading() : null;
      if (pending && pending.error) return showFormError(pending.error);
      if (key === "documents" && payload.lease_id) {
        const l = byId("leases", payload.lease_id);
        if (l && !payload.tenant_id) payload.tenant_id = String(l.tenant_id);
        if (l && !payload.unit_id && byId("units", l.unit_id)?.building_id === Number(payload.building_id)) payload.unit_id = String(l.unit_id);
      }
      const saved = record ? await api("PUT", `${key}/${record.id}`, payload) : await api("POST", key, payload);
      if (pending) await storeReading(pending);
      if (key === "unit_rooms") await syncUnitArea(Number(payload.unit_id), record?.unit_id);
      await loadAll();
      toast(pending ? (pending.photo ? "Meter, reading and photo saved" : "Meter and reading saved") : `${ent.singular} saved`);
      render();
      if (drawerStack.length > 1) { drawerStack.pop(); drawForm(); }
      else if (key === "payments") closeDrawer();
      else { drawerStack[0].id = saved.id; drawerStack[0].presets = {}; drawForm(); }
    } catch (err) { showFormError(err.message); }
  }
  $("#saveBtn").onclick = save;
  $("#cancelBtn").onclick = closeDrawer;
  if ($("#backBtn")) $("#backBtn").onclick = drawerBack;
  if ($("#delBtn")) $("#delBtn").onclick = async () => {
    if (!await askConfirm(`Really delete ${ent.singular.toLowerCase()} “${ent.display(record)}”?`)) return;
    try {
      await api("DELETE", `${key}/${record.id}`);
      if (key === "unit_rooms") await syncUnitArea(record.unit_id);
      await loadAll(); toast(`${ent.singular} deleted`); render(); drawerBack();
    } catch (err) { showFormError(err.message); }
  };
  bindRelated();
  bindAttachments($("#drawerBody"), () => { render(); drawForm(); });
  const first = form.querySelector("input:not([type=checkbox]), select");
  if (first && !record) setTimeout(() => first.focus(), 200);
}
function showFormError(msg) {
  const top = drawerStack[drawerStack.length - 1];
  if (top && ENTITIES[top.key]) ENTITIES[top.key].fields.forEach((f) => { msg = msg.replace(new RegExp(`\\b${f.key}\\b`, "g"), f.label); });
  const el = $("#formError"); el.textContent = msg; el.classList.add("show"); $("#drawerBody").scrollTop = 0;
}

const keyLabel = (k) => (k ? `${k.key_type}${k.key_no ? " #" + k.key_no : ""}${k.unit_id ? " – " + (byId("units", k.unit_id)?.code || "") : ""}` : "?");
/** unit area = sum of its rooms (after the factor for sloped ceilings / balconies) */
async function syncUnitArea(...unitIds) {
  await loadAll();
  for (const uid of new Set(unitIds.filter(Boolean).map(Number))) {
    const u = byId("units", uid); if (!u || !unitRooms(uid).length) continue;
    const area = roomsArea(uid);
    if (Number(u.area) !== area) await api("PUT", `units/${uid}`, { area });
  }
}
function roomsBlock(u) {
  const rooms = unitRooms(u.id);
  const block = relatedBlock("Rooms & living area (for the lease)", "unit_rooms", rooms,
    [["Room", (r) => esc(r.name)], ["Deduction", (r) => esc(r.area_note || "")], ["Floor area", (r) => (r.base_area != null ? fmtNum(r.base_area) + " m²" : "–")],
     ["Factor", (r) => ((r.factor ?? 1) === 1 ? "" : fmtNum(r.factor))], ["Counts", (r) => fmtNum(roomArea(r)) + " m²"]],
    { unit_id: u.id, factor: 1, sort_no: rooms.length + 1 }, "+ Room");
  if (!rooms.length) return block;
  return block.replace(/<\/tbody><\/table><\/div>$/, `<tr class="total"><td colspan="4"><strong>Living area (Wohnfläche)</strong></td><td><strong>${fmtNum(roomsArea(u.id))} m²</strong></td></tr></tbody></table></div>`);
}
function checklistBlock(l, phase) {
  const p = checklistProgress(l, phase);
  return `<div class="section-title"><span>${icon("checklist", 16)} ${phase === "in" ? "Move-in" : "Move-out"} checklist (${p.done}/${p.total})</span>
    ${phase === "in" && !leaseHasMoveOut(l) ? `<button class="btn small" data-start-out="${l.id}">${icon("plus", 16)} Start move-out</button>` : ""}</div>
    <div class="related checklist">${CHECKLIST[phase].map((sec) => `<div class="cl-sec">${esc(sec.section)}</div>
      ${sec.items.map((it) => { const st = checkState(l, phase, it);
        return `<label class="cl-item${st.done ? " done" : ""}"><input type="checkbox" data-check="${l.id}:${phase}:${it.key}" ${st.done ? "checked" : ""} ${st.auto ? "disabled" : ""}>
          <span>${esc(it.label)}${st.auto ? ` <span class="pill ok">${it.doc ? "document filed" : "recorded"}</span>` : it.doc ? ' <span class="muted">· ticks itself once the document is signed / filed</span>' : ""}${st.row?.done_on && !st.auto && st.done ? ` <span class="muted">· ${fmtDate(st.row.done_on)}</span>` : ""}</span></label>`; }).join("")}`).join("")}</div>`;
}
async function toggleCheck(target, checked) {
  const [lid, phase, item_key] = target.split(":");
  const row = db.checklist.find((c) => c.lease_id === Number(lid) && c.phase === phase && c.item_key === item_key);
  const data = { lease_id: lid, phase, item_key, done: checked ? 1 : 0, done_on: checked ? today() : "" };
  if (row) await api("PUT", `checklist/${row.id}`, data); else await api("POST", "checklist", data);
  await loadAll();
}
/** leases with a move-in or move-out going on (started up to 90 days ago / starting or ending within 60 days / ended up to 180 days ago) */
function movingLeases() {
  const t = today();
  return db.leases.filter((l) => (l.start_date >= addDays(t, -90) && l.start_date <= addDays(t, 60)) || (l.end_date && l.end_date >= addDays(t, -180) && l.end_date <= addDays(t, 60)));
}
/** open checklist items of current moves (menu badge) */
function openMoveTasks() {
  return movingLeases().reduce((n, l) => { const p = checklistProgress(l, currentPhase(l)); return n + p.total - p.done; }, 0);
}

// ---------------------------------------------------------------- Word templates → documents
// A template is a document with status "Template" and a .docx file containing {{placeholders}}.
// A table row containing {{#raum}} is repeated for every room of the unit.
const GEN_TYPES = { lease: "Mietvertrag", handover: "Übergabeprotokoll", landlord_confirmation: "Wohnungsgeberbestätigung",
  deposit_account: "Mietkautionskonto", self_disclosure: "Mieterselbstauskunft" };
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const isDocx = (a) => /\.docx$/i.test(a.filename);
/** best template for a unit: same unit > same building > building in the same country */
function findTemplate(type, unit) {
  const b = byId("buildings", unit?.building_id);
  const score = (d) => (d.unit_id ? (d.unit_id === unit?.id ? 3 : -1) : d.building_id === b?.id ? 2 : byId("buildings", d.building_id)?.country === b?.country ? 1 : -1);
  return db.documents.filter((d) => d.status === "Template" && d.doc_type === type && attachmentsOf("documents", d.id).some(isDocx))
    .map((d) => [score(d), d]).filter(([sc]) => sc >= 0).sort((x, y) => y[0] - x[0] || y[1].id - x[1].id)[0]?.[1] || null;
}
const DE = {
  num: (v, min = 1) => (v == null || v === "" ? "" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: min, maximumFractionDigits: 2 })),
  money: (v) => (v == null || v === "" ? "" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €"),
  date: (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ""),
};
const ANREDE_DE = { "Mr.": "Herr", "Ms.": "Frau", "Mr. and Mrs.": "Herr und Frau", Company: "Firma" };
/** persons of a tenant record: main tenant + co-tenant ("Vorname Nachname" or just the first name) */
function tenantPersons(t) {
  if (!t) return [];
  const out = [];
  if (t.first_name || t.last_name) out.push({ vorname: t.first_name || "", nachname: t.last_name || "" });
  else if (t.company) out.push({ vorname: "", nachname: t.company });
  if (t.co_tenant) {
    const parts = t.co_tenant.trim().split(/\s+/);
    const nach = parts.length > 1 ? parts.pop() : t.last_name || "";
    out.push({ vorname: parts.join(" "), nachname: nach });
  }
  return out;
}
const personsText = (t) => tenantPersons(t).map((x) => `${x.vorname} ${x.nachname}`.trim()).join(" und ");
/** all placeholder values for a lease (phase "in" / "out") */
function docValues(l, phase) {
  const u = byId("units", l.unit_id), b = byId("buildings", u?.building_id), t = byId("tenants", l.tenant_id);
  const others = db.leases.filter((x) => x.unit_id === l.unit_id && x.id !== l.id);
  const prev = others.filter((x) => x.start_date < l.start_date).sort((a, c) => c.start_date.localeCompare(a.start_date))[0];
  const next = others.filter((x) => x.start_date > l.start_date).sort((a, c) => a.start_date.localeCompare(c.start_date))[0];
  const pName = (x) => (x ? personsText(byId("tenants", x.tenant_id)) || "-" : "-");
  const date = phase === "out" ? l.end_date || today() : l.start_date;
  const persons = tenantPersons(t);
  const addr = t?.street ? `, ${t.street}, ${[t.zip, t.city].filter(Boolean).join(" ")}` : "";
  const v = {
    mieter: (t?.company && !(t.first_name || t.last_name) ? t.company : personsText(t)) + addr,
    mieter_name: personsText(t), anrede: ANREDE_DE[t?.salutation] || t?.salutation || "", vorname: t?.first_name || "", nachname: t?.last_name || t?.company || "",
    email: t?.email || "", telefon: t?.phone || "",
    mietbeginn: DE.date(l.start_date), mietende: DE.date(l.end_date),
    nettomiete: DE.money(l.cold_rent), nebenkosten: DE.money((l.service_charge || 0) + (l.heating_charge || 0)), heizkosten: DE.money(l.heating_charge),
    sonstiges: DE.money(l.other_charge), gesamtmiete: DE.money(leaseTotal(l)), kaution: DE.money(l.deposit),
    objekt_strasse: `${b?.street || ""} ${b?.house_no || ""}`.trim(), objekt_plz_ort: `${b?.zip || ""} ${b?.city || ""}`.trim(),
    ort: b?.city || "", einheit: u?.code || "", einheit_kurz: u?.doc_label || u?.code || "",
    wohnflaeche: unitRooms(u?.id).length ? DE.num(roomsArea(u.id)) + " m²" : u?.area ? DE.num(u.area) + " m²" : "",
    datum: DE.date(today()), ablesedatum: DE.date(date), einzugsdatum: DE.date(date), ein_aus: phase === "out" ? "ausgezogen" : "eingezogen",
    mieter_alt: phase === "out" ? personsText(t) : pName(prev), mieter_neu: phase === "out" ? pName(next) : personsText(t),
  };
  v.objekt_adresse = `${v.objekt_strasse}, ${v.objekt_plz_ort}`;
  for (let i = 0; i < 3; i++) { v[`p${i + 1}_vorname`] = persons[i]?.vorname || ""; v[`p${i + 1}_nachname`] = persons[i]?.nachname || ""; }
  // meters of the unit + reading on the handover date
  const METER_KEYS = { kw: (m) => /cold/i.test(m), ww: (m) => /hot/i.test(m), wm: (m) => /^heat$/i.test(m), strom: (m) => /^electricity$/i.test(m) };
  for (const [k, test] of Object.entries(METER_KEYS)) {
    const m = db.meters.find((x) => x.unit_id === u?.id && x.active && test(x.meter_type || ""));
    const r = m && db.meter_readings.find((x) => x.meter_id === m.id && x.reading_date === date);
    v[`zaehler_${k}_nr`] = m?.number || ""; v[`zaehler_${k}_stand`] = r ? DE.num(r.value, 0) + (m.measure_unit ? " " + m.measure_unit : "") : "";
  }
  // keys: up to 3 rows from the recorded handovers, otherwise the usual set of the template
  const hs = db.key_handovers.filter((h) => h.lease_id === l.id);
  const keyRows = hs.length ? hs.slice(0, 3).map((h) => { const k = byId("keys", h.key_id) || {};
      return [String((phase === "out" ? h.returned_quantity : h.quantity) ?? ""), (k.opens || k.key_type || "") + (k.key_no ? ` (Nr. ${k.key_no})` : "")]; })
    : [["3", "Haustüre = Wohnungstüre = Kellerzugang = Fahrradabstellraum"], ["2", "Briefkasten"], ["", "Keller (privat)"]];
  for (let i = 0; i < 3; i++) { v[`s${i + 1}_anzahl`] = keyRows[i]?.[0] || ""; v[`s${i + 1}_text`] = keyRows[i]?.[1] || ""; }
  const rooms = unitRooms(u?.id).map((r) => ({
    raum: r.name, raum_abzug: (r.factor ?? 1) !== 1 ? DE.num(r.factor, 2) : r.area_note || "",
    raum_grundflaeche: (r.factor ?? 1) !== 1 ? DE.num(r.base_area) : "", raum_flaeche: DE.num(roomArea(r)) + " m²",
  }));
  return { vals: v, loops: { raum: rooms } };
}
const xmlText = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
const fillVals = (x, vals) => x.replace(/\{\{([a-z0-9_]+)\}\}/gi, (m, k) => (k in vals ? xmlText(vals[k]) : m));
function fillXml(x, vals, loops) {
  x = x.replace(/\{\{(?:(?!\}\}).){0,400}?\}\}/gs, (m) => m.replace(/<[^>]+>/g, "")); // placeholders Word split into several runs
  for (const [name, items] of Object.entries(loops)) {
    const mark = `{{#${name}}}`;
    for (let i = x.indexOf(mark); i >= 0; i = x.indexOf(mark)) {
      const a = Math.max(x.lastIndexOf("<w:tr>", i), x.lastIndexOf("<w:tr ", i)), e = x.indexOf("</w:tr>", i);
      if (a < 0 || e < 0) { x = x.replace(mark, ""); continue; }
      const row = x.slice(a, e + 7).replace(mark, "");
      x = x.slice(0, a) + items.map((it) => fillVals(row, it)).join("") + x.slice(e + 7);
    }
  }
  return fillVals(x, vals);
}
async function fillDocx(bytes, vals, loops) {
  await rcLoadXlsx(); // SheetJS includes the zip reader/writer (CFB)
  const CFB = XLSX.CFB, z = CFB.read(bytes, { type: "array" });
  for (const full of z.FullPaths) {
    const path = full.replace(/^[^/]*\//, "/");
    if (!/^\/word\/(document|header\d*|footer\d*)\.xml$/.test(path)) continue;
    const e = CFB.find(z, path);
    const xml = fillXml(new TextDecoder().decode(new Uint8Array(e.content)), vals, loops);
    CFB.utils.cfb_add(z, path, new TextEncoder().encode(xml));
  }
  return new Uint8Array(CFB.write(z, { type: "array", fileType: "zip", compression: true }));
}
/** fill the template for `type` with the data of lease `l`, store it as a new draft document of the lease */
async function generateDoc(type, l, phase) {
  const u = byId("units", l.unit_id), tpl = findTemplate(type, u);
  if (!tpl) throw new Error(`No template for ${GEN_TYPES[type]} – add one under Data Setup → Document Templates.`);
  const att = attachmentsOf("documents", tpl.id).filter(isDocx).sort((a, c) => c.id - a.id)[0];
  const res = await fetch(await Backend.resolveFileUrl(att));
  if (!res.ok) throw new Error("The template file could not be loaded.");
  const { vals, loops } = docValues(l, phase);
  const out = await fillDocx(new Uint8Array(await res.arrayBuffer()), vals, loops);
  const t = byId("tenants", l.tenant_id);
  const who = (t?.last_name || t?.company || "Mieter").replace(/[\\/:*?"<>|]/g, "");
  const phaseDe = type === "handover" || type === "landlord_confirmation" ? (phase === "out" ? " Auszug" : " Einzug") : "";
  const name = `${GEN_TYPES[type]}${phaseDe} - ${(u.doc_label || u.code).replace(/[\\/:*?"<>|]/g, "")} - ${who} (${today()}).docx`;
  const doc = await api("POST", "documents", { building_id: u.building_id, unit_id: u.id, lease_id: l.id, tenant_id: l.tenant_id, doc_type: type,
    phase: phase === "out" ? "Move-out" : "Move-in", title: name.replace(/\.docx$/, ""), doc_date: today(), status: "Draft",
    notes: `Created from template “${tpl.title}”. Check it, print it and set the status to “Signed / returned” once the signed copy is uploaded.` });
  await uploadFiles("documents", doc.id, [new File([out], name, { type: DOCX_MIME })]);
  await loadAll();
  return byId("documents", doc.id);
}
function generateBar(l) {
  const u = byId("units", l.unit_id), ph = currentPhase(l);
  const btns = Object.entries(GEN_TYPES).filter(([type]) => findTemplate(type, u)).map(([type, label]) =>
    `<button class="btn small" data-gen="${type}:${l.id}:${type === "handover" || type === "landlord_confirmation" ? ph : "in"}">${icon("file", 16)} ${esc(label)}${type === "handover" || type === "landlord_confirmation" ? (ph === "out" ? " (Auszug)" : " (Einzug)") : ""}</button>`);
  return `<div class="section-title"><span>${icon("file", 16)} Create from template (${esc(docLanguage(byId("buildings", u?.building_id)))})</span></div>
    <div class="gen-bar">${btns.length ? btns.join("") : '<span class="muted">No templates for this unit yet – add a Word file under Data Setup → Document Templates.</span>'}</div>`;
}

function relatedBlock(title, key, rows, cols, presets, addLabel) {
  return `
    <div class="section-title"><span>${esc(title)} (${rows.length})</span>
      <button class="btn small" data-add="${key}" data-presets='${esc(JSON.stringify(presets))}'>${icon("plus", 16)} ${esc(addLabel.replace(/^\+ /, ""))}</button></div>
    <div class="related">${rows.length ? `<table><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="clickable" data-open="${key}" data-id="${r.id}">${cols.map((c) => `<td>${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : '<div class="empty" style="padding:14px">Nothing assigned yet.</div>'}</div>`;
}

function readingsBlock(meter) {
  const rows = db.meter_readings.filter((r) => r.meter_id === meter.id).sort((a, b) => b.reading_date.localeCompare(a.reading_date));
  const unit = esc(meter.measure_unit || "");
  return `
    <div class="section-title"><span>${icon("gauge", 16)} Meter readings (${rows.length})</span></div>
    <div class="related">
      ${rows.length ? `<table><thead><tr><th>Date</th><th class="num">Reading</th><th class="num">Consumption</th><th>Type</th><th>Photo</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => { const prev = rows[i + 1]; const photos = attachmentsOf("meter_readings", r.id);
          return `<tr data-drop="meter_readings:${r.id}" title="Drop a photo here to attach it to this reading"><td>${fmtDate(r.reading_date)}</td><td class="num">${fmtNum(r.value)} ${unit}</td>
          <td class="num">${prev ? fmtNum(r.value - prev.value) + " " + unit : "–"}</td><td>${esc(r.reading_type || "")}</td>
          <td><span class="thumbs">${photos.map((a) => `<a ${attHref(a)} target="_blank" rel="noopener">${isImage(a) ? `<img ${attSrc(a)} loading="lazy" alt="">` : icon("file", 18)}</a>`).join("")}
            <label class="icon-btn" title="Add photo">${icon("camera", 18)}<input type="file" accept="image/*" capture="environment" data-upload="meter_readings:${r.id}" hidden></label></span></td>
          <td class="num"><button class="icon-btn danger" data-del-reading="${r.id}" title="Delete reading">${icon("trash", 18)}</button></td></tr>`; }).join("")}
      </tbody></table>` : '<div class="empty" style="padding:14px">No readings recorded yet.</div>'}
      <div class="new-reading">
      <div class="new-reading-head"><button class="btn primary small" id="rd_add" data-meter="${meter.id}">${icon("plus", 16)} Add reading</button><span class="muted">Fill in the fields below, then press Add reading (or Save)</span></div>
      <div class="inline-form">
        <div class="field"><label>Reading date</label><input class="input" type="date" id="rd_date"></div>
        <div class="field"><label>Reading (${unit || "value"})</label><input class="input" id="rd_value" inputmode="decimal"></div>
        <div class="field"><label>Type</label><select class="input" id="rd_type"><option>Own reading</option><option>Tenant</option><option>Utility provider</option><option>Move-in</option><option>Move-out</option><option>Estimate</option></select></div>
        <div class="field"><label>Photo of the meter</label><label class="btn photo-btn" id="rd_photo_lbl" title="Take, choose or drop a photo">${icon("camera", 18)} <span id="rd_photo_name">Take / choose photo</span><input type="file" accept="image/*" capture="environment" id="rd_photo" hidden></label></div>
        <button class="icon-btn danger rd-clear" id="rd_clear" title="Clear the entry fields">${icon("trash", 18)}</button>
      </div>
      </div>
    </div>`;
}

/** reading typed into the meter panel but not yet stored (null = nothing entered) */
function pendingReading() {
  const add = $("#rd_add"); if (!add) return null;
  const value = $("#rd_value").value.trim(), photo = $("#rd_photo").files[0] || null;
  if (!value && !photo && !$("#rd_date").value) return null;
  if (!value) return { error: "Please enter the meter reading for the chosen photo." };
  if (!$("#rd_date").value) return { error: "Please enter the reading date." };
  return { meter_id: Number(add.dataset.meter), reading_date: $("#rd_date").value, value: value.replace(/\s/g, "").replace(",", "."), reading_type: $("#rd_type").value, photo };
}
async function storeReading(p) {
  const { photo, ...row } = p;
  const reading = await api("POST", "meter_readings", row);
  if (photo) await uploadFiles("meter_readings", reading.id, [photo]);
}

/** "Create from template" buttons (lease form and Tenant Details) */
function bindGenButtons(root) {
  root.querySelectorAll("[data-gen]").forEach((b) => (b.onclick = async () => {
    const [type, lid, phase] = b.dataset.gen.split(":");
    b.disabled = true; const label = b.innerHTML; b.textContent = "Creating …";
    try {
      const doc = await generateDoc(type, byId("leases", lid), phase);
      toast(`${GEN_TYPES[type]} created – open the file, check it and print it`); render(); openForm("documents", doc, {}, true);
    } catch (err) { toast(err.message, true); b.disabled = false; b.innerHTML = label; }
  }));
}
function bindRelated() {
  const body = $("#drawerBody");
  body.querySelectorAll("[data-check]").forEach((c) => (c.onchange = async () => {
    try { await toggleCheck(c.dataset.check, c.checked); render(); drawForm(); } catch (err) { toast(err.message, true); }
  }));
  bindGenButtons(body);
  body.querySelectorAll("[data-start-out]").forEach((b) => (b.onclick = async () => {
    try { await api("POST", "checklist", { lease_id: b.dataset.startOut, phase: "out", item_key: "appointment", done: 0 }); await loadAll(); drawForm(); } catch (err) { toast(err.message, true); }
  }));
  body.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => openForm(b.dataset.add, null, JSON.parse(b.dataset.presets), true)));
  body.querySelectorAll("tr[data-open]").forEach((tr) => (tr.onclick = () => openForm(tr.dataset.open, byId(tr.dataset.open, tr.dataset.id), {}, true)));
  const add = $("#rd_add");
  const photo = $("#rd_photo");
  if (photo) photo.onchange = () => { $("#rd_photo_name").textContent = photo.files[0] ? photo.files[0].name : "Take / choose photo"; $("#rd_photo_lbl").classList.toggle("chosen", !!photo.files[0]); };
  // drag & drop a photo onto the new-reading entry (the whole grey box) = choose it for the reading
  const entry = body.querySelector(".new-reading");
  if (entry && photo) {
    entry.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; entry.classList.add("over"); };
    entry.ondragleave = (e) => { if (!entry.contains(e.relatedTarget)) entry.classList.remove("over"); };
    entry.ondrop = (e) => {
      e.preventDefault(); e.stopPropagation(); entry.classList.remove("over");
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/") || /\.(heic|jpe?g|png|webp)$/i.test(x.name));
      if (!f) return toast("Please drop an image file", true);
      const dt = new DataTransfer(); dt.items.add(f); photo.files = dt.files; photo.onchange();
      toast("Photo chosen – enter the reading and press Add reading or Save");
    };
  }
  if (add) add.onclick = async () => {
    const pending = pendingReading();
    if (!pending) return showFormError("Please enter the meter reading.");
    if (pending.error) return showFormError(pending.error);
    try {
      add.disabled = true;
      await storeReading(pending);
      await loadAll(); toast(pending.photo ? "Reading and photo saved" : "Reading added"); render(); drawForm();
    } catch (err) { add.disabled = false; showFormError(err.message); }
  };
  const clear = $("#rd_clear");
  if (clear) clear.onclick = () => {
    $("#rd_date").value = ""; $("#rd_value").value = ""; $("#rd_type").selectedIndex = 0; photo.value = "";
    $("#rd_photo_name").textContent = "Take / choose photo"; $("#rd_photo_lbl").classList.remove("chosen");
  };
  const val = $("#rd_value");
  if (val) val.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add.click(); } };
  body.querySelectorAll("[data-del-reading]").forEach((b) => (b.onclick = async () => {
    if (!await askConfirm("Delete this reading?")) return;
    try { await api("DELETE", `meter_readings/${b.dataset.delReading}`); await loadAll(); render(); drawForm(); }
    catch (err) { showFormError(err.message); }
  }));
}

// ---------------------------------------------------------------- shared filters
/** Segmented building selector: one button per building (new buildings appear automatically) + "All". */
function buildingFilterHtml(st) {
  const btn = (val, label, ic) => `<button type="button" class="seg-btn ${String(st.building || "") === String(val) ? "active" : ""}" data-building="${val}">${icon(ic, 18)}<span>${esc(label)}</span></button>`;
  return `<div class="seg" role="group" aria-label="Building">${db.buildings.map((b) => btn(b.id, b.name || `${b.street} ${b.house_no || ""}`.trim(), "building")).join("")}${btn("", "All", "layers")}</div>`;
}
function bindBuildingFilter(st, rerender) {
  document.querySelectorAll("#topActions [data-building]").forEach((b) => (b.onclick = () => { st.building = b.dataset.building; rerender(); }));
}
const filterBuildings = (st) => db.buildings.filter((b) => !st.building || b.id === Number(st.building));
function emptyHint(text, route, btn) {
  return `<div class="card"><div class="empty">${text}<br><br><a class="btn primary" href="#/${route}">${icon("plus", 18)} ${btn}</a></div></div>`;
}

// ---------------------------------------------------------------- month range slider (shared by Rental Income and Payments)
const monthDiff = (a, b) => { const [y1, m1] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };
function rangeBounds() {
  const cur = thisMonth();
  const firstPay = db.payments.map((p) => p.month).sort()[0];
  const min = [trackingStart(), firstPay, addMonths(cur, -24)].filter(Boolean).sort()[0];
  return { min, max: addMonths(cur, 12) };
}
const rangeLabel = (from, to) => (from === to ? fmtMonth(from) : `${fmtMonth(from)} – ${fmtMonth(to)}`);
function rangePresets() {
  const cur = thisMonth(), y = cur.slice(0, 4);
  const ly = String(Number(y) - 1);
  return [["month", "This month", cur, cur], ["3m", "Last 3 months", addMonths(cur, -2), cur], ["year", "This year", `${y}-01`, cur], ["12m", "Last 12 months", addMonths(cur, -11), cur], ["lastyear", `Last year (${ly})`, `${ly}-01`, `${ly}-12`]];
}
/** Dual-handle slider with monthly steps; st.from / st.to hold YYYY-MM. */
function monthRangeHtml(st) {
  const { min, max } = rangeBounds();
  st.from = [st.from, min].sort().pop(); st.to = [st.to, max].sort()[0];
  if (st.from > st.to) st.from = st.to;
  const n = monthDiff(min, max);
  const ticks = Array.from({ length: n + 1 }, (_, i) => addMonths(min, i)).map((ym, i) => {
    const isJan = ym.endsWith("-01");
    return `<span class="tick ${isJan ? "major" : ""} ${ym === thisMonth() ? "now" : ""}" style="left:${(i / n) * 100}%">${isJan || i === 0 ? `<b>${ym.slice(0, 4)}</b>` : ""}</span>`;
  }).join("");
  const count = monthDiff(st.from, st.to) + 1;
  return `<div class="card period">
    <div class="period-head">
      <span class="period-label">${icon("calendar", 20)} <strong id="prLabel">${rangeLabel(st.from, st.to)}</strong> <span class="muted" id="prCount">${count} month${count > 1 ? "s" : ""}</span></span>
      <div class="seg">${rangePresets().map(([k, label, f, t]) => `<button type="button" class="seg-btn ${st.from === f && st.to === t ? "active" : ""}" data-preset="${k}">${label}</button>`).join("")}</div>
    </div>
    <div class="range2" data-min="${min}" data-n="${n}">
      <div class="r-track"></div><div class="r-fill" id="prFill"></div>
      <input type="range" id="prFrom" min="0" max="${n}" step="1" value="${monthDiff(min, st.from)}" aria-label="From month">
      <input type="range" id="prTo" min="0" max="${n}" step="1" value="${monthDiff(min, st.to)}" aria-label="To month">
      <div class="r-ticks">${ticks}</div>
    </div>
  </div>`;
}
function bindMonthRange(st, rerender) {
  const box = $(".range2"); if (!box) return;
  const min = box.dataset.min, n = Number(box.dataset.n);
  const from = $("#prFrom"), to = $("#prTo");
  const paint = () => {
    const a = Number(from.value), b = Number(to.value);
    $("#prFill").style.left = `calc(9px + (100% - 18px) * ${a / n})`;
    $("#prFill").style.width = `calc((100% - 18px) * ${(b - a) / n})`;
    $("#prLabel").textContent = rangeLabel(addMonths(min, a), addMonths(min, b));
    $("#prCount").textContent = `${b - a + 1} month${b - a ? "s" : ""}`;
    from.style.zIndex = a > n - 2 ? 5 : 3; // keep the left handle reachable at the right end
  };
  from.oninput = () => { if (Number(from.value) > Number(to.value)) to.value = from.value; paint(); };
  to.oninput = () => { if (Number(to.value) < Number(from.value)) from.value = to.value; paint(); };
  const commit = () => { st.from = addMonths(min, Number(from.value)); st.to = addMonths(min, Number(to.value)); rerender(); };
  from.onchange = commit; to.onchange = commit;
  document.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
    const pr = rangePresets().find((x) => x[0] === b.dataset.preset); st.from = pr[2]; st.to = pr[3]; rerender();
  }));
  paint();
}
const monthHead = (ym, i) => `${MONTHS[Number(ym.slice(5)) - 1]}${i === 0 || ym.endsWith("-01") ? `<small>${ym.slice(0, 4)}</small>` : ""}`;

// ---------------------------------------------------------------- Overview: rental income
function renderRent() {
  // only the period filter + three tiles (Net rent / Received / Expected); a tile opens its details right below it
  const st = (pageState.rent ||= { from: thisMonth(), to: thisMonth(), detail: "" });
  $("#topActions").innerHTML = "";

  if (!db.leases.length) { $("#view").innerHTML = emptyHint("No leases yet – rental income is calculated from them.", "admin/leases", "Add leases"); return; }

  const yms = monthsBetween(st.from, st.to);
  const label = rangeLabel(st.from, st.to);
  const multi = yms.length > 1;
  const leases = db.leases.filter((l) => byId("units", l.unit_id) && yms.some((ym) => leaseActiveInMonth(l, ym)));
  const activeMonths = (l) => yms.filter((ym) => leaseActiveInMonth(l, ym)).length;
  const exp = (l, f) => (Number(f(l)) || 0) * activeMonths(l);
  const got = (l) => sum(yms, (ym) => paid(l, ym, "rent") + paid(l, ym, "service"));
  const total = sum(leases, (l) => exp(l, leaseTotal)), cold = sum(leases, (l) => exp(l, (x) => x.cold_rent));
  const received = sum(leases, got), missing = round2(total - received);
  const groups = db.buildings.map((b) => ({ b, ls: leases.filter((l) => byId("units", l.unit_id)?.building_id === b.id).sort(cmpLeasesByUnit) })).filter((g) => g.ls.length);
  const unitTitle = (l) => { const u = byId("units", l.unit_id); return `${esc(u.code)} <span class="muted">${esc(u.unit_type || "")}</span>`; };
  const tenantSub = (l) => `${icon("user", 14)} ${esc(tenantName(byId("tenants", l.tenant_id)))}`;
  const color = (l) => unitColor(byId("units", l.unit_id).building_id, l.unit_id);
  const cardsBy = (sumOf, card) => `<div class="cgrid">${groups.map((g) => sectionHead(g.b, fmtMoney(sum(g.ls, sumOf))) + g.ls.map(card).join("")).join("")}</div>`;

  // ---- details behind each tile
  const details = {
    net: () => `<p class="rd-intro muted">Base rent without prepayments${multi ? " – sums over the selected months" : ""}. On top: <strong>${fmtMoney(total - cold)}</strong> prepayments / other.</p>
      ${cardsBy((l) => exp(l, (x) => x.cold_rent), (l) => { const u = byId("units", l.unit_id), n = exp(l, (x) => x.cold_rent);
        return ucard({ title: unitTitle(l), sub: tenantSub(l), metas: [u.area ? metaKV("€/m²", fmtNum(l.cold_rent / u.area, 2)) : "", u.area ? metaKV("Area", fmtNum(u.area) + " m²") : "", multi ? metaKV("Months", activeMonths(l)) : ""],
          side: `<strong>${fmtMoney(n)}</strong>${multi ? `<span class="muted">${fmtMoney(l.cold_rent)} / month</span>` : ""}`, color: color(l), attrs: `data-lease="${l.id}"` }); })}`,
    received: () => {
      const overview = multi ? yms : monthsBetween(`${st.from.slice(0, 4)}-01`, `${st.from.slice(0, 4)}-12`);
      const months = overview.map((ym) => { const ls = leasesInMonth(ym);
        return { ym, total: sum(ls, leaseTotal), received: sum(ls, (l) => paid(l, ym, "rent") + paid(l, ym, "service")) }; });
      const maxM = Math.max(1, ...months.map((m) => m.total));
      return `<div class="card month-card"><div class="card-head"><h3>${multi ? label : st.from.slice(0, 4)} by month</h3><span class="muted">${icon("info", 16)} Tap a month to see who paid how much</span></div>
        <div class="card-body"><div class="mbars">${months.map((m) => { const late = m.ym <= thisMonth() && m.received < m.total - 0.01;
          return `<button type="button" class="mbar ${yms.includes(m.ym) ? "sel" : ""}" data-ym="${m.ym}" title="${esc(`${fmtMonth(m.ym)}: expected ${fmtMoney(m.total)}, received ${fmtMoney(m.received)}`)}">
            <span class="mbar-amt">${m.received ? fmtAmt(Math.round(m.received)) : "–"}</span>
            <span class="mbar-col"><span class="mbar-exp${late ? " miss" : ""}" style="height:${(m.total / maxM) * 100}%"></span><span class="mbar-got" style="height:${(Math.min(m.received, m.total) / maxM) * 100}%"></span></span>
            <span class="mbar-m">${MONTHS[Number(m.ym.slice(5)) - 1]}</span></button>`; }).join("")}</div>
          <div class="mbar-legend"><span><i class="lg got"></i>received</span><span><i class="lg exp"></i>expected</span><span><i class="lg miss"></i>missing (due)</span></div></div></div>
        ${cardsBy(got, (l) => { const t = exp(l, leaseTotal), r = got(l), due = yms.some((ym) => isDue(l, ym));
          return ucard({ title: unitTitle(l), sub: tenantSub(l), metas: [metaKV("Expected", fmtMoney(t))],
            side: `<strong>${fmtMoney(r)}</strong>${r >= t - 0.01 ? '<span class="pill ok">complete</span>' : `<span class="pill ${due ? "danger" : "free"}">${fmtMoney(t - r)} ${due ? "missing" : "open"}</span>`}`,
            color: color(l), attrs: `data-lease="${l.id}"`, cls: r < t - 0.01 && due ? "warn" : "" }); })}`;
    },
    expected: () => `<p class="rd-intro muted">Base rent plus prepayments as agreed in the leases${multi ? ` – Ø ${fmtMoney(total / yms.length)} per month` : ""}.</p>
      ${cardsBy((l) => exp(l, leaseTotal), (l) => { const parts = [["Base", (x) => x.cold_rent], ["Service", (x) => x.service_charge], ["Heating", (x) => x.heating_charge], ["Other", (x) => x.other_charge]]
          .map(([k, f]) => [k, exp(l, f)]).filter((x) => x[1]);
        return ucard({ title: unitTitle(l), sub: tenantSub(l), metas: [...parts.map(([k, v]) => metaKV(k, fmtMoney(v))), multi ? metaKV("Months", activeMonths(l)) : ""],
          side: `<strong>${fmtMoney(exp(l, leaseTotal))}</strong>`, color: color(l), attrs: `data-lease="${l.id}"` }); })}`,
  };

  const tile = (key, cls, title, value, sub) => `
    <button type="button" class="rtile ${cls}${st.detail === key ? " open" : ""}" data-detail="${key}" aria-expanded="${st.detail === key}">
      <span class="rt-text"><span class="rt-label">${title}</span><span class="rt-value">${value}</span><span class="rt-sub">${sub}</span></span>
      <span class="rt-chev">${icon("chevronRight", 22)}</span></button>
    ${st.detail === key ? `<div class="rdetail">${details[key]()}</div>` : ""}`;

  $("#view").innerHTML = `<div class="sticky-top">${monthRangeHtml(st)}</div>
    <div class="rtiles">
      ${tile("net", "rt-net", `Net rent ${label}`, fmtMoney(cold), `${fmtMoney(total - cold)} prepayments / other on top`)}
      ${tile("received", "rt-received", `Received ${label}`, fmtMoney(received),
        missing > 0.009 ? `<span class="rt-miss">${fmtMoney(missing)} not yet received</span>` : "fully received")}
      ${tile("expected", "rt-expected", `Expected ${label}`, fmtMoney(total), `incl. prepayments${multi ? ` · Ø ${fmtMoney(total / yms.length)} per month` : ""} · ${leases.length} lease(s)`)}
    </div>`;
  bindMonthRange(st, renderRent);
  updateStickyOffset();
  $("#view").querySelectorAll(".rtile").forEach((b) => (b.onclick = () => { st.detail = st.detail === b.dataset.detail ? "" : b.dataset.detail; renderRent(); }));
  $("#view").querySelectorAll(".mbar").forEach((b) => (b.onclick = () => openMonthDetail(b.dataset.ym, "")));
  bindCards("[data-lease]", (c) => openForm("leases", byId("leases", c.dataset.lease)));
}

// ---------------------------------------------------------------- Overview: tenants & units
function renderTenantsUnits() {
  const st = (pageState.tu ||= { building: "", status: "" });
  $("#topActions").innerHTML = `<div class="filters">${buildingFilterHtml(st)}
    <label>Status</label><select class="input" id="flt_status">
      <option value="">All</option><option value="rented" ${st.status === "rented" ? "selected" : ""}>let</option><option value="free" ${st.status === "free" ? "selected" : ""}>vacant</option></select></div>`;
  bindBuildingFilter(st, renderTenantsUnits);
  $("#flt_status").onchange = (e) => { st.status = e.target.value; renderTenantsUnits(); };

  if (!db.units.length) { $("#view").innerHTML = emptyHint("No units yet.", "admin/units", "Add units"); return; }

  const isRented = (u) => !!currentLease(u.id) || ownerUnits(u).some((o) => !!currentLease(o.id));
  const ordered = (bid) => orderedUnits(bid).filter((u) => !isAncillary(u) || currentLease(u.id));
  const groups = filterBuildings(st).map((b) => ({ b, units: ordered(b.id).filter((u) => !st.status || (st.status === "rented" ? isRented(u) : !isRented(u))) })).filter((g) => g.units.length);
  const activeTenants = new Set(db.leases.filter((l) => leaseActiveOn(l, today())).map((l) => l.tenant_id));
  const mainUnits = db.units.filter((u) => RENTABLE.includes(u.unit_type));
  const rentedCount = mainUnits.filter((u) => currentLease(u.id)).length;
  const livingArea = sum(mainUnits, (u) => u.area);

  $("#view").innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Buildings</div><div class="kpi-value">${db.buildings.length}</div></div>
      <div class="kpi"><div class="kpi-label">Apartments / commercial</div><div class="kpi-value">${mainUnits.length}</div><div class="kpi-sub">${rentedCount} let · ${mainUnits.length - rentedCount} vacant · ${db.units.length - mainUnits.length} ancillary units</div></div>
      <div class="kpi"><div class="kpi-label">Active tenants</div><div class="kpi-value">${activeTenants.size}</div><div class="kpi-sub">${db.tenants.length} tenants on record</div></div>
      <div class="kpi"><div class="kpi-label">Lettable area</div><div class="kpi-value">${fmtNum(livingArea)} m²</div></div>
    </div>
    ${groups.length ? `<div class="cgrid">${groups.map((g) => sectionHead(g.b, `${g.units.length} unit(s)`) + g.units.map((u) => {
      const l = currentLease(u.id), t = l && byId("tenants", l.tenant_id);
      const extras = db.units.filter((x) => x.building_id === u.building_id && ownerUnits(x).some((o) => o.id === u.id));
      const nMeters = db.meters.filter((m) => m.unit_id === u.id).length;
      return ucard({ title: `${esc(u.code)} <span class="muted">${esc(u.unit_type || "")}${u.floor ? " · " + esc(u.floor) : ""}</span>`,
        sub: t ? `${icon("user", 14)} <a class="link" data-tenant="${t.id}">${esc(tenantName(t))}</a>${t.phone ? ` · <a class="link" href="tel:${esc(t.phone.replace(/[^\d+]/g, ""))}">${esc(t.phone)}</a>` : ""}` : "",
        metas: [u.area ? metaKV("Area", fmtNum(u.area) + " m²") : "", l ? metaKV("Base rent", fmtMoney(l.cold_rent)) : "", l && u.area ? metaKV("€/m²", fmtNum(l.cold_rent / u.area, 2)) : "",
          l ? metaKV("Since", fmtDate(l.start_date)) : "", nMeters ? metaKV("Meters", nMeters) : "",
          extras.length ? metaKV("With", esc(extras.map((x) => x.code).join(", "))) : ""],
        side: `${l ? `<strong>${fmtMoney(leaseTotal(l))}</strong>` : ""}${statusPill(u)}`,
        color: unitColor(u.building_id, u.id), attrs: `data-unit="${u.id}"`, cls: isAncillary(u) ? "minor" : "" }); }).join("")).join("")}</div>`
      : '<div class="card"><div class="empty">No units for this selection.</div></div>'}`;
  $("#view").querySelectorAll("a[data-tenant]").forEach((a) => (a.onclick = (e) => { e.stopPropagation(); location.hash = `#/admin/tenants/${a.dataset.tenant}`; }));
  bindCards("[data-unit]", (c) => openForm("units", byId("units", c.dataset.unit)));
}

// ---------------------------------------------------------------- Overview: meter data
const UNIT_CATEGORY = { Apartment: "apt", House: "apt", Commercial: "com" };
const CATEGORY_LABEL = { apt: "Apartment", com: "Commercial", anc: "Ancillary", common: "Common / building" };
const unitCategory = (u) => (u ? UNIT_CATEGORY[u.unit_type] || "anc" : "common");

function renderMeterData() {
  const st = (pageState.md ||= { building: "", type: "", cat: "" });
  const catBtn = (val, label) => `<button type="button" class="seg-btn ${st.cat === val ? "active" : ""}" data-cat="${val}">${val ? `<span class="dot ${val}"></span>` : ""}<span>${label}</span></button>`;
  $("#topActions").innerHTML = `<div class="filters">${buildingFilterHtml(st)}
    <div class="seg" role="group" aria-label="Category">${catBtn("", "All units")}${catBtn("apt", "Apartments")}${catBtn("com", "Commercial")}${catBtn("common", "Common")}</div>
    <select class="input" id="flt_type" title="Meter type"><option value="">All meter types</option>
      ${[...new Set(db.meters.map((m) => m.meter_type))].sort().map((t) => `<option ${t === st.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
  bindBuildingFilter(st, renderMeterData);
  document.querySelectorAll("#topActions [data-cat]").forEach((b) => (b.onclick = () => { st.cat = b.dataset.cat; renderMeterData(); }));
  $("#flt_type").onchange = (e) => { st.type = e.target.value; renderMeterData(); };

  if (!db.meters.length) { $("#view").innerHTML = emptyHint("No meters yet.", "admin/meters", "Add meters"); return; }

  const readingsOf = (m) => db.meter_readings.filter((r) => r.meter_id === m.id).sort((a, b) => b.reading_date.localeCompare(a.reading_date));
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const isStale = (m) => m.active && (!readingsOf(m)[0] || readingsOf(m)[0].reading_date < yearAgo);
  const visible = db.meters.filter((m) => (!st.type || m.meter_type === st.type) && (!st.cat || unitCategory(byId("units", m.unit_id)) === st.cat));

  // building → unit sections (main units first, ancillary units below their main unit, common meters last)
  const sections = filterBuildings(st).map((b) => {
    const ordered = orderedUnits(b.id);
    const units = ordered.map((u) => ({ u, meters: visible.filter((m) => m.unit_id === u.id) }))
      .concat([{ u: null, meters: visible.filter((m) => m.building_id === b.id && !m.unit_id) }])
      .filter((x) => x.meters.length);
    return { b, units };
  }).filter((s) => s.units.length);

  const mcard = (m, color) => { const rs = readingsOf(m); const last = rs[0], prev = rs[1]; const u = esc(m.measure_unit || "");
    return ucard({ title: `${meterIcon(m.meter_type)}${esc(m.meter_type)} ${m.number ? `<span class="muted">${esc(m.number)}</span>` : '<span class="pill free">no number</span>'}`,
      metas: [metaKV("Location", esc(m.location || "")), last && prev ? metaKV("Consumption", `${fmtNum(last.value - prev.value)} ${u}`) : "", meterDocIcon(m)],
      side: last ? `<strong>${fmtNum(last.value)} ${u}</strong><span class="muted">${fmtDate(last.reading_date)}</span>` : '<span class="pill free">no reading</span>',
      actions: `<button type="button" class="btn small" data-read="${m.id}">${icon("plus", 16)} Reading</button>${m.active ? "" : ' <span class="pill grey">inactive</span>'}${isStale(m) && last ? ' <span class="pill free">reading due</span>' : ""}`,
      color, attrs: `data-meter="${m.id}"`, cls: m.active ? "" : "minor" }); };

  $("#view").innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Meters</div><div class="kpi-value">${db.meters.length}</div><div class="kpi-sub">${db.meters.filter((m) => m.active).length} active</div></div>
      <div class="kpi"><div class="kpi-label">Readings recorded</div><div class="kpi-value">${db.meter_readings.length}</div><div class="kpi-sub">${db.attachments.filter((a) => a.entity === "meter_readings").length} with photo</div></div>
      <div class="kpi"><div class="kpi-label">Reading due</div><div class="kpi-value">${db.meters.filter(isStale).length}</div><div class="kpi-sub">active, no reading in the last 12 months</div></div>
    </div>
    ${sections.length ? `<div class="cgrid">${sections.map((s) => sectionHead(s.b, `${sum(s.units, (x) => x.meters.length)} meters`) + s.units.map(({ u, meters }) => {
      const cat = unitCategory(u), l = u && currentLease(u.id), t = l && byId("tenants", l.tenant_id), c = unitColor(s.b.id, u?.id);
      return `<div class="mc-sub"><span class="dot" style="background:${c}"></span>${u ? (isAncillary(u) ? "↳ " : "") + esc(u.code) : "Common meters (building)"}
        <span class="cat-pill ${cat}">${CATEGORY_LABEL[cat]}</span>${t ? `<span class="muted">${icon("user", 14)} ${esc(tenantName(t))}</span>` : u && RENTABLE.includes(u.unit_type) ? '<span class="pill free">vacant</span>' : ""}</div>
        ${meters.sort((a, b) => a.meter_type.localeCompare(b.meter_type)).map((m) => mcard(m, c)).join("")}`; }).join("")).join("")}</div>`
      : '<div class="card"><div class="empty">No meters for this selection.</div></div>'}`;
  const openMeter = (id, focus) => {
    openForm("meters", byId("meters", id));
    if (focus) setTimeout(() => { const v = $("#rd_value"); if (v) { v.scrollIntoView({ block: "center" }); v.focus(); } }, 220);
  };
  bindCards("[data-meter]", (c) => openMeter(c.dataset.meter, false));
  $("#view").querySelectorAll("[data-read]").forEach((b) => (b.onclick = () => openMeter(b.dataset.read, true)));
}

// ---------------------------------------------------------------- Rent Control: reminders
function reminderHtml(r, i) {
  const btn = { record: ["banknote", "Record payment"], settlement: ["calculator", "Open settlement"], newSettlement: ["plus", "Enter settlement"], reminder: ["arrowRight", "Open"] }[r.action];
  const lvl = { danger: "alert", warn: "clock", info: "info" }[r.level];
  return `<div class="alert ${r.level}"><span class="alert-icon">${icon(lvl, 20)}</span><div class="alert-body"><div class="alert-title">${esc(r.title)}</div><div class="alert-text">${esc(r.text)}</div></div>
    ${btn ? `<button class="btn small" data-rem="${i}">${icon(btn[0], 16)} ${btn[1]}</button>` : ""}</div>`;
}
function bindReminderButtons(list, root = $("#view")) {
  root.querySelectorAll("[data-rem]").forEach((b) => (b.onclick = () => {
    const r = list[Number(b.dataset.rem)];
    if (r.action === "record") openRecordMonth(r.lease);
    else if (r.action === "settlement") openForm("settlements", r.settlement);
    else if (r.action === "newSettlement") openForm("settlements", null, { lease_id: r.lease.id, period_year: r.year, first_due_month: thisMonth(), installments: 1 });
    else if (r.action === "reminder") openForm("reminders", r.reminder);
  }));
}
function renderReminders() {
  $("#topActions").innerHTML = `<button class="btn primary" id="newRem">${icon("plus", 18)} New reminder</button>`;
  $("#newRem").onclick = () => openForm("reminders", null);
  const list = computeReminders();
  const manual = db.reminders;
  $("#view").innerHTML = `
    <div class="card"><div class="card-head"><h3>Open items (${list.length})</h3><span class="muted">calculated from leases, payments, settlements and your reminders</span></div>
      <div class="card-body alerts">${list.length ? list.map(reminderHtml).join("") : '<div class="empty">Nothing to do – all payments are up to date.</div>'}</div></div>
    <div class="card"><div class="card-head"><h3>Your reminders (${manual.length})</h3></div>
      <div class="card-body">${manual.length ? `<div class="cgrid">${manual.map((r) => ucard({ title: esc(r.title),
          metas: [r.kind === "settlement" ? "Before utility settlement" : `On ${fmtDate(r.due_date)}`, r.unit_id ? metaKV("Unit", esc(unitLabel(byId("units", r.unit_id)))) : "", r.notes ? esc(r.notes) : ""],
          side: `${r.amount ? `<strong>${fmtMoney(r.amount)}</strong>` : ""}${r.done ? '<span class="pill grey">done</span>' : '<span class="pill free">open</span>'}`,
          attrs: `data-id="${r.id}"`, cls: r.done ? "minor" : "" })).join("")}</div>`
        : '<div class="empty">No manual reminders yet.</div>'}</div></div>`;
  bindReminderButtons(list);
  bindCards("[data-id]", (c) => openForm("reminders", byId("reminders", c.dataset.id)));
}

// ---------------------------------------------------------------- Rent Control: payments grid
function renderPayments() {
  const y = thisMonth().slice(0, 4);
  const st = (pageState.pay ||= { from: `${y}-01`, to: thisMonth(), building: "" });
  $("#topActions").innerHTML = `<div class="filters">${buildingFilterHtml(st)}
    <button class="btn primary" id="recBtn">${icon("plus", 18)} Record payment</button></div>`;
  bindBuildingFilter(st, renderPayments);
  $("#recBtn").onclick = () => openRecordMonth(null);

  const head = monthRangeHtml(st);
  const yms = monthsBetween(st.from, st.to);
  const label = rangeLabel(st.from, st.to);
  const reminders = computeReminders().filter((r) => r.level !== "info");
  const leases = db.leases.filter((l) => {
    const u = byId("units", l.unit_id);
    if (!u || (st.building && u.building_id !== Number(st.building))) return false;
    return yms.some((ym) => leaseActiveInMonth(l, ym)) || db.payments.some((p) => p.lease_id === l.id && p.month >= st.from && p.month <= st.to);
  });
  const cats = (l) => Object.keys(CATEGORIES).filter((c) => c === "rent" || c === "service"
    ? yms.some((ym) => expected(l, ym, c) || paid(l, ym, c))
    : yms.some((ym) => expected(l, ym, c) || paid(l, ym, c)));
  const yearExp = sum(leases, (l) => sum(yms, (ym) => sum(Object.keys(CATEGORIES), (c) => expected(l, ym, c))));
  const yearGot = sum(leases, (l) => sum(yms, (ym) => sum(Object.keys(CATEGORIES), (c) => paid(l, ym, c))));
  const arrears = round2(sum(leases, (l) => sum(rentArrears(l), (a) => a.missing)));

  const groups = filterBuildings(st).map((b) => ({ b, ls: leases.filter((l) => byId("units", l.unit_id)?.building_id === b.id)
    .sort(cmpLeasesByUnit) })).filter((g) => g.ls.length);

  const cell = (l, ym, c) => {
    const s = cellState(l, ym, c);
    const got = paid(l, ym, c), exp = expected(l, ym, c);
    const tip = `${CATEGORIES[c]} ${fmtMonth(ym)} – expected ${fmtMoney(exp)}, received ${fmtMoney(got)}`;
    const txt = got ? fmtAmt(got) : s === "overdue" ? "!" : s === "none" ? "" : "·";
    return `<td class="pc ${s}" title="${esc(tip)}" data-l="${l.id}" data-ym="${ym}" data-c="${c}">${txt}</td>`;
  };

  $("#view").innerHTML = `<div class="sticky-top">${head}</div>
    ${reminders.length ? `<div class="card"><div class="card-head"><h3>Payments to request (${reminders.length})</h3><a class="link" href="#/rent/reminders">All reminders ${icon("arrowRight", 16)}</a></div>
      <div class="card-body alerts">${reminders.slice(0, 6).map(reminderHtml).join("")}${reminders.length > 6 ? `<div class="muted">… and ${reminders.length - 6} more</div>` : ""}</div></div>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Expected ${label}</div><div class="kpi-value">${fmtMoney(yearExp)}</div><div class="kpi-sub">rent, prepayments, settlements, deposits</div></div>
      <div class="kpi"><div class="kpi-label">Received ${label}</div><div class="kpi-value">${fmtMoney(yearGot)}</div><div class="kpi-sub">${(() => {
        const dueExp = sum(leases, (l) => sum(yms.filter((ym) => isDue(l, ym)), (ym) => sum(Object.keys(CATEGORIES), (c) => expected(l, ym, c))));
        const dueGot = sum(leases, (l) => sum(yms.filter((ym) => isDue(l, ym)), (ym) => sum(Object.keys(CATEGORIES), (c) => paid(l, ym, c))));
        return dueGot >= dueExp - 0.01 ? "everything due so far is received" : `${fmtMoney(dueExp - dueGot)} of the amounts due so far is missing`;
      })()}</div></div>
      <div class="kpi"><div class="kpi-label">Rent arrears (all years)</div><div class="kpi-value ${arrears > 0 ? "neg" : ""}">${fmtMoney(arrears)}</div><div class="kpi-sub">tracked since ${fmtMonth(trackingStart())} · <a class="link" id="editTracking">change</a></div></div>
    </div>
    ${groups.map((g) => `<div class="card"><div class="card-head"><h3>${esc(buildingShort(g.b))}</h3></div><div class="table-wrap"><table class="paygrid">
      <thead><tr><th></th>${yms.map((ym, i) => `<th class="num mh ${ym === thisMonth() ? "cur" : ""}">${monthHead(ym, i)}</th>`).join("")}<th class="num">Received</th><th class="num">Expected</th></tr></thead>
      <tbody>${g.ls.map((l) => `
        <tr class="lease-head"><td colspan="${yms.length + 3}"><a class="link" data-lease="${l.id}">${esc(byId("units", l.unit_id).code)} · ${esc(tenantName(byId("tenants", l.tenant_id)))}</a>
          <span class="muted">${fmtMoney(leaseTotal(l))}/month · since ${fmtDate(l.start_date)}${l.end_date ? " · until " + fmtDate(l.end_date) : ""}</span>
          <button class="btn small" data-record="${l.id}">${icon("banknote", 16)} Record month</button></td></tr>
        ${cats(l).map((c) => `<tr><td class="cat">${CATEGORIES[c]}</td>${yms.map((ym) => cell(l, ym, c)).join("")}
          <td class="num">${fmtAmt(round2(sum(yms, (ym) => paid(l, ym, c))))}</td><td class="num muted">${fmtAmt(round2(sum(yms, (ym) => expected(l, ym, c))))}</td></tr>`).join("")}`).join("")}
      </tbody></table></div></div>`).join("") || '<div class="card"><div class="empty">No leases in the selected period.</div></div>'}
    <div class="legend"><span class="pc ok">paid</span><span class="pc partial">partly paid</span><span class="pc overdue">overdue</span><span class="pc pending">due soon</span><span class="pc extra">unscheduled payment</span>
      <span class="muted">Click a cell to record or correct a payment.</span></div>`;

  bindMonthRange(st, renderPayments);
  updateStickyOffset();
  bindReminderButtons(reminders);
  $("#view").querySelectorAll("td.pc").forEach((td) => (td.onclick = () => openPayment(byId("leases", td.dataset.l), td.dataset.ym, td.dataset.c)));
  $("#view").querySelectorAll("[data-record]").forEach((b) => (b.onclick = () => openRecordMonth(byId("leases", b.dataset.record))));
  $("#view").querySelectorAll("a[data-lease]").forEach((a) => (a.onclick = () => openForm("leases", byId("leases", a.dataset.lease))));
  $("#editTracking").onclick = async () => {
    const v = prompt("Track payments from month (YYYY-MM). Earlier months are not checked for arrears:", trackingStart());
    if (!v || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return;
    db.settings = await api("PUT", "settings", { tracking_start: v }); render();
  };
}


// ---------------------------------------------------------------- card helper (all overview pages)
/** a card: title + optional sub line, meta items, right-hand side (amount / pill), extra body and actions */
function ucard({ title, sub = "", metas = [], side = "", body = "", actions = "", color = "", attrs = "", cls = "", chevron = true }) {
  const m = metas.filter((x) => x && String(x).replace(/<[^>]+>/g, "").trim());
  return `<div class="mcard ucard ${cls}" tabindex="0" role="button" ${attrs}${color ? ` style="--uc:${color}"` : ""}>
    <div class="mc-main"><div class="mc-title">${title}</div>${sub ? `<div class="mc-sub2">${sub}</div>` : ""}
      ${m.length ? `<div class="mc-metas">${m.map((x) => `<span class="mc-meta">${x}</span>`).join("")}</div>` : ""}${body}
      ${actions ? `<div class="mc-actions">${actions}</div>` : ""}</div>
    ${side ? `<div class="mc-side">${side}</div>` : ""}${chevron ? icon("chevronRight", 18) : ""}</div>`;
}
const metaKV = (label, value) => (value == null || value === "" || value === "–" ? "" : `<em>${esc(label)}</em> ${value}`);
const sectionHead = (b, right = "") => `<div class="m-section">${icon("building", 16)} <span>${esc(buildingShort(b))}</span>${right ? `<span class="m-section-r">${right}</span>` : ""}</div>`;
/** click/Enter on a card (inner buttons and links keep their own action) */
function bindCards(sel, fn, root = $("#view")) {
  root.querySelectorAll(sel).forEach((c) => {
    const go = (e) => { if (e.target.closest("button, a, input, label, select")) return; fn(c, e); };
    c.onclick = go; c.onkeydown = (e) => { if (e.key === "Enter") go(e); };
  });
}

// ---------------------------------------------------------------- Rent Control: By Tenant / By Unit (cards, phone-first)
const PAY_LABEL = { ok: "paid", partial: "partly paid", overdue: "overdue", pending: "due soon", extra: "extra payment", none: "–" };
const STATE_RANK = { overdue: 5, partial: 4, pending: 3, extra: 2, ok: 1, none: 0 };
/** combined state of base rent + prepayments for one month */
function monthState(l, ym) {
  const states = ["rent", "service"].map((c) => cellState(l, ym, c));
  return states.reduce((a, s) => (STATE_RANK[s] > STATE_RANK[a] ? s : a), "none");
}
const leaseArrears = (l) => round2(sum(rentArrears(l), (a) => a.missing));

function leasePayCard(l, title, sub, { noTenant = false } = {}) {
  const ym = thisMonth(), s = monthState(l, ym), arrears = leaseArrears(l);
  const months = monthsBetween(addMonths(ym, -5), ym).filter((m) => leaseActiveInMonth(l, m) || paid(l, m, "rent") || paid(l, m, "service"));
  return `<div class="pcard${arrears > 0 ? " late" : ""}" data-lease="${l.id}">
    <div class="pc-top">
      <div class="pc-who"><div class="pc-title">${title}</div><div class="muted">${sub}</div></div>
      <div class="pc-amt"><strong>${fmtMoney(leaseTotal(l))}</strong><span class="muted">/ month</span></div>
    </div>
    <div class="pc-status"><span class="pc ${s} pc-pill">${fmtMonth(ym)}: ${PAY_LABEL[s]}</span>${arrears > 0 ? `<span class="pill danger">${icon("alert", 14)} Arrears ${fmtMoney(arrears)}</span>` : ""}</div>
    <div class="pc-months">${months.map((m) => { const ms = monthState(l, m), got = paid(l, m, "rent") + paid(l, m, "service");
      return `<button type="button" class="mchip pc ${ms}" data-ym="${m}" title="${esc(fmtMonth(m) + " – " + PAY_LABEL[ms])}"><span>${MONTHS[Number(m.slice(5)) - 1]}</span><b>${got ? fmtAmt(round2(got)) : ms === "overdue" ? "!" : "·"}</b></button>`; }).join("")}</div>
    <div class="pc-actions">
      <button type="button" class="btn small primary" data-act="record">${icon("banknote", 16)} Record</button>
      ${noTenant ? "" : `<button type="button" class="btn small" data-act="tenant">${icon("user", 16)} Tenant</button>`}
      <button type="button" class="btn small" data-act="lease">${icon("file", 16)} Lease</button>
    </div>
  </div>`;
}

function bindPayCards(root = $("#view")) {
  root.querySelectorAll(".pcard[data-lease]").forEach((c) => {
    const l = byId("leases", c.dataset.lease);
    c.querySelectorAll(".mchip").forEach((b) => (b.onclick = () => openRecordMonth(l, b.dataset.ym)));
    c.querySelector('[data-act="record"]').onclick = () => openRecordMonth(l);
    const tb = c.querySelector('[data-act="tenant"]'); if (tb) tb.onclick = () => (location.hash = `#/admin/tenants/${l.tenant_id}`);
    c.querySelector('[data-act="lease"]').onclick = () => openForm("leases", l);
  });
}

function renderRentCards(mode) {
  const st = (pageState["rc_" + mode] ||= { building: "", open: false });
  $("#topActions").innerHTML = `<div class="filters">${buildingFilterHtml(st)}
    <label class="toggle"><input type="checkbox" id="onlyOpen" ${st.open ? "checked" : ""}> Only open / arrears</label></div>`;
  bindBuildingFilter(st, () => renderRentCards(mode));
  $("#onlyOpen").onchange = (e) => { st.open = e.target.checked; renderRentCards(mode); };
  if (!db.leases.length) { $("#view").innerHTML = emptyHint("No leases yet – rent control is based on them.", "admin/leases", "Add leases"); return; }

  const ym = thisMonth();
  const inBuilding = (u) => u && (!st.building || u.building_id === Number(st.building));
  const relevant = db.leases.filter((l) => inBuilding(byId("units", l.unit_id)) && (leaseActiveInMonth(l, ym) || leaseArrears(l) > 0));
  const isOpen = (l) => leaseArrears(l) > 0 || ["overdue", "partial"].includes(monthState(l, ym));
  const shown = relevant.filter((l) => !st.open || isOpen(l));
  const expM = sum(relevant.filter((l) => leaseActiveInMonth(l, ym)), (l) => expected(l, ym, "rent") + expected(l, ym, "service"));
  const gotM = sum(relevant, (l) => paid(l, ym, "rent") + paid(l, ym, "service"));
  const arrears = round2(sum(relevant, leaseArrears));
  const kpis = `<div class="kpis compact">
    <div class="kpi kpi-blue"><div class="kpi-label">Received ${fmtMonth(ym)}</div><div class="kpi-value">${fmtMoney(gotM)}</div><div class="kpi-sub">of ${fmtMoney(expM)} expected</div></div>
    <div class="kpi"><div class="kpi-label">Arrears</div><div class="kpi-value ${arrears > 0 ? "neg" : ""}">${fmtMoney(arrears)}</div><div class="kpi-sub">${relevant.filter(isOpen).length} lease(s) open</div></div>
  </div>`;

  let body = "";
  if (mode === "tenant") {
    const name = (l) => tenantName(byId("tenants", l.tenant_id));
    body = [...shown].sort((a, b) => name(a).localeCompare(name(b)) || cmpLeasesByUnit(a, b))
      .map((l) => leasePayCard(l, esc(name(l)), `${icon("home", 14)} ${esc(unitLabel(byId("units", l.unit_id)))}`)).join("");
    if (!body) body = `<div class="card"><div class="empty">${st.open ? "Nothing open – all tenants have paid." : "No active leases."}</div></div>`;
  } else {
    body = filterBuildings(st).map((b) => {
      const cards = orderedUnits(b.id).map((u) => {
        const ls = shown.filter((l) => l.unit_id === u.id).sort((x, y) => y.start_date.localeCompare(x.start_date));
        if (ls.length) return ls.map((l) => leasePayCard(l, `${esc(u.code)} <span class="muted">${esc(u.unit_type || "")}</span>`, `${icon("user", 14)} ${esc(tenantName(byId("tenants", l.tenant_id)))}`)).join("");
        if (st.open || !RENTABLE.includes(u.unit_type) || ownerUnits(u).length) return "";
        return `<div class="pcard vacant"><div class="pc-top"><div class="pc-who"><div class="pc-title">${esc(u.code)} <span class="muted">${esc(u.unit_type || "")}</span></div><div class="muted">no tenant</div></div>${statusPill(u)}</div></div>`;
      }).join("");
      return cards ? `<div class="m-section">${icon("building", 16)} ${esc(buildingShort(b))}</div>${cards}` : "";
    }).join("") || `<div class="card"><div class="empty">${st.open ? "Nothing open – all units are paid up." : "No units."}</div></div>`;
  }
  $("#view").innerHTML = `${kpis}<div class="pcards">${body}</div>
    <div class="legend"><span class="pc ok">paid</span><span class="pc partial">partly paid</span><span class="pc overdue">overdue</span><span class="pc pending">due soon</span>
      <span class="muted">Tap a month to record or correct its payments.</span></div>`;
  bindPayCards();
}

// ---------------------------------------------------------------- Data Setup → Tenants → Tenant Details
function renderTenantDetail(id) {
  const t = byId("tenants", id);
  if (!t) { location.hash = "#/admin/tenants"; return; }
  const st = (pageState.tenantDetail ||= { tab: "info" });
  $("#title").textContent = tenantName(t);
  $("#topActions").innerHTML = `<button class="btn" id="editTenant">${icon("user", 18)} Edit tenant</button>`;
  $("#editTenant").onclick = () => openForm("tenants", t);

  const now = today();
  const leases = db.leases.filter((l) => l.tenant_id === t.id).sort((a, b) => (leaseActiveOn(b, now) - leaseActiveOn(a, now)) || b.start_date.localeCompare(a.start_date));
  const active = leases.filter((l) => leaseActiveOn(l, now));
  const focus = active.length ? active : leases.slice(0, 1); // ended tenant: show the last lease's unit
  const unitIds = new Set(focus.map((l) => l.unit_id));
  db.units.forEach((u) => { if (ownerUnits(u).some((o) => unitIds.has(o.id))) unitIds.add(u.id); }); // cellar, parking … of the flat
  const meters = db.meters.filter((m) => unitIds.has(m.unit_id)).sort((a, b) => cmpUnits(byId("units", a.unit_id), byId("units", b.unit_id)) || a.meter_type.localeCompare(b.meter_type));
  const docs = db.documents.filter((d) => d.status !== "Template" && (d.tenant_id === t.id || leases.some((l) => l.id === d.lease_id)))
    .sort((a, b) => (b.doc_date || "").localeCompare(a.doc_date || ""));
  const files = attachmentsOf("tenants", t.id);
  const monthly = sum(active, leaseTotal), arrears = round2(sum(leases, leaseArrears));

  const tabs = [["info", "Name & rent"], ["meters", `Meters (${meters.length})`], ["docs", `Documents (${docs.length + files.length})`]];
  const tabBar = `<div class="seg tabs">${tabs.map(([k, label]) => `<button type="button" class="seg-btn ${st.tab === k ? "active" : ""}" data-tab="${k}">${label}</button>`).join("")}</div>`;
  const row = (label, value) => (value ? `<div class="kv"><span>${label}</span><span>${value}</span></div>` : "");
  const address = [t.street, [t.zip, t.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  let content = "";
  if (st.tab === "info") {
    content = `
      <div class="kpis compact">
        <div class="kpi kpi-green"><div class="kpi-label">Rent per month</div><div class="kpi-value">${fmtMoney(monthly)}</div><div class="kpi-sub">${active.length ? `${active.length} active lease(s)` : "no active lease"}</div></div>
        <div class="kpi"><div class="kpi-label">Arrears</div><div class="kpi-value ${arrears > 0 ? "neg" : ""}">${fmtMoney(arrears)}</div><div class="kpi-sub">${arrears > 0 ? "rent / prepayments missing" : "nothing outstanding"}</div></div>
      </div>
      <div class="card"><div class="card-head"><h3>${icon("user", 18)} Contact</h3></div><div class="card-body kvs">
        ${row("Name", `<strong>${esc(tenantName(t))}</strong>`)}
        ${row("Co-tenant", esc(t.co_tenant || ""))}
        ${row("Phone", t.phone ? `<a class="link" href="tel:${esc(t.phone.replace(/[^\d+]/g, ""))}">${esc(t.phone)}</a>` : "")}
        ${row("Email", t.email ? `<a class="link" href="mailto:${esc(t.email)}">${esc(t.email)}</a>` : "")}
        ${row("Address", esc(address))}
        ${row("IBAN", esc(t.iban || ""))}
        ${row("Notes", esc(t.notes || ""))}
      </div></div>
      <div class="card"><div class="card-head"><h3>${icon("file", 18)} Assigned leases</h3><button class="btn small" id="addLease">${icon("plus", 16)} Lease</button></div>
        <div class="card-body">${leases.length ? `<div class="pcards">${leases.map((l) => leaseActiveOn(l, now) || leaseArrears(l) > 0
          ? leasePayCard(l, esc(unitLabel(byId("units", l.unit_id))), `since ${fmtDate(l.start_date)}${l.end_date ? " · until " + fmtDate(l.end_date) : ""} · base rent ${fmtMoney(l.cold_rent)}`, { noTenant: true })
          : `<button type="button" class="mcard" data-lease-open="${l.id}"><div class="mc-main"><div class="mc-title">${esc(unitLabel(byId("units", l.unit_id)))}</div>
              <div class="mc-metas"><span class="mc-meta">${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}</span><span class="mc-meta">${fmtMoney(leaseTotal(l))} / month</span>${leaseStatus(l)}</div></div>${icon("chevronRight", 18)}</button>`).join("")}</div>`
          : '<div class="empty">No lease assigned yet.</div>'}</div></div>`;
  } else if (st.tab === "meters") {
    content = `<div class="card"><div class="card-head"><h3>${icon("gauge", 18)} Assigned meters</h3><span class="muted">${focus.length ? esc([...unitIds].map((u) => byId("units", u)?.code).filter(Boolean).join(", ")) : ""}</span></div>
      <div class="card-body">${meters.length ? `<div class="mlist">${meters.map((m) => { const r = lastReading(m), u = byId("units", m.unit_id);
        return `<button type="button" class="mcard" data-meter="${m.id}" style="--uc:${unitColor(u?.building_id, m.unit_id)}"><div class="mc-main">
          <div class="mc-title">${meterIcon(m.meter_type)}${esc(m.meter_type)} ${m.number ? `<strong>${esc(m.number)}</strong>` : '<span class="pill free">no number</span>'}</div>
          <div class="mc-metas"><span class="mc-meta"><em>Unit</em> ${esc(u?.code || "")}</span>${m.location ? `<span class="mc-meta"><em>Location</em> ${esc(m.location)}</span>` : ""}
          <span class="mc-meta"><em>Last reading</em> ${r ? `${fmtNum(r.value)} ${esc(m.measure_unit || "")} · ${fmtDate(r.reading_date)}` : "–"}</span>${m.active ? "" : '<span class="pill grey">inactive</span>'}</div></div>${icon("chevronRight", 18)}</button>`; }).join("")}</div>`
        : `<div class="empty">No meters assigned to ${focus.length ? "this tenant's unit" : "this tenant"}.</div>`}</div></div>`;
  } else {
    const l0 = focus[0], u0 = l0 && byId("units", l0.unit_id);
    content = `<div class="card"><div class="card-head"><h3>${icon("folder", 18)} Documents</h3><button class="btn small" id="addDoc">${icon("plus", 16)} Document</button></div>
      <div class="card-body">${docs.length ? `<div class="mlist">${docs.map((d) => { const n = attachmentsOf("documents", d.id).length;
        return `<button type="button" class="mcard" data-doc="${d.id}"><div class="mc-main"><div class="mc-title">${esc(docShort(d.doc_type))}${d.title ? ` <span class="muted">${esc(d.title)}</span>` : ""}</div>
          <div class="mc-metas">${d.doc_date ? `<span class="mc-meta">${fmtDate(d.doc_date)}</span>` : ""}${d.phase ? `<span class="mc-meta">${esc(d.phase)}</span>` : ""}${docStatusPill(d.status)}<span class="mc-meta">${icon("paperclip", 14)} ${n || "no file"}</span></div></div>${icon("chevronRight", 18)}</button>`; }).join("")}</div>`
        : '<div class="empty">No documents for this tenant yet.</div>'}
      ${l0 ? generateBar(l0) : ""}</div></div>
      <div class="card"><div class="card-head"><h3>${icon("paperclip", 18)} Files on the tenant</h3><span class="muted">ID copies, self-disclosure …</span></div>
        <div class="card-body">${attachmentsBlock("tenants", t)}</div></div>`;
    setTimeout(() => {
      const ad = $("#addDoc");
      if (ad) ad.onclick = () => openForm("documents", null, { building_id: u0?.building_id, unit_id: l0?.unit_id, lease_id: l0?.id, tenant_id: t.id, status: "Draft" });
    });
  }

  $("#view").innerHTML = `<div class="tenant-detail">${tabBar}${content}</div>`;
  $("#view").querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; renderTenantDetail(id); }));
  bindPayCards();
  $("#view").querySelectorAll("[data-lease-open]").forEach((b) => (b.onclick = () => openForm("leases", byId("leases", b.dataset.leaseOpen))));
  $("#view").querySelectorAll("[data-meter]").forEach((b) => (b.onclick = () => openForm("meters", byId("meters", b.dataset.meter))));
  $("#view").querySelectorAll("[data-doc]").forEach((b) => (b.onclick = () => openForm("documents", byId("documents", b.dataset.doc))));
  const al = $("#addLease"); if (al) al.onclick = () => openForm("leases", null, { tenant_id: t.id });
  if (st.tab === "docs") { bindAttachments($("#view"), () => render()); bindGenButtons($("#view")); hydrateAttachments($("#view")); }
}

function openPayment(l, ym, cat) {
  const existing = paymentRow(l, ym, cat);
  if (existing) return openForm("payments", existing);
  let amount = expected(l, ym, cat);
  if (cat === "settlement" || cat === "deposit") amount = Math.max(0, cumulativeOutstanding(l, cat, ym)) || amount;
  openForm("payments", null, { lease_id: l.id, month: ym, category: cat, amount: amount || "", paid_on: today() });
}

/** Record all payments of one month for a lease in one step. */
function openRecordMonth(lease, ym = thisMonth()) {
  drawerStack.length = 0;
  $("#drawer").classList.remove("wide");
  const leaseId = lease?.id || "";
  $("#drawerTitle").textContent = "Record payment";
  const draw = (lid, month) => {
    const l = lid ? byId("leases", lid) : null;
    const rows = l ? Object.keys(CATEGORIES).map((c) => {
      let due = round2(expected(l, month, c) - paid(l, month, c));
      if (c === "settlement" || c === "deposit") due = Math.max(0, cumulativeOutstanding(l, c, [month, lastDueMonth(l)].sort().pop()));
      return { c, due: Math.max(0, round2(due)), already: paid(l, month, c), exp: expected(l, month, c) };
    }) : [];
    $("#drawerBody").innerHTML = `
      <div class="form-error" id="formError"></div>
      <div class="form-grid">
        <div class="field full"><label>Lease</label><select class="input" id="rm_lease"><option value="">– please select –</option>
          ${leaseOptions().map((o) => `<option value="${o.value}" ${String(o.value) === String(lid) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>
        <div class="field"><label>Month</label><input class="input" type="month" id="rm_month" value="${month}"></div>
        <div class="field"><label>Received on</label><input class="input" type="date" id="rm_date" value="${today()}"></div>
      </div>
      ${l ? `${settlementInstallmentHint(l, month)}
      <div class="section-title"><span>Amounts received</span></div>
      <div class="related"><table><thead><tr><th></th><th>Category</th><th class="num">Due</th><th class="num">Already recorded</th><th style="width:130px">Received now (€)</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><input type="checkbox" class="rm_chk" data-c="${r.c}" ${r.due > 0 ? "checked" : ""}></td><td>${CATEGORIES[r.c]}</td>
          <td class="num">${r.due ? fmtMoney(r.due) : '<span class="muted">–</span>'}</td><td class="num">${r.already ? fmtMoney(r.already) : '<span class="muted">–</span>'}</td>
          <td><input class="input rm_amt" data-c="${r.c}" inputmode="decimal" value="${r.due || ""}"></td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted" style="font-size:12px">Amounts are added to what is already recorded for this month. Settlement and deposit payments are allocated to the oldest open installment.</p>` : ""}`;
    $("#rm_lease").onchange = (e) => draw(e.target.value, $("#rm_month").value || month);
    $("#rm_month").onchange = (e) => draw(lid, e.target.value || month);
    $("#drawerBody").querySelectorAll(".rm_amt").forEach((inp) => (inp.oninput = () => { $(`.rm_chk[data-c="${inp.dataset.c}"]`).checked = !!inp.value; }));
  };
  draw(leaseId, ym);
  $("#drawerFoot").innerHTML = `<div class="right"><button class="btn" id="cancelBtn">Cancel</button><button class="btn primary" id="saveBtn">${icon("check", 18)} Save payments</button></div>`;
  $("#cancelBtn").onclick = closeDrawer;
  $("#saveBtn").onclick = async () => {
    const l = byId("leases", $("#rm_lease").value);
    const month = $("#rm_month").value;
    if (!l || !month) return showFormError("Please select a lease and a month.");
    try {
      let n = 0;
      for (const chk of $("#drawerBody").querySelectorAll(".rm_chk:checked")) {
        const c = chk.dataset.c;
        const amt = Number(String($(`.rm_amt[data-c="${c}"]`).value).replace(",", "."));
        if (!amt) continue;
        const ex = paymentRow(l, month, c);
        if (ex) await api("PUT", `payments/${ex.id}`, { amount: round2(Number(ex.amount) + amt), paid_on: $("#rm_date").value });
        else await api("POST", "payments", { lease_id: l.id, month, category: c, amount: amt, paid_on: $("#rm_date").value });
        n++;
      }
      await loadAll(); closeDrawer(); render();
      toast(n ? `${n} payment${n > 1 ? "s" : ""} recorded` : "Nothing recorded");
    } catch (err) { showFormError(err.message); }
  };
  showDrawer();
}
function settlementInstallmentHint(l, month) {
  const inst = leaseSettlements(l).flatMap(settlementSchedule).filter((x) => x.ym === month && x.n > 1);
  if (!inst.length) return "";
  return `<div class="callout warn">${inst.map((x) => `Installment ${x.k} of ${x.n} of the utility settlement ${x.settlement.period_year} (<strong>${fmtMoney(x.amount)}</strong>) is due with this month's rent.`).join("<br>")}</div>`;
}

// ---------------------------------------------------------------- Rent Control: deposits
function renderChecklists() {
  const st = (pageState.checklists ||= { all: false });
  $("#topActions").innerHTML = `<label class="check" style="display:flex"><input type="checkbox" id="cl_all" ${st.all ? "checked" : ""}> Show all leases</label>`;
  $("#cl_all").onchange = (e) => { st.all = e.target.checked; renderChecklists(); };
  const leases = (st.all ? [...db.leases] : movingLeases()).sort(cmpLeasesByUnit);
  const bar = (p) => `<div class="cl-bar" title="${p.done} of ${p.total} done"><span style="width:${Math.round((100 * p.done) / p.total)}%"></span></div><span class="muted">${p.done}/${p.total}</span>`;
  const nextOpen = (l, ph) => CHECKLIST[ph].flatMap((s) => s.items).find((it) => !checkState(l, ph, it).done);
  $("#view").innerHTML = `
    <p class="muted" style="margin:0 0 12px">Moves going on now: leases starting within 60 days or up to 90 days ago, and leases ending within 60 days or up to 180 days ago. Open a lease to tick off the items or add documents.</p>
    ${leases.length ? `<div class="cgrid">${leases.map((l) => { const ph = currentPhase(l); const nx = nextOpen(l, ph); const u = byId("units", l.unit_id);
        return ucard({ title: `${esc(unitLabel(u, false))}`, sub: `${icon("user", 14)} ${esc(tenantName(byId("tenants", l.tenant_id)))}`,
          body: `<div class="cl-rows"><div class="cl-row"><span>Move-in <span class="muted">${fmtDate(l.start_date)}</span></span>${bar(checklistProgress(l, "in"))}</div>
            ${leaseHasMoveOut(l) ? `<div class="cl-row"><span>Move-out <span class="muted">${fmtDate(l.end_date)}</span></span>${bar(checklistProgress(l, "out"))}</div>` : ""}</div>
            <div class="cl-next">${nx ? `${icon("arrowRight", 14)} Next: <strong>${esc(nx.label)}</strong>` : '<span class="pill ok">all done</span>'}</div>`,
          side: `<span class="pill ${ph === "out" ? "free" : "ok"}">${ph === "out" ? "moving out" : "moving in"}</span>`,
          color: unitColor(u?.building_id, l.unit_id), attrs: `data-lease="${l.id}"` }); }).join("")}</div>`
      : `<div class="card"><div class="empty">No move-in or move-out going on right now.<br><br><button class="btn" id="cl_show">Show all leases</button></div></div>`}`;
  bindCards("[data-lease]", (c) => openForm("leases", byId("leases", c.dataset.lease)));
  const b = $("#cl_show"); if (b) b.onclick = () => { st.all = true; renderChecklists(); };
}

function renderDeposits() {
  const st = (pageState.dep ||= { building: "" });
  $("#topActions").innerHTML = `<div class="filters">${buildingFilterHtml(st)}</div>`;
  bindBuildingFilter(st, renderDeposits);
  const leases = db.leases.filter((l) => { const u = byId("units", l.unit_id); return u && (!st.building || u.building_id === Number(st.building)) && (!l.end_date || l.end_date >= today() || paidTotal(l, "deposit")); });
  const rows = leases.sort(cmpLeasesByUnit).map((l) => {
    const sched = depositSchedule(l);
    const got = paidTotal(l, "deposit");
    const out = cumulativeOutstanding(l, "deposit");
    let status;
    if (!Number(l.deposit)) status = '<span class="pill grey">no deposit</span>';
    else if (!sched.length) status = '<span class="pill grey">before tracking</span>';
    else if (got >= Number(l.deposit) - 0.009) status = '<span class="pill ok">fully paid</span>';
    else if (out > 0.009) status = `<span class="pill danger">${fmtMoney(out)} overdue</span>`;
    else status = '<span class="pill free">installments running</span>';
    return { l, sched, got, status };
  });
  const totalHeld = sum(rows, (r) => r.got);
  $("#view").innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Deposits agreed (current leases)</div><div class="kpi-value">${fmtMoney(sum(rows, (r) => r.l.deposit))}</div></div>
      <div class="kpi"><div class="kpi-label">Deposits received (recorded)</div><div class="kpi-value">${fmtMoney(totalHeld)}</div><div class="kpi-sub">payments recorded since ${fmtMonth(trackingStart())}</div></div>
    </div>
    <div class="cgrid">${rows.map((r) => { const u = byId("units", r.l.unit_id);
      return ucard({ title: esc(unitLabel(u)), sub: `${icon("user", 14)} ${esc(tenantName(byId("tenants", r.l.tenant_id)))} · since ${fmtDate(r.l.start_date)}`,
        metas: [metaKV("Received", fmtMoney(r.got)), r.sched.length ? metaKV(r.sched.length > 1 ? "Installments" : "Due", r.sched.map((x) => fmtMonth(x.ym)).join(", ")) : ""],
        side: `<strong>${fmtMoney(r.l.deposit)}</strong>${r.status}`,
        actions: Number(r.l.deposit) ? `<button type="button" class="btn small" data-rec="${r.l.id}">${icon("banknote", 16)} Record</button>` : "",
        color: unitColor(u?.building_id, r.l.unit_id), attrs: `data-lease="${r.l.id}"` }); }).join("") || '<div class="card"><div class="empty">No leases.</div></div>'}</div>
    <p class="muted">The deposit amount and the number of installments are set on the lease (Data Setup → Leases). Leases that started before ${fmtMonth(trackingStart())} are not checked.</p>`;
  bindCards("[data-lease]", (c) => openForm("leases", byId("leases", c.dataset.lease)));
  $("#view").querySelectorAll("[data-rec]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openRecordMonth(byId("leases", b.dataset.rec)); }));
}

// ---------------------------------------------------------------- sticky header offset
function updateStickyOffset() {
  const h = $(".topbar")?.offsetHeight || 0;
  document.documentElement.style.setProperty("--topbar-h", h + "px");
}
window.addEventListener("resize", updateStickyOffset);

// ---------------------------------------------------------------- month detail: who paid how much
function openMonthDetail(ym, buildingFilter) {
  drawerStack.length = 0;
  const leases = db.leases.filter((l) => {
    const u = byId("units", l.unit_id);
    return u && (!buildingFilter || u.building_id === Number(buildingFilter))
      && (leaseActiveInMonth(l, ym) || db.payments.some((p) => p.lease_id === l.id && p.month === ym));
  });
  const groups = db.buildings.filter((b) => !buildingFilter || b.id === Number(buildingFilter))
    .map((b) => ({ b, ls: leases.filter((l) => byId("units", l.unit_id).building_id === b.id).sort(cmpLeasesByUnit) }))
    .filter((g) => g.ls.length);
  const rowData = (l) => {
    const exp = expected(l, ym, "rent") + expected(l, ym, "service");
    const p = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, paid(l, ym, c)]));
    const total = sum(Object.values(p), (x) => x);
    const rentPaid = p.rent + p.service;
    const dates = db.payments.filter((x) => x.lease_id === l.id && x.month === ym && x.paid_on).map((x) => x.paid_on).sort();
    let status;
    if (!exp && total) status = '<span class="pill grey">extra</span>';
    else if (rentPaid >= exp - 0.009) status = '<span class="pill ok">paid</span>';
    else if (!isDue(l, ym)) status = rentPaid ? '<span class="pill free">partly</span>' : '<span class="pill grey">not yet due</span>';
    else status = rentPaid ? `<span class="pill free">${fmtMoney(exp - rentPaid)} missing</span>` : `<span class="pill danger">not paid</span>`;
    return { exp, p, total, status, date: dates[dates.length - 1] };
  };
  const all = leases.map(rowData);
  const cell = (v) => (v ? fmtMoney(v) : '<span class="muted">–</span>');
  $("#drawer").classList.add("wide");
  $("#drawerTitle").textContent = `Payments ${fmtMonth(ym)}`;
  $("#drawerBody").innerHTML = `
    <div class="kpis compact">
      <div class="kpi"><div class="kpi-label">Expected rent + prepayments</div><div class="kpi-value">${fmtMoney(sum(all, (r) => r.exp))}</div></div>
      <div class="kpi"><div class="kpi-label">Received (all categories)</div><div class="kpi-value">${fmtMoney(sum(all, (r) => r.total))}</div></div>
    </div>
    ${groups.length ? groups.map((g) => `
      <div class="section-title"><span>${icon("building", 16)} ${esc(buildingShort(g.b))}</span></div>
      <div class="related"><table>
        <thead><tr><th>Unit · tenant</th><th class="num">Expected</th><th class="num">Rent</th><th class="num">Service</th><th class="num">Settlement</th><th class="num">Deposit</th><th class="num">Total paid</th><th>Status</th></tr></thead>
        <tbody>${g.ls.map((l) => { const r = rowData(l);
          return `<tr class="clickable" data-rec="${l.id}" title="Click to record or correct payments of ${fmtMonth(ym)}"><td><strong>${esc(byId("units", l.unit_id).code)}</strong><div class="muted">${esc(tenantName(byId("tenants", l.tenant_id)))}${r.date ? ` · paid ${fmtDate(r.date)}` : ""}</div></td>
            <td class="num">${cell(r.exp)}</td><td class="num">${cell(r.p.rent)}</td><td class="num">${cell(r.p.service)}</td><td class="num">${cell(r.p.settlement)}</td><td class="num">${cell(r.p.deposit)}</td>
            <td class="num"><strong>${cell(r.total)}</strong></td><td>${r.status}</td></tr>`; }).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${fmtMoney(sum(g.ls, (l) => rowData(l).exp))}</td>${["rent", "service", "settlement", "deposit"].map((c) => `<td class="num">${fmtMoney(sum(g.ls, (l) => paid(l, ym, c)))}</td>`).join("")}<td class="num">${fmtMoney(sum(g.ls, (l) => rowData(l).total))}</td><td></td></tr></tfoot>
      </table></div>`).join("") : '<div class="empty">No leases in this month.</div>'}
    <p class="muted" style="font-size:12px">Click a row to record or correct the payments of this month.</p>`;
  $("#drawerFoot").innerHTML = `<div class="right"><a class="btn" href="#/rent/payments" id="toPayments">${icon("wallet", 18)} Open payments grid</a><button class="btn primary" id="cancelBtn">Close</button></div>`;
  $("#cancelBtn").onclick = closeDrawer;
  $("#drawerBody").querySelectorAll("tr[data-rec]").forEach((tr) => (tr.onclick = () => openRecordMonth(byId("leases", tr.dataset.rec), ym)));
  showDrawer();
}

// ---------------------------------------------------------------- Data Admin: settings (program and data location)
const rcLastReadHtml = () => `<span>Last read: <strong>${esc(db.settings?.rent_control_read || "never")}</strong></span>`;

async function renderSettings() {
  if (Backend.mode === "cloud") return renderCloudSettings();
  return renderServerSettings();
}
async function renderServerSettings() {
  $("#view").innerHTML = '<div class="card"><div class="empty">Loading …</div></div>';
  let info;
  try { info = await api("GET", "system"); } catch (e) {
    const outdated = /unknown table/i.test(e.message);
    $("#view").innerHTML = `<div class="card"><div class="empty">${outdated
      ? `${icon("alert", 28)}<br><strong>The program running in the background is an older version.</strong><br>Please close the black “Property Administration” window and start <code>start.bat</code> again – then the folder settings are available.`
      : esc(e.message)}</div></div>`;
    return;
  }
  const sizeMb = (info.db_size / 1048576).toFixed(2);
  const ro = !info.local;
  const found = (ok, name) => `<span class="pill ${ok ? "ok" : "danger"}">${ok ? icon("check", 14) : icon("x", 14)} ${esc(name)}</span>`;
  $("#view").innerHTML = `
    ${info.warning ? `<div class="callout warn">${esc(info.warning)}</div>` : ""}
    ${ro ? '<div class="callout warn">Folder settings can only be changed on the PC that runs the program.</div>' : ""}
    <div class="card settings">
      <div class="card-head"><h3>${icon("folder", 18)} Program location</h3>${ro ? "" : `<button class="btn small" data-open="program">${icon("folder", 16)} Open in Explorer</button>`}</div>
      <div class="card-body">
        <div class="path">${esc(info.program_dir)}</div>
        <p class="muted">You can move or copy the complete <strong>PropertyAdministration</strong> folder to another place (e.g. another OneDrive folder or a USB stick).
        All links keep working because the data folder and the files are stored <em>relative</em> to the program. Start the program from the new place with <code>start.bat</code>.</p>
      </div>
    </div>
    <div class="card settings">
      <div class="card-head"><h3>${icon("database", 18)} Data folder <span class="muted">(database, photos & files)</span></h3>${ro ? "" : `<button class="btn small" data-open="data">${icon("folder", 16)} Open in Explorer</button>`}</div>
      <div class="card-body">
        <div class="path">${esc(info.data_dir)} ${info.data_dir_default ? '<span class="pill grey">default · inside the program folder</span>' : `<span class="pill ok">custom · stored as “${esc(info.data_dir_stored_as)}”</span>`}</div>
        <div class="facts"><span>Database: <strong>${sizeMb} MB</strong></span><span>Files & photos: <strong>${info.attachments}</strong></span>
          <span>Broken file links: <strong class="${info.missing_files ? "neg" : ""}">${info.missing_files}</strong></span>
          ${ro ? "" : `<button class="btn small" id="repairBtn">${icon("link", 16)} Check & repair links</button>`}</div>
        ${ro ? "" : `<div class="folder-pick">
          <label>Choose a different data folder</label>
          <div class="pick-row"><input class="input" id="dataPath" placeholder="e.g. C:\\Users\\…\\OneDrive\\Property data"><button class="btn" data-browse="dataPath">${icon("folder", 18)} Browse…</button></div>
          <div class="pick-row"><button class="btn primary" id="moveData">${icon("arrowRight", 18)} Move data here</button><button class="btn" id="useData">${icon("check", 18)} Use the data in this folder</button></div>
          <p class="muted"><strong>Move data here</strong> copies the database and all files into the chosen (empty) folder and continues working there – the old folder stays as a backup.
          <strong>Use the data in this folder</strong> switches to a folder that already contains a Property Administration database.</p>
        </div>`}
      </div>
    </div>
    <div class="card settings">
      <div class="card-head"><h3>${icon("file", 18)} Import source folder <span class="muted">(Excel file with paid / outstanding rents – read only)</span></h3>${ro ? "" : `<button class="btn small" data-open="source">${icon("folder", 16)} Open in Explorer</button>`}</div>
      <div class="card-body">
        <div class="path">${esc(info.source_dir)}</div>
        <div class="facts">${Object.entries(info.source_files || {}).map(([name, ok]) => found(ok, name)).join("")}${rcLastReadHtml()}</div>
        <div class="pick-row"><button class="btn" id="rcCheck">${icon("refresh", 18)} Compare with Rent Control.xlsx now</button></div>
        <p class="muted">The file is read automatically when the program opens – but only if it was changed since the last time. Differences are shown for confirmation; the Excel file is never changed.</p>
        ${ro ? "" : `<div class="folder-pick"><div class="pick-row"><input class="input" id="srcPath" placeholder="Folder that contains Rent Control.xlsx"><button class="btn" data-browse="srcPath">${icon("folder", 18)} Browse…</button><button class="btn primary" id="saveSrc">${icon("check", 18)} Save</button></div></div>`}
      </div>
    </div>`;
  $("#rcCheck").onclick = () => rentControlCheck({ force: true });
  if (ro) return;
  const post = (action, body) => api("POST", "system/" + action, body || {});
  $("#view").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => post("open", { which: b.dataset.open })));
  $("#view").querySelectorAll("[data-browse]").forEach((b) => (b.onclick = async () => {
    const inp = $("#" + b.dataset.browse);
    toast("The folder dialog opens on your PC …");
    try { const r = await post("browse", { start: inp.value || info.data_dir }); if (r.path) inp.value = r.path.replace(/\//g, "\\"); } catch (e) { toast(e.message, true); }
  }));
  $("#repairBtn").onclick = async () => {
    try { const r = await post("repair"); await loadAll(); toast(r.fixed ? `${r.fixed} link(s) repaired` + (r.missing ? `, ${r.missing} file(s) still missing` : "") : r.missing ? `${r.missing} file(s) are missing` : "All file links are OK"); renderSettings(); }
    catch (e) { toast(e.message, true); }
  };
  const switchData = async (mode) => {
    const path = $("#dataPath").value.trim();
    if (!path) return toast("Please choose a folder first.", true);
    if (mode === "move" && !await askConfirm(`Copy the database and all files to\n${path}\nand continue working there?\n\nThe current folder stays unchanged as a backup.`)) return;
    try { const r = await post("data_dir", { path, mode }); await loadAll(); toast(mode === "move" ? "Data moved – the app now uses the new folder" : "Switched to the selected data folder"); render(); if (r.previous_data_dir) console.info("previous data folder:", r.previous_data_dir); }
    catch (e) { toast(e.message, true); }
  };
  $("#moveData").onclick = () => switchData("move");
  $("#useData").onclick = () => switchData("use");
  $("#saveSrc").onclick = async () => {
    try { await post("source_dir", { path: $("#srcPath").value.trim() }); toast("Import source folder saved"); renderSettings(); } catch (e) { toast(e.message, true); }
  };
}

// ---------------------------------------------------------------- start
// files dropped outside a drop zone would make the browser leave the app and open the picture – prevent that
window.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "none"; } });
window.addEventListener("drop", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); toast("Drop the photo onto “Files & photos”, a reading or the new-reading box", true); } });
$("#drawerClose").onclick = closeDrawer;
$("#backdrop").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#drawer").classList.contains("open")) closeDrawer(); });
window.addEventListener("hashchange", () => { closeDrawer(); render(); });

$("#drawerClose").innerHTML = icon("x", 20);
$(".brand-icon").outerHTML = `<span class="brand-icon">${icon("home", 22)}</span>`;

async function showPhoneAccess() {
  if (Backend.mode !== "server") return;
  try {
    const info = await api("GET", "info");
    if (info.lan && info.urls.length) $(".sidebar-foot").innerHTML = `${icon("smartphone", 16)} Phone access (same Wi-Fi):<br><a href="${esc(info.urls[0])}" target="_blank">${esc(info.urls[0].replace(/\?key=.*/, ""))}</a><br>PIN <strong>${esc(info.pin)}</strong>`;
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- OneDrive version: gate screens, sync status, settings
function showGate(html) {
  let g = $("#gate");
  if (!g) { g = document.createElement("div"); g.id = "gate"; document.body.appendChild(g); }
  g.innerHTML = `<div class="gate-card"><div class="gate-brand"><span class="brand-icon">${icon("home", 22)}</span><div><div class="gate-title">Property Administration</div><div class="muted">Your properties – on PC and iPhone</div></div></div>${html}</div>`;
  return g;
}
function hideGate() { $("#gate")?.remove(); }

function syncStatusHtml(st) {
  const time = st.savedAt ? new Date(st.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  const map = {
    saved: ["ok", "cloud", `Saved to OneDrive${time ? " · " + time : ""}`],
    dirty: ["busy", "cloud", "Unsaved changes …"],
    saving: ["busy", "refresh", "Saving to OneDrive …"],
    error: ["bad", "alert", "Not saved – tap to retry"],
    conflict: ["bad", "alert", "Changed elsewhere – tap to resolve"],
    idle: ["busy", "cloud", "Connecting …"],
  };
  const [cls, ic, text] = map[st.state] || map.idle;
  return `<a class="sync ${cls}" href="#/admin/settings" title="${esc(st.error || "")}">${icon(ic, 16)} <span>${esc(text)}</span></a>
    <div class="sync-acc">${esc(Backend.store.account?.username || "")}</div>`;
}

async function renderCloudSettings() {
  const store = Backend.store;
  const st = Backend.status;
  const att = db.attachments.length;
  $("#view").innerHTML = `
    ${st.state === "conflict" ? `<div class="callout warn"><strong>The database in OneDrive was changed elsewhere</strong> (e.g. on the PC or another device) after you opened it.
      <div class="pick-row"><button class="btn primary" id="cfReload">${icon("refresh", 18)} Load the latest version (discard my last changes)</button><button class="btn danger" id="cfForce">${icon("cloud", 18)} Overwrite OneDrive with my version</button></div></div>` : ""}
    ${st.state === "error" ? `<div class="callout warn"><strong>Saving failed:</strong> ${esc(st.error || "")} <button class="btn small" id="retrySave">${icon("refresh", 16)} Retry</button></div>` : ""}
    <div class="card settings">
      <div class="card-head"><h3>${icon("user", 18)} Microsoft account</h3>${store.kind === "onedrive" ? `<button class="btn small" id="signOut">${icon("logout", 16)} Sign out</button>` : ""}</div>
      <div class="card-body"><div class="path">${esc(store.account?.name || "")} ${esc(store.account?.username || "")}</div>
        <p class="muted">This browser version works directly with your OneDrive. It needs no PC – you can use it on the iPhone, iPad or any computer.</p></div>
    </div>
    <div class="card settings">
      <div class="card-head"><h3>${icon("cloud", 18)} Data folder in OneDrive</h3></div>
      <div class="card-body">
        <div class="path">OneDrive / ${esc(store.folder || "")}</div>
        <div class="facts"><span>Status: <strong>${esc(syncStatusHtml(st).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())}</strong></span><span>Files & photos: <strong>${att}</strong></span></div>
        <div class="pick-row">
          ${store.kind === "onedrive" ? `<button class="btn" id="chooseFolder">${icon("folder", 18)} Choose another folder …</button>` : ""}
          <button class="btn" id="reloadDb">${icon("refresh", 18)} Reload from OneDrive</button>
          <button class="btn" id="saveNow">${icon("check", 18)} Save now</button>
          <button class="btn" id="downloadDb">${icon("download", 18)} Download a copy</button>
          <button class="btn" id="checkLinks">${icon("link", 18)} Check file links</button>
        </div>
        <p class="muted">Changes are saved automatically a moment after each entry. Once per day a backup copy of the database is written to <code>backups/</code> in the data folder.
        The PC version (<code>start.bat</code>) uses the same file – avoid editing on two devices at exactly the same time; if it happens, the app notices it and asks you what to do.</p>
      </div>
    </div>
    <div class="card settings">
      <div class="card-head"><h3>${icon("file", 18)} Rent Control.xlsx <span class="muted">(paid / outstanding rents – read only)</span></h3></div>
      <div class="card-body">
        <div class="path">OneDrive / ${esc(store.rentControlPath || "–")}</div>
        <div class="facts">${rcLastReadHtml()}</div>
        <div class="pick-row"><button class="btn" id="rcCheck">${icon("refresh", 18)} Compare now</button>
          ${store.kind === "onedrive" ? `<input class="input" id="rcPath" value="${esc(store.rentControlPath || "")}"><button class="btn" id="rcPathSave">${icon("check", 18)} Save path</button>` : ""}</div>
        <p class="muted">The file is read automatically when the program opens – but only if it was changed since the last time. Differences are shown for confirmation; the Excel file is never changed.</p>
      </div>
    </div>`;
  const on = (id, fn) => { const el = $("#" + id); if (el) el.onclick = fn; };
  on("rcCheck", () => rentControlCheck({ force: true }));
  on("rcPathSave", () => { store.setRentControlPath($("#rcPath").value.trim()); toast("Path saved"); rentControlCheck({ force: true }); });
  on("signOut", async () => { if (!Backend.dirty || await askConfirm("There are unsaved changes. Sign out anyway?")) store.signOut(); });
  on("reloadDb", async () => {
    if (Backend.dirty && !await askConfirm("Discard unsaved changes and reload the data from OneDrive?")) return;
    try { await Backend.reload(); await loadAll(); toast("Latest data loaded"); render(); } catch (e) { toast(e.message, true); }
  });
  on("cfReload", async () => { try { await Backend.reload(); await loadAll(); toast("Latest data loaded"); render(); } catch (e) { toast(e.message, true); } });
  on("cfForce", async () => { if (!await askConfirm("Overwrite the version in OneDrive with the data on this device?")) return; await Backend.save(true); render(); });
  on("retrySave", async () => { await Backend.save(true); render(); });
  on("saveNow", async () => { await Backend.save(true); toast(Backend.status.state === "saved" ? "Saved to OneDrive" : Backend.status.error || "Not saved", Backend.status.state !== "saved"); render(); });
  on("downloadDb", () => {
    const blob = new Blob([Backend.exportBytes()], { type: "application/x-sqlite3" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `property_${today()}.db`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  on("checkLinks", async () => {
    toast("Checking files …");
    let missing = 0;
    for (const a of db.attachments) if (!(await store.fileExists("files/" + a.stored_path))) missing++;
    toast(missing ? `${missing} of ${db.attachments.length} files were not found in OneDrive` : "All file links are OK", !!missing);
  });
  on("chooseFolder", () => openFolderBrowser(store.folder));
}

/** OneDrive folder browser: pick the folder that contains property.db */
async function openFolderBrowser(path, { onPick } = {}) {
  const store = Backend?.store || window.__paStore;
  drawerStack.length = 0;
  $("#drawer").classList.remove("wide");
  $("#drawerTitle").textContent = "Choose data folder in OneDrive";
  $("#drawerBody").innerHTML = '<div class="empty">Loading …</div>';
  $("#drawerFoot").innerHTML = "";
  showDrawer();
  let list;
  try { list = await store.listFolders(path); } catch (e) { $("#drawerBody").innerHTML = `<div class="callout warn">${esc(e.message)}</div>`; return; }
  const parts = path ? path.split("/") : [];
  $("#drawerBody").innerHTML = `
    <div class="crumbs"><a data-go="">OneDrive</a>${parts.map((p, i) => ` ${icon("chevronRight", 14)} <a data-go="${esc(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`).join("")}</div>
    ${list.hasDb ? `<div class="callout ok">${icon("check", 16)} This folder contains a Property Administration database (property.db).</div>` : '<p class="muted">Open the folder that contains <code>property.db</code> (normally the <code>data</code> folder next to the program).</p>'}
    <div class="folder-list">${list.folders.map((f) => `<a class="folder-item" data-go="${esc((path ? path + "/" : "") + f)}">${icon("folder", 18)} <span>${esc(f)}</span>${icon("chevronRight", 16)}</a>`).join("") || '<div class="muted">No sub-folders.</div>'}</div>`;
  $("#drawerFoot").innerHTML = `<div class="right"><button class="btn" id="cancelBtn">Cancel</button><button class="btn primary" id="useFolder" ${list.hasDb ? "" : "disabled"}>${icon("check", 18)} Use this folder</button></div>`;
  $("#drawerBody").querySelectorAll("[data-go]").forEach((a) => (a.onclick = () => openFolderBrowser(a.dataset.go, { onPick })));
  $("#cancelBtn").onclick = closeDrawer;
  $("#useFolder").onclick = async () => {
    if (onPick) { closeDrawer(); return onPick(path); }
    if (Backend.dirty && !await askConfirm("There are unsaved changes in the current folder. Switch anyway?")) return;
    store.setFolder(path);
    closeDrawer();
    try { await Backend.reload(); await loadAll(); toast("Data folder changed"); render(); } catch (e) { toast(e.message, true); }
  };
}

async function detectServer() {
  if (new URLSearchParams(location.search).has("dev")) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("api/info", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    return typeof j.port === "number";
  } catch { return false; }
}

async function boot() {
  if (await detectServer()) {
    Backend = new ServerBackend();
  } else {
    const dev = new URLSearchParams(location.search).has("dev");
    let store;
    if (dev) store = new DevStore();
    else {
      if (!window.PA_CONFIG?.clientId) {
        showGate(`<p><strong>The OneDrive version is not set up yet.</strong></p><p class="muted">Enter the “Application (client) ID” of your Microsoft app registration in <code>config.js</code> – see <code>SETUP-ONEDRIVE.md</code>.</p>`);
        return;
      }
      try { store = new GraphStore(window.PA_CONFIG); } catch (e) { showGate(`<div class="callout warn">${esc(e.message)}</div>`); return; }
    }
    window.__paStore = store;
    let account = null;
    try { account = await store.initAuth(); } catch (e) { showGate(`<div class="callout warn">Sign-in failed: ${esc(e.message)}</div><button class="btn primary" id="signIn">${icon("user", 18)} Try again</button>`); $("#signIn").onclick = () => store.signIn(); return; }
    if (!account) {
      showGate(`<p>Sign in with the Microsoft account that holds your OneDrive. Your data stays in your OneDrive – nothing is stored anywhere else.</p>
        <button class="btn primary big" id="signIn">${icon("user", 20)} Sign in with Microsoft</button>`);
      $("#signIn").onclick = () => store.signIn();
      return;
    }
    Backend = new LocalBackend(store);
    showGate(`<p>${icon("cloud", 18)} Loading your data from OneDrive …</p><p class="muted">${esc(store.folder || "")}</p>`);
    try {
      await Backend.init();
    } catch (e) {
      if (e.notFound) {
        showGate(`<div class="callout warn">${esc(e.message)}</div><p>Choose the OneDrive folder that contains <code>property.db</code>.</p>
          <button class="btn primary big" id="pickFolder">${icon("folder", 20)} Choose folder</button> <button class="btn" id="signOutG">${icon("logout", 18)} Use another account</button>`);
        $("#pickFolder").onclick = () => { hideGate(); openFolderBrowser("", { onPick: (path) => { store.setFolder(path); boot(); } }); };
        $("#signOutG").onclick = () => store.signOut();
      } else {
        showGate(`<div class="callout warn">${esc(e.message)}</div><button class="btn primary" id="retry">${icon("refresh", 18)} Try again</button>`);
        $("#retry").onclick = () => boot();
      }
      return;
    }
    hideGate();
    Backend.onStatus((st) => {
      $(".sidebar-foot").innerHTML = syncStatusHtml(st);
      $("#syncMini").innerHTML = syncStatusHtml(st);
      if (st.state === "conflict" && !boot._conflictShown) { boot._conflictShown = true; toast("The data was changed elsewhere – see Settings", true); location.hash = "#/admin/settings"; }
      if (st.state === "saved") boot._conflictShown = false;
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && Backend.dirty) Backend.save(); });
    window.addEventListener("beforeunload", (e) => { if (Backend.dirty) { Backend.save(); e.preventDefault(); e.returnValue = ""; } });
  }
  showPhoneAccess();
  try { await loadAll(); }
  catch (e) { $("#view").innerHTML = `<div class="card"><div class="empty">Data could not be loaded.<br><span class="muted">${esc(e.message)}</span></div></div>`; return; }
  render();
  rentControlCheck({ auto: true }); // reads Rent Control.xlsx only if it changed since the last time
}

// header buttons (phones navigate with the bottom tab bar + the chip row of sub-pages)
$("#backBtn").innerHTML = icon("arrowLeft", 22);
$("#settingsBtn").innerHTML = icon("settings", 22);
$("#navBackdrop").onclick = () => document.body.classList.remove("nav-open");
window.addEventListener("hashchange", () => document.body.classList.remove("nav-open"));

boot();
