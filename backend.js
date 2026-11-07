/* Property Administration – data layer.
 *
 * Two interchangeable backends with the same interface:
 *   ServerBackend – the app is served by server.py on the PC (REST API /api/…)
 *   LocalBackend  – the app runs stand-alone in the browser (e.g. iPhone); the SQLite database
 *                   is loaded from OneDrive, edited in memory with sql.js and saved back.
 *
 * The rules below (tables, required fields, validation) mirror server.py – keep both in sync.
 */
"use strict";

const PA_SCHEMA = (() => {
  const TABLES = {
    buildings: [["code", "name", "street", "house_no", "zip", "city", "country", "year_built", "plot_area", "building_type", "notes"], ["code", "street", "city"], ["year_built", "plot_area"]],
    units: [["building_id", "code", "unit_type", "floor", "area", "rooms", "parent_unit_id", "notes"], ["building_id", "code", "unit_type"], ["building_id", "area", "rooms", "parent_unit_id"]],
    meters: [["building_id", "unit_id", "meter_type", "number", "measure_unit", "location", "supplier", "active", "notes"], ["building_id", "meter_type"], ["building_id", "unit_id", "active"]],
    meter_readings: [["meter_id", "reading_date", "value", "reading_type", "notes"], ["meter_id", "reading_date", "value"], ["meter_id", "value"]],
    tenants: [["salutation", "first_name", "last_name", "company", "co_tenant", "street", "zip", "city", "phone", "email", "iban", "notes"], [], []],
    leases: [["unit_id", "tenant_id", "start_date", "end_date", "cold_rent", "service_charge", "heating_charge", "other_charge", "deposit", "deposit_installments", "payment_day", "notes"],
      ["unit_id", "tenant_id", "start_date", "cold_rent"], ["unit_id", "tenant_id", "cold_rent", "service_charge", "heating_charge", "other_charge", "deposit", "deposit_installments", "payment_day"]],
    payments: [["lease_id", "month", "category", "amount", "paid_on", "notes"], ["lease_id", "month", "category", "amount"], ["lease_id", "amount"]],
    settlements: [["lease_id", "period_year", "amount", "issued_on", "first_due_month", "installments", "notes"], ["lease_id", "period_year", "amount", "first_due_month"], ["lease_id", "period_year", "amount", "installments"]],
    reminders: [["unit_id", "lease_id", "kind", "title", "amount", "due_date", "done", "notes"], ["kind", "title"], ["unit_id", "lease_id", "amount", "done"]],
  };
  const FLOAT_COLUMNS = new Set(["area", "rooms", "plot_area", "value", "amount", "cold_rent", "service_charge", "heating_charge", "other_charge", "deposit"]);
  const SQL = `
CREATE TABLE IF NOT EXISTS buildings (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT, street TEXT NOT NULL, house_no TEXT, zip TEXT,
  city TEXT NOT NULL, country TEXT DEFAULT 'Germany', year_built INTEGER, plot_area REAL, building_type TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY AUTOINCREMENT, building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  code TEXT NOT NULL, unit_type TEXT NOT NULL, floor TEXT, area REAL, rooms REAL, parent_unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL, notes TEXT, UNIQUE (building_id, code));
CREATE TABLE IF NOT EXISTS meters (id INTEGER PRIMARY KEY AUTOINCREMENT, building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES units(id) ON DELETE RESTRICT, meter_type TEXT NOT NULL, number TEXT, measure_unit TEXT, location TEXT, active INTEGER DEFAULT 1, notes TEXT, supplier TEXT);
CREATE TABLE IF NOT EXISTS meter_readings (id INTEGER PRIMARY KEY AUTOINCREMENT, meter_id INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
  reading_date TEXT NOT NULL, value REAL NOT NULL, reading_type TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, salutation TEXT, first_name TEXT, last_name TEXT, company TEXT, co_tenant TEXT,
  street TEXT, zip TEXT, city TEXT, phone TEXT, email TEXT, iban TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS leases (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, start_date TEXT NOT NULL, end_date TEXT, cold_rent REAL NOT NULL DEFAULT 0,
  service_charge REAL DEFAULT 0, heating_charge REAL DEFAULT 0, other_charge REAL DEFAULT 0, deposit REAL, deposit_installments INTEGER DEFAULT 1, payment_day INTEGER, notes TEXT);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE RESTRICT,
  month TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, paid_on TEXT, notes TEXT, UNIQUE (lease_id, month, category));
CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE RESTRICT,
  period_year INTEGER NOT NULL, amount REAL NOT NULL, issued_on TEXT, first_due_month TEXT NOT NULL, installments INTEGER NOT NULL DEFAULT 1, notes TEXT);
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
  lease_id INTEGER REFERENCES leases(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, amount REAL, due_date TEXT, done INTEGER DEFAULT 0, notes TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, record_id INTEGER NOT NULL, filename TEXT NOT NULL,
  stored_path TEXT NOT NULL, mime TEXT, size INTEGER, caption TEXT, created_at TEXT NOT NULL, taken_at TEXT);
CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments (entity, record_id);`;
  const MIGRATIONS = [["units", "parent_unit_id", "INTEGER REFERENCES units(id) ON DELETE SET NULL"], ["tenants", "co_tenant", "TEXT"], ["leases", "deposit_installments", "INTEGER DEFAULT 1"], ["attachments", "taken_at", "TEXT"], ["meters", "supplier", "TEXT"]];
  const DEFAULT_SETTINGS = { tracking_start: "2025-02", rent_grace_days: "5", rent_control_hash: "", rent_control_read: "" };
  const ATTACHABLE = ["buildings", "units", "meters", "meter_readings", "tenants", "leases", "settlements", "payments"];
  const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".pdf"];
  return { TABLES, FLOAT_COLUMNS, SQL, MIGRATIONS, DEFAULT_SETTINGS, ATTACHABLE, ALLOWED_EXT, MAX_UPLOAD: 25 * 1024 * 1024 };
})();

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ======================================================================== server backend (PC)
class ServerBackend {
  constructor() { this.mode = "server"; }
  async init() {}
  async api(method, path, body) {
    const res = await fetch("api/" + path, {
      method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error " + res.status);
    return data;
  }
  async upload(entity, recordId, blob, name, caption, takenAt) {
    const res = await fetch(`api/attachments?entity=${entity}&record_id=${recordId}${caption ? "&caption=" + encodeURIComponent(caption) : ""}${takenAt ? "&taken_at=" + encodeURIComponent(takenAt) : ""}`,
      { method: "POST", headers: { "X-Filename": encodeURIComponent(name), "Content-Type": blob.type || "application/octet-stream" }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  }
  fileUrl(a) { return `files/${a.id}`; }
  /** Rent Control.xlsx (read only) – null if the file does not exist */
  async rentControlFile() {
    const r = await fetch("source/rent-control", { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new ApiError(r.status, `Rent Control.xlsx could not be read (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async resolveFileUrl(a) { return this.fileUrl(a); }
  onStatus() {}
  get dirty() { return false; }
}

// ======================================================================== local backend (browser + OneDrive)
class LocalBackend {
  constructor(store) {
    this.mode = "cloud";
    this.store = store;
    this.db = null;
    this.status = { state: "idle", savedAt: null, error: null };
    this.listeners = [];
    this._timer = null;
    this._saving = null;
    this._dirty = false;
  }

  async init() {
    const SQL = await initSqlJs({ locateFile: (f) => "vendor/" + f });
    const bytes = await this.store.loadDb();
    this.db = new SQL.Database(bytes ? new Uint8Array(bytes) : undefined);
    this._original = bytes ? new Uint8Array(bytes) : null;
    this._prepare();
    this._setStatus({ state: "saved", savedAt: this.store.lastModified || null });
  }

  _prepare() {
    const db = this.db;
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(PA_SCHEMA.SQL);
    for (const [table, col, decl] of PA_SCHEMA.MIGRATIONS) {
      const cols = this._all(`PRAGMA table_info(${table})`).map((r) => r.name);
      if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    }
    for (const [k, v] of Object.entries(PA_SCHEMA.DEFAULT_SETTINGS)) this._run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [k, v]);
  }

  // ---------- sqlite helpers
  _all(sql, params = []) {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  }
  _one(sql, params = []) { return this._all(sql, params)[0] || null; }
  _run(sql, params = []) { this.db.run(sql, params); return this.db.getRowsModified(); }
  _lastId() { return this._one("SELECT last_insert_rowid() AS id").id; }

  // ---------- status / saving
  onStatus(fn) { this.listeners.push(fn); fn(this.status); }
  _setStatus(patch) { this.status = { ...this.status, ...patch }; this.listeners.forEach((fn) => fn(this.status)); }
  get dirty() { return this._dirty || !!this._saving; }
  _changed() {
    this._dirty = true;
    this._setStatus({ state: "dirty", error: null });
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), 1200);
  }
  async save(force = false) {
    clearTimeout(this._timer);
    if (this._saving) { await this._saving; if (!this._dirty) return; }
    if (!this._dirty && !force) return;
    this._dirty = false;
    this._setStatus({ state: "saving" });
    this._saving = (async () => {
      try {
        if (this._original && this.store.backupOnce) await this.store.backupOnce(this._original).catch(() => {});
        const bytes = this.db.export();
        this.db.exec("PRAGMA foreign_keys = ON;"); // export() re-opens the database and resets pragmas
        await this.store.saveDb(bytes, { force });
        this._setStatus({ state: "saved", savedAt: new Date().toISOString(), error: null });
      } catch (e) {
        this._dirty = true;
        this._setStatus({ state: e.conflict ? "conflict" : "error", error: e.message });
      } finally { this._saving = null; }
    })();
    return this._saving;
  }
  async reload() {
    const SQL = await initSqlJs({ locateFile: (f) => "vendor/" + f });
    const bytes = await this.store.loadDb();
    this.db = new SQL.Database(new Uint8Array(bytes));
    this._original = new Uint8Array(bytes);
    this._prepare();
    this._dirty = false;
    this._setStatus({ state: "saved", savedAt: this.store.lastModified || null, error: null });
  }
  exportBytes() { const b = this.db.export(); this.db.exec("PRAGMA foreign_keys = ON;"); return b; }

  // ---------- REST-like API (same paths and answers as server.py)
  async api(method, path, body) {
    try {
      return this._api(method, path, body || {});
    } catch (e) {
      throw new Error(this._friendly(e, method, path));
    }
  }
  _friendly(e, method, path) {
    if (e instanceof ApiError) return e.message;
    const msg = String(e.message || e);
    if (/FOREIGN KEY/i.test(msg)) return method === "DELETE" ? "This record is still linked to other records and cannot be deleted."
      : "The linked record (building, unit, tenant or lease) does not exist.";
    if (/UNIQUE/i.test(msg)) return path.startsWith("payments") ? "A payment for this lease, month and category already exists." : "An entry with this code already exists.";
    if (/NOT NULL/i.test(msg)) return "Required field missing: " + msg.split(".").pop();
    return "Error: " + msg;
  }
  _settings() { return Object.fromEntries(this._all("SELECT * FROM settings").map((r) => [r.key, r.value])); }
  _api(method, path, body) {
    const parts = path.split("?")[0].split("/").filter(Boolean);
    const table = parts[0];
    const rid = parts[1] !== undefined ? Number(parts[1]) : null;
    if (table === "info") return { lan: false, urls: [] };
    if (table === "settings") {
      if (method === "PUT") {
        for (const [k, v] of Object.entries(body)) if (k in PA_SCHEMA.DEFAULT_SETTINGS) this._run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [k, String(v)]);
        this._changed();
      }
      return this._settings();
    }
    if (table === "all" && method === "GET") {
      const out = {};
      for (const t of Object.keys(PA_SCHEMA.TABLES)) out[t] = this._all(`SELECT * FROM ${t} ORDER BY id`);
      out.settings = this._settings();
      out.attachments = this._all("SELECT * FROM attachments ORDER BY id");
      return out;
    }
    if (table === "attachments" && method === "DELETE") return this._deleteAttachment(rid);
    if (!PA_SCHEMA.TABLES[table]) throw new ApiError(404, "Unknown table.");
    if (parts[1] !== undefined && !Number.isInteger(rid)) throw new ApiError(404, "Invalid ID.");

    if (method === "GET") {
      if (rid === null) return this._all(`SELECT * FROM ${table} ORDER BY id`);
      const row = this._one(`SELECT * FROM ${table} WHERE id=?`, [rid]);
      if (!row) throw new ApiError(404, "Record not found.");
      return row;
    }
    if (method === "POST") {
      const data = this._clean(table, body);
      this._checkRequired(data, PA_SCHEMA.TABLES[table][1]);
      this._validate(table, data);
      const cols = Object.keys(data);
      this._run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => data[c]));
      const row = this._one(`SELECT * FROM ${table} WHERE id=?`, [this._lastId()]);
      this._changed();
      return row;
    }
    if (method === "PUT") {
      if (rid === null) throw new ApiError(400, "ID missing.");
      const existing = this._one(`SELECT * FROM ${table} WHERE id=?`, [rid]);
      if (!existing) throw new ApiError(404, "Record not found.");
      const data = this._clean(table, body);
      const merged = { ...existing, ...data };
      this._checkRequired(merged, PA_SCHEMA.TABLES[table][1]);
      this._validate(table, merged);
      const cols = Object.keys(data);
      if (cols.length) this._run(`UPDATE ${table} SET ${cols.map((c) => c + "=?").join(", ")} WHERE id=?`, [...cols.map((c) => data[c]), rid]);
      this._changed();
      return this._one(`SELECT * FROM ${table} WHERE id=?`, [rid]);
    }
    if (method === "DELETE") {
      if (rid === null) throw new ApiError(400, "ID missing.");
      const files = this._all("SELECT * FROM attachments WHERE entity=? AND record_id=?", [table, rid]);
      if (table === "meters") files.push(...this._all("SELECT * FROM attachments WHERE entity='meter_readings' AND record_id IN (SELECT id FROM meter_readings WHERE meter_id=?)", [rid]));
      this.db.exec("SAVEPOINT del");
      try {
        if (table === "meters") this._run("DELETE FROM attachments WHERE entity='meter_readings' AND record_id IN (SELECT id FROM meter_readings WHERE meter_id=?)", [rid]);
        const n = this._run(`DELETE FROM ${table} WHERE id=?`, [rid]);
        if (!n) throw new ApiError(404, "Record not found.");
        this._run("DELETE FROM attachments WHERE entity=? AND record_id=?", [table, rid]);
        this.db.exec("RELEASE del");
      } catch (e) { this.db.exec("ROLLBACK TO del; RELEASE del"); throw e; }
      for (const f of files) this.store.deleteFile("files/" + f.stored_path).catch(() => {});
      this._changed();
      return { deleted: rid };
    }
    throw new ApiError(405, "Method not allowed.");
  }
  _clean(table, payload) {
    const [cols, , numeric] = PA_SCHEMA.TABLES[table];
    const data = {};
    for (const col of cols) {
      if (!(col in payload)) continue;
      let v = payload[col];
      if (typeof v === "string") { v = v.trim(); if (v === "") v = null; }
      if (typeof v === "boolean") v = v ? 1 : 0;
      if (v !== null && v !== undefined && numeric.includes(col)) {
        const n = Number(String(v).replace(",", "."));
        if (!Number.isFinite(n)) throw new ApiError(400, `Field '${col}' must be a number.`);
        v = Number.isInteger(n) && !PA_SCHEMA.FLOAT_COLUMNS.has(col) ? n : n;
      }
      data[col] = v === undefined ? null : v;
    }
    return data;
  }
  _checkRequired(data, required) {
    const missing = required.filter((c) => data[c] === null || data[c] === undefined || data[c] === "");
    if (missing.length) throw new ApiError(400, "Required fields missing: " + missing.join(", "));
  }
  _validate(table, d) {
    const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (table === "tenants" && !(d.last_name || d.company)) throw new ApiError(400, "Please enter a last name or a company.");
    if (table === "units" && d.parent_unit_id) {
      if (d.id && d.parent_unit_id === d.id) throw new ApiError(400, "A unit cannot belong to itself.");
      const r = this._one("SELECT building_id FROM units WHERE id=?", [d.parent_unit_id]);
      if (r && r.building_id !== d.building_id) throw new ApiError(400, "The main unit is located in a different building.");
    }
    if (table === "meters" && d.unit_id) {
      const r = this._one("SELECT building_id FROM units WHERE id=?", [d.unit_id]);
      if (r && d.building_id && r.building_id !== d.building_id) throw new ApiError(400, "The selected unit does not belong to the selected building.");
    }
    if (table === "leases") {
      if (d.end_date && d.start_date && d.end_date < d.start_date) throw new ApiError(400, "Lease end is before lease start.");
      if (d.deposit_installments !== null && d.deposit_installments !== undefined && !(d.deposit_installments >= 1 && d.deposit_installments <= 12)) throw new ApiError(400, "Deposit installments must be between 1 and 12.");
    }
    if (table === "payments") {
      if (!MONTH.test(String(d.month || ""))) throw new ApiError(400, "Month must have the format YYYY-MM.");
      if (!["rent", "service", "settlement", "deposit"].includes(d.category)) throw new ApiError(400, "Unknown payment category.");
    }
    if (table === "settlements") {
      if (!MONTH.test(String(d.first_due_month || ""))) throw new ApiError(400, "First due month must have the format YYYY-MM.");
      const n = Number(d.installments || 1);
      if (!(n >= 1 && n <= 24)) throw new ApiError(400, "Installments must be between 1 and 24.");
    }
    if (table === "reminders" && !["settlement", "date"].includes(d.kind)) throw new ApiError(400, "Unknown reminder type.");
  }

  /** Meter photos: "<tenant>_Meter<id>_(<reading date>)_<meter type>.<ext>" directly in files/meters/ (same rule as server.py meter_file_name) */
  _meterFileName(entity, recordId, ext, takenAt) {
    let meterId, date;
    if (entity === "meter_readings") {
      const r = this._one("SELECT meter_id, reading_date FROM meter_readings WHERE id=?", [recordId]);
      meterId = r.meter_id; date = r.reading_date;
    } else {
      meterId = recordId;
      const last = this._one("SELECT MAX(reading_date) AS d FROM meter_readings WHERE meter_id=?", [meterId]);
      date = (takenAt || "").slice(0, 10) || (last && last.d) || new Date().toISOString().slice(0, 10);
    }
    const m = this._one("SELECT m.*, b.code AS bcode FROM meters m JOIN buildings b ON b.id=m.building_id WHERE m.id=?", [meterId]);
    let who;
    if (!m.unit_id) who = (m.bcode || "Building") + "-Common";
    else {
      const t = this._one(`SELECT t.first_name, t.last_name, t.company FROM leases l JOIN tenants t ON t.id=l.tenant_id
        WHERE l.unit_id=? AND l.start_date<=? AND (l.end_date IS NULL OR l.end_date>=?) ORDER BY l.start_date DESC LIMIT 1`, [m.unit_id, date, date]);
      who = t ? (t.company || [t.first_name, t.last_name].filter(Boolean).join(" ")) : "Vacant";
    }
    const part = (s) => String(s || "").replace(/[^\p{L}\p{N}_.\- ]+/gu, " ").trim().replace(/\s+/g, "-") || "x";
    const base = `meters/${part(who)}_Meter${meterId}_(${date})_${part(m.meter_type)}`;
    const used = new Set(this._all("SELECT stored_path FROM attachments WHERE stored_path LIKE ?", [base + "%"]).map((r) => r.stored_path));
    let rel = base + ext;
    for (let i = 2; used.has(rel); i++) rel = `${base}_${i}${ext}`;
    return rel;
  }

  // ---------- attachments (files live in <data folder>/files/<entity>/<id>/, meter photos in files/meters/ – same layout as the PC version)
  async upload(entity, recordId, blob, name, caption, takenAt) {
    if (!PA_SCHEMA.ATTACHABLE.includes(entity)) throw new Error("Attachments are not possible for this record type.");
    if (!this._one(`SELECT 1 AS x FROM ${entity} WHERE id=?`, [Number(recordId)])) throw new Error("Record not found.");
    let safe = (name || "file").split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, "_").trim() || "file";
    const ext = (safe.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (!PA_SCHEMA.ALLOWED_EXT.includes(ext)) throw new Error("Only images (JPG, PNG, GIF, WEBP, HEIC) and PDF files can be stored.");
    if (!blob.size) throw new Error("The file is empty.");
    if (blob.size > PA_SCHEMA.MAX_UPLOAD) throw new Error("The file is larger than 25 MB.");
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(16).slice(2, 6).padEnd(4, "0");
    takenAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(takenAt || "") ? takenAt : null;
    const meterFile = entity === "meters" || entity === "meter_readings";
    const rel = meterFile ? this._meterFileName(entity, Number(recordId), ext, takenAt) : `${entity}/${recordId}/${stamp}_${rand}_${safe}`;
    if (meterFile) safe = rel.split("/").pop();
    await this.store.putFile("files/" + rel, blob);
    const mime = blob.type || ({ ".pdf": "application/pdf", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic" }[ext] || "image/jpeg");
    this._run("INSERT INTO attachments (entity, record_id, filename, stored_path, mime, size, caption, created_at, taken_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [entity, Number(recordId), safe, rel, mime, blob.size, caption || null, new Date().toISOString().slice(0, 19), takenAt]);
    const row = this._one("SELECT * FROM attachments WHERE id=?", [this._lastId()]);
    this._changed();
    await this.save(); // keep database and files consistent right away
    return row;
  }
  _deleteAttachment(id) {
    const a = this._one("SELECT * FROM attachments WHERE id=?", [id]);
    if (!a) throw new ApiError(404, "Attachment not found.");
    this._run("DELETE FROM attachments WHERE id=?", [id]);
    this.store.deleteFile("files/" + a.stored_path).catch(() => {});
    this._changed();
    return { deleted: id };
  }
  rentControlFile() { return this.store.rentControlFile(); }
  fileUrl(a) { return this.store.cachedFileUrl ? this.store.cachedFileUrl("files/" + a.stored_path) : null; }
  resolveFileUrl(a) { return this.store.fileUrl("files/" + a.stored_path); }
}
