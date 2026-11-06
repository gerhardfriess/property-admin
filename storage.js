/* Property Administration – storage for the browser version.
 *
 * GraphStore: Microsoft sign-in (MSAL) + OneDrive access via Microsoft Graph.
 *   - the database file <data folder>/property.db is downloaded, edited in the browser and uploaded again
 *   - uploads use the file's eTag, so changes made elsewhere in the meantime are never overwritten silently
 *   - once per day a backup copy of the loaded database is written to <data folder>/backups/
 * DevStore: local test mode (?dev) – loads dev/property.db from the web server, never writes anywhere.
 */
"use strict";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SIMPLE_UPLOAD_LIMIT = 3.5 * 1024 * 1024; // Graph allows simple PUT uploads up to 4 MB
const encodePath = (p) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

class StoreError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

class GraphStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.kind = "onedrive";
    this.scopes = ["User.Read", "Files.ReadWrite"];
    this.folder = (localStorage.getItem("pa_data_folder") ?? cfg.defaultDataFolder ?? "").replace(/^\/+|\/+$/g, "");
    this.dbItem = null;
    this.urlCache = new Map();
    this.msal = new msal.PublicClientApplication({
      auth: { clientId: cfg.clientId, authority: cfg.authority, redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true },
    });
  }

  // ---------- sign-in
  async initAuth() {
    const res = await this.msal.handleRedirectPromise();
    if (res?.account) this.msal.setActiveAccount(res.account);
    const acc = this.msal.getActiveAccount() || this.msal.getAllAccounts()[0];
    if (acc) this.msal.setActiveAccount(acc);
    return acc || null;
  }
  get account() { return this.msal.getActiveAccount(); }
  signIn() { return this.msal.loginRedirect({ scopes: this.scopes, prompt: "select_account" }); }
  signOut() { return this.msal.logoutRedirect({ account: this.account, postLogoutRedirectUri: location.origin + location.pathname }); }
  async token() {
    try {
      return (await this.msal.acquireTokenSilent({ scopes: this.scopes, account: this.account })).accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError) { await this.msal.acquireTokenRedirect({ scopes: this.scopes, account: this.account }); }
      throw e;
    }
  }
  async graph(path, { method = "GET", headers = {}, body, raw = false } = {}) {
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, {
      method, body, headers: { Authorization: "Bearer " + (await this.token()), ...headers },
    });
    if (raw) return res;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new StoreError(err.error?.message || `OneDrive error ${res.status}`, { status: res.status, conflict: res.status === 412 });
    }
    return res.status === 204 ? null : res.json();
  }
  /** Graph address of a file in the data folder: root:/path  or  root:/path:/<sub> for actions like /content */
  itemPath(rel, sub = "") { return `/me/drive/root:/${encodePath((this.folder ? this.folder + "/" : "") + rel)}` + (sub ? `:/${sub}` : ""); }

  // ---------- database
  setFolder(folder) {
    this.folder = folder.replace(/^\/+|\/+$/g, "");
    localStorage.setItem("pa_data_folder", this.folder);
    this.dbItem = null;
    this.urlCache.clear();
  }
  async loadDb() {
    const res = await this.graph(this.itemPath("property.db"), { raw: true });
    if (res.status === 404) throw new StoreError(`No database found in the OneDrive folder “${this.folder || "/"}”.`, { notFound: true });
    if (!res.ok) throw new StoreError(`OneDrive error ${res.status}`);
    this.dbItem = await res.json();
    this.lastModified = this.dbItem.lastModifiedDateTime;
    const dl = await fetch(this.dbItem["@microsoft.graph.downloadUrl"], { cache: "no-store" });
    if (!dl.ok) throw new StoreError("The database could not be downloaded from OneDrive.");
    return await dl.arrayBuffer();
  }
  async saveDb(bytes, { force = false } = {}) {
    const headers = force ? {} : { "If-Match": this.dbItem.eTag };
    let item;
    if (bytes.length <= SIMPLE_UPLOAD_LIMIT) {
      item = await this.graph(`/me/drive/items/${this.dbItem.id}/content`, { method: "PUT", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: bytes });
    } else {
      item = await this.uploadLarge(`/me/drive/items/${this.dbItem.id}/createUploadSession`, bytes, headers);
    }
    if (!item?.eTag) item = await this.graph(`/me/drive/items/${this.dbItem.id}`);
    this.dbItem = { ...this.dbItem, ...item };
    this.lastModified = item.lastModifiedDateTime;
  }
  async backupOnce(bytes) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `pa_backup_${this.folder}_${day}`;
    if (localStorage.getItem(key)) return;
    const res = await this.graph(this.itemPath(`backups/property_${day}_web.db`, "content?@microsoft.graph.conflictBehavior=fail"),
      { method: "PUT", raw: true, headers: { "Content-Type": "application/octet-stream" }, body: bytes });
    if (res.ok || res.status === 409) localStorage.setItem(key, "1");
  }
  async uploadLarge(sessionPath, blob, headers = {}) {
    const session = await this.graph(sessionPath, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) });
    const size = blob.size ?? blob.length;
    const chunk = 320 * 1024 * 10;
    let res;
    for (let start = 0; start < size; start += chunk) {
      const end = Math.min(start + chunk, size);
      const part = blob.slice(start, end);
      res = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end - 1}/${size}` }, body: part });
      if (!res.ok && res.status !== 202) throw new StoreError(`Upload failed (${res.status})`);
    }
    return res.json();
  }

  // ---------- files (photos, PDFs)
  async putFile(rel, blob) {
    if (blob.size <= SIMPLE_UPLOAD_LIMIT) {
      await this.graph(this.itemPath(rel, "content"), { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
    } else {
      await this.uploadLarge(this.itemPath(rel, "createUploadSession"), blob);
    }
  }
  async deleteFile(rel) {
    const res = await this.graph(this.itemPath(rel), { method: "DELETE", raw: true });
    if (!res.ok && res.status !== 404) throw new StoreError(`Delete failed (${res.status})`);
  }
  cachedFileUrl(rel) {
    const c = this.urlCache.get(rel);
    return c && Date.now() - c.t < 40 * 60 * 1000 ? c.url : null; // download links are valid for about one hour
  }
  async fileUrl(rel) {
    const cached = this.cachedFileUrl(rel);
    if (cached) return cached;
    const item = await this.graph(this.itemPath(rel));
    const url = item["@microsoft.graph.downloadUrl"];
    this.urlCache.set(rel, { url, t: Date.now() });
    return url;
  }
  async fileExists(rel) {
    const res = await this.graph(this.itemPath(rel) + "?$select=id", { raw: true }); // GET root:/path?$select=id
    return res.ok;
  }

  // ---------- Rent Control.xlsx (read only – never written)
  get rentControlPath() { return (localStorage.getItem("pa_rent_control_path") ?? this.cfg.rentControlFile ?? "").replace(/^\/+|\/+$/g, ""); }
  setRentControlPath(p) { localStorage.setItem("pa_rent_control_path", p.replace(/^\/+|\/+$/g, "")); }
  async rentControlFile() {
    if (!this.rentControlPath) return null;
    const res = await this.graph(`/me/drive/root:/${encodePath(this.rentControlPath)}`, { raw: true });
    if (res.status === 404) return null;
    if (!res.ok) throw new StoreError(`OneDrive error ${res.status}`);
    const dl = await fetch((await res.json())["@microsoft.graph.downloadUrl"], { cache: "no-store" });
    if (!dl.ok) throw new StoreError("Rent Control.xlsx could not be downloaded from OneDrive.");
    return new Uint8Array(await dl.arrayBuffer());
  }

  // ---------- folder browser (settings)
  async listFolders(path) {
    const p = path.replace(/^\/+|\/+$/g, "");
    const base = p ? `/me/drive/root:/${encodePath(p)}:/children` : "/me/drive/root/children";
    const data = await this.graph(base + "?$select=name,folder,file&$top=500");
    return {
      folders: data.value.filter((x) => x.folder).map((x) => x.name).sort((a, b) => a.localeCompare(b)),
      hasDb: data.value.some((x) => x.file && x.name === "property.db"),
    };
  }
}

class DevStore {
  constructor() { this.kind = "dev"; this.folder = "dev (local test data)"; this.files = new Map(); this.saves = 0; }
  async initAuth() { return { username: "test@local" }; }
  get account() { return { username: "test@local", name: "Local test" }; }
  async loadDb() {
    const r = await fetch("dev/property.db", { cache: "no-store" });
    if (!r.ok) throw new StoreError("dev/property.db not found", { notFound: true });
    this.lastModified = new Date().toISOString();
    return r.arrayBuffer();
  }
  async saveDb(bytes) { this.saves++; this.lastBytes = bytes; console.info(`[dev] database saved in memory (${bytes.length} bytes, save #${this.saves})`); }
  async putFile(rel, blob) { this.files.set(rel, URL.createObjectURL(blob)); }
  async deleteFile(rel) { this.files.delete(rel); }
  cachedFileUrl(rel) { return this.files.get(rel) || null; }
  async fileUrl(rel) { return this.files.get(rel) || null; }
  async fileExists(rel) { return this.files.has(rel); }
  async listFolders() { return { folders: [], hasDb: true }; }
  get rentControlPath() { return "dev/Rent Control.xlsx"; }
  setRentControlPath() {}
  async rentControlFile() {
    const r = await fetch("dev/Rent%20Control.xlsx", { cache: "no-store" });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  setFolder() {}
}
