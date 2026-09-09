import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST_DIR = join(ROOT, "dist");
/** На Render с диском: DATA_DIR=/var/data. Локально — папка data в проекте (это уже ваш ПК). */
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "queue.json");
const BACKUP_DIR = join(DATA_DIR, "backups");
const MAX_BACKUPS = 40;
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const SERVE_STATIC = process.env.SERVE_STATIC === "1" || process.env.NODE_ENV === "production";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const STATUSES = new Set(["new", "in_progress", "done", "cancelled"]);

/** @typedef {{ login: string; passwordHash: string; salt: string; role: "admin" | "operator"; name: string }} StaffUser */
/** @typedef {{ id: string; login: string; createdAt: string; expiresAt: string }} Session */
/** @typedef {{
 *  id: number;
 *  kind: string;
 *  brand: string;
 *  model: string;
 *  mileage: string;
 *  service: string;
 *  date: string;
 *  time: string;
 *  name: string;
 *  phone: string;
 *  note: string;
 *  status: "new" | "in_progress" | "done" | "cancelled";
 *  assignee: string | null;
 *  returnReason: string | null;
 *  returnedBy: string | null;
 *  returnedAt: string | null;
 *  createdAt: string;
 *  updatedAt: string;
 *  trashedAt?: string | null;
 * }} BookingRow */

/** @type {{ users: StaffUser[]; sessions: Session[]; bookings: BookingRow[]; nextBookingId: number }} */
let db = {
  users: [],
  sessions: [],
  bookings: [],
  nextBookingId: 1,
};

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash: hash };
}

function verifyPassword(password, salt, passwordHash) {
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(passwordHash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function upsertStaffUser(login, name, role, password) {
  const hashed = hashPassword(password);
  const existing = db.users.find((u) => u.login === login);
  if (existing) {
    existing.name = name;
    existing.role = role;
    existing.salt = hashed.salt;
    existing.passwordHash = hashed.passwordHash;
    return;
  }
  db.users.push({
    login,
    name,
    role,
    salt: hashed.salt,
    passwordHash: hashed.passwordHash,
  });
}

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(BACKUP_DIR, { recursive: true });

  let loaded = false;
  try {
    const raw = await readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    db = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
      nextBookingId: Number(parsed.nextBookingId) || 1,
    };
    loaded = true;
  } catch {
    loaded = false;
  }

  // Если основная база пустая/пропала — поднимаем заявки из последнего бэкапа на диске.
  if (!loaded || !db.bookings.length) {
    const recovered = await tryRecoverBookingsFromBackup();
    if (recovered) {
      console.log(
        `Recovered ${db.bookings.length} booking(s) from backup ${recovered}`,
      );
    } else if (!loaded) {
      db = {
        users: [],
        sessions: [],
        bookings: [],
        nextBookingId: 1,
      };
    }
  }

  const adminLogin = process.env.ADMIN_LOGIN || "admin";
  const operatorLogin = process.env.OPERATOR_LOGIN || "operator";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const operatorPassword = process.env.OPERATOR_PASSWORD || "operator123";

  upsertStaffUser(adminLogin, "Администратор", "admin", adminPassword);
  upsertStaffUser(operatorLogin, "Оператор", "operator", operatorPassword);
  db.sessions = [];
  await saveDb({ forceBackup: true });
}

let lastBackupAt = 0;

function stampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function listBackupFiles() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const names = await readdir(BACKUP_DIR);
  return names
    .filter((name) => /^queue-.+\.json$/i.test(name))
    .sort()
    .reverse();
}

async function pruneBackups() {
  const names = await listBackupFiles();
  for (const name of names.slice(MAX_BACKUPS)) {
    await unlink(join(BACKUP_DIR, name)).catch(() => {});
  }
}

async function writeBackupCopy() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const target = join(BACKUP_DIR, `queue-${stampName()}.json`);
  if (existsSync(DB_PATH)) {
    await copyFile(DB_PATH, target);
  } else {
    await writeFile(target, JSON.stringify(db, null, 2), "utf8");
  }
  lastBackupAt = Date.now();
  await pruneBackups();
  return target;
}

async function tryRecoverBookingsFromBackup() {
  const names = await listBackupFiles();
  for (const name of names) {
    try {
      const raw = await readFile(join(BACKUP_DIR, name), "utf8");
      const parsed = JSON.parse(raw);
      const bookings = Array.isArray(parsed.bookings) ? parsed.bookings : [];
      if (!bookings.length) continue;
      const maxId = bookings.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0);
      db.bookings = bookings;
      db.nextBookingId = Math.max(Number(parsed.nextBookingId) || 1, maxId + 1);
      return name;
    } catch {
      /* next backup */
    }
  }
  return null;
}

function exportBookingsPayload() {
  return {
    version: 1,
    kind: "tls-bookings-backup",
    exportedAt: new Date().toISOString(),
    bookings: db.bookings,
    nextBookingId: db.nextBookingId,
  };
}

async function saveDb(options = {}) {
  const forceBackup = Boolean(options.forceBackup);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");

  const due = forceBackup || Date.now() - lastBackupAt > 60_000;
  if (due) {
    try {
      await writeBackupCopy();
    } catch (error) {
      console.error("Backup failed:", error);
    }
  }
}

function sendDownload(res, filename, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const buffer = Buffer.from(body, "utf8");
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
  });
  res.end(buffer);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new Error("Слишком большое тело запроса"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Некорректный JSON"));
      }
    });
    req.on("error", reject);
  });
}

function cleanSessions(now = Date.now()) {
  db.sessions = db.sessions.filter((s) => Date.parse(s.expiresAt) > now);
}

function resolveToken(req, url) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1];
  if (url) {
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery;
  }
  return "";
}

function getAuth(req, url) {
  const token = resolveToken(req, url);
  if (!token) return null;
  cleanSessions();
  const hash = tokenHash(token);
  const session = db.sessions.find((s) => s.id === hash);
  if (!session) return null;
  const user = db.users.find((u) => u.login === session.login);
  if (!user) return null;
  return { user, session, token };
}

/** @type {Set<import('node:http').ServerResponse>} */
const bookingListeners = new Set();

function broadcastBookings() {
  const payload = `event: bookings\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`;
  for (const client of bookingListeners) {
    try {
      client.write(payload);
    } catch {
      bookingListeners.delete(client);
    }
  }
}

function handleBookingStream(req, res, url) {
  const auth = getAuth(req, url);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  bookingListeners.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
      bookingListeners.delete(res);
    }
  }, 20000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bookingListeners.delete(res);
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
}

function publicUser(user) {
  return { login: user.login, name: user.name, role: user.role };
}

function normalizeLogin(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const login = normalizeLogin(body.login);
  const password = String(body.password || "");
  if (!login || !password) {
    json(res, 400, { error: "Укажите логин и пароль" });
    return;
  }

  const user = db.users.find((u) => u.login === login);
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    json(res, 401, { error: "Неверный логин или пароль" });
    return;
  }

  cleanSessions();
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  db.sessions.push({
    id: tokenHash(token),
    login: user.login,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 14).toISOString(),
  });
  await saveDb();
  json(res, 200, { token, user: publicUser(user) });
}

async function handleLogout(req, res) {
  const auth = getAuth(req);
  if (auth) {
    db.sessions = db.sessions.filter((s) => s.id !== auth.session.id);
    await saveDb();
  }
  json(res, 200, { ok: true });
}

function handleMe(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  json(res, 200, { user: publicUser(auth.user) });
}

async function handleCreateBooking(req, res) {
  const body = await readBody(req);
  const required = ["kind", "brand", "model", "date", "time", "name", "phone"];
  for (const key of required) {
    if (!String(body[key] || "").trim()) {
      json(res, 400, { error: `Заполните поле: ${key}` });
      return;
    }
  }
  if (!body.consent) {
    json(res, 400, { error: "Нужно согласие на обработку персональных данных" });
    return;
  }

  const now = new Date().toISOString();
  const booking = {
    id: db.nextBookingId++,
    kind: String(body.kind).trim(),
    brand: String(body.brand).trim(),
    model: String(body.model).trim(),
    mileage: String(body.mileage || "").trim(),
    service: String(body.service || "").trim(),
    date: String(body.date).trim(),
    time: String(body.time).trim(),
    name: String(body.name).trim(),
    phone: String(body.phone).trim(),
    note: String(body.note || "").trim(),
    status: "new",
    assignee: null,
    returnReason: null,
    returnedBy: null,
    returnedAt: null,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
  };
  db.bookings.push(booking);
  await saveDb();
  broadcastBookings();
  json(res, 201, { booking });
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function handleLookupBookings(req, res) {
  const body = await readBody(req);
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  const wanted = rawItems
    .map((item) => ({
      id: Number(item?.id),
      phone: normalizePhoneDigits(item?.phone),
    }))
    .filter((item) => Number.isFinite(item.id) && item.phone.length >= 10);

  if (!wanted.length) {
    json(res, 200, { bookings: [] });
    return;
  }

  const byId = new Map(wanted.map((item) => [item.id, item.phone]));
  const bookings = db.bookings
    .filter((booking) => {
      if (booking.trashedAt) return false;
      const phone = byId.get(booking.id);
      if (!phone) return false;
      return normalizePhoneDigits(booking.phone) === phone;
    })
    .map((booking) => ({
      id: booking.id,
      kind: booking.kind,
      brand: booking.brand,
      model: booking.model,
      service: booking.service,
      date: booking.date,
      time: booking.time,
      name: booking.name,
      phone: booking.phone,
      status: booking.status,
    }))
    .sort((a, b) => b.id - a.id);

  json(res, 200, { bookings });
}

function handleListBookings(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  const items = db.bookings
    .filter((b) => !b.trashedAt)
    .slice()
    .sort((a, b) => b.id - a.id);
  json(res, 200, { bookings: items });
}

function handleListTrash(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  const items = db.bookings
    .filter((b) => Boolean(b.trashedAt))
    .slice()
    .sort((a, b) => Date.parse(b.trashedAt || "") - Date.parse(a.trashedAt || ""));
  json(res, 200, { bookings: items });
}

async function handlePatchBooking(req, res, id) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }

  const booking = db.bookings.find((b) => b.id === id && !b.trashedAt);
  if (!booking) {
    json(res, 404, { error: "Заявка не найдена" });
    return;
  }

  const body = await readBody(req);
  if (body.status != null) {
    const status = String(body.status);
    if (!STATUSES.has(status)) {
      json(res, 400, { error: "Неизвестный статус" });
      return;
    }
    booking.status = status;
    if (status === "in_progress" && !booking.assignee) {
      booking.assignee = auth.user.login;
    }
    if (status === "new") {
      const reason = String(body.returnReason || "").trim();
      if (reason.length < 5) {
        json(res, 400, {
          error: "Чтобы вернуть заявку в новые, напишите причину (минимум 5 символов)",
        });
        return;
      }
      booking.assignee = null;
      booking.returnReason = reason;
      booking.returnedBy = auth.user.login;
      booking.returnedAt = new Date().toISOString();
    }
  }
  if (body.take === true) {
    booking.status = "in_progress";
    booking.assignee = auth.user.login;
  }
  booking.updatedAt = new Date().toISOString();
  await saveDb();
  broadcastBookings();
  json(res, 200, { booking });
}

async function handleTrashBooking(req, res, id) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }

  const booking = db.bookings.find((b) => b.id === id && !b.trashedAt);
  if (!booking) {
    json(res, 404, { error: "Заявка не найдена" });
    return;
  }

  const now = new Date().toISOString();
  booking.trashedAt = now;
  booking.updatedAt = now;
  await saveDb({ forceBackup: true });
  broadcastBookings();
  json(res, 200, { booking });
}

async function handleRestoreBooking(req, res, id) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }

  const booking = db.bookings.find((b) => b.id === id && b.trashedAt);
  if (!booking) {
    json(res, 404, { error: "В корзине такой заявки нет" });
    return;
  }

  booking.trashedAt = null;
  booking.updatedAt = new Date().toISOString();
  await saveDb();
  broadcastBookings();
  json(res, 200, { booking });
}

async function handlePurgeBooking(req, res, id) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }

  const index = db.bookings.findIndex((b) => b.id === id && b.trashedAt);
  if (index === -1) {
    json(res, 404, { error: "В корзине такой заявки нет" });
    return;
  }

  db.bookings.splice(index, 1);
  await saveDb({ forceBackup: true });
  broadcastBookings();
  json(res, 200, { ok: true });
}

async function handleEmptyTrash(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }

  const before = db.bookings.length;
  db.bookings = db.bookings.filter((b) => !b.trashedAt);
  await saveDb({ forceBackup: true });
  broadcastBookings();
  json(res, 200, { ok: true, removed: before - db.bookings.length });
}

function handleDownloadBackup(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  const filename = `tls-bookings-${stampName()}.json`;
  sendDownload(res, filename, exportBookingsPayload());
}

async function handleListBackups(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  const names = await listBackupFiles();
  json(res, 200, {
    backups: names.slice(0, 20).map((name) => ({ name })),
    dataDir: DATA_DIR,
    bookingCount: db.bookings.length,
  });
}

async function handleRestoreBackup(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  if (auth.user.role !== "admin") {
    json(res, 403, { error: "Восстановление только для администратора" });
    return;
  }

  const body = await readBody(req);
  const bookings = Array.isArray(body.bookings) ? body.bookings : null;
  if (!bookings) {
    json(res, 400, { error: "В файле нет списка заявок (bookings)" });
    return;
  }

  await writeBackupCopy();
  const maxId = bookings.reduce((max, b) => Math.max(max, Number(b?.id) || 0), 0);
  db.bookings = bookings.map((item) => ({
    id: Number(item.id) || 0,
    kind: String(item.kind || "repair"),
    brand: String(item.brand || ""),
    model: String(item.model || ""),
    mileage: String(item.mileage || ""),
    service: String(item.service || ""),
    date: String(item.date || ""),
    time: String(item.time || ""),
    name: String(item.name || ""),
    phone: String(item.phone || ""),
    note: String(item.note || ""),
    status: STATUSES.has(String(item.status)) ? String(item.status) : "new",
    assignee: item.assignee ? String(item.assignee) : null,
    returnReason: item.returnReason ? String(item.returnReason) : null,
    returnedBy: item.returnedBy ? String(item.returnedBy) : null,
    returnedAt: item.returnedAt ? String(item.returnedAt) : null,
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || new Date().toISOString()),
    trashedAt: item.trashedAt ? String(item.trashedAt) : null,
  }));
  db.nextBookingId = Math.max(Number(body.nextBookingId) || 1, maxId + 1);
  await saveDb({ forceBackup: true });
  broadcastBookings();
  json(res, 200, { ok: true, restored: db.bookings.length });
}

async function handleCreateStaff(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  if (auth.user.role !== "admin") {
    json(res, 403, { error: "Только администратор может добавлять сотрудников" });
    return;
  }

  const body = await readBody(req);
  const login = normalizeLogin(body.login);
  const password = String(body.password || "");
  const name = String(body.name || login).trim() || login;
  // Новых админов через панель создавать нельзя — только операторов.
  const role = "operator";

  if (body.role === "admin") {
    json(res, 403, { error: "Нельзя выдать роль администратора. Создавайте только операторов." });
    return;
  }

  if (!login || login.length < 3) {
    json(res, 400, { error: "Логин: минимум 3 символа (латиница, цифры)" });
    return;
  }
  if (password.length < 6) {
    json(res, 400, { error: "Пароль: минимум 6 символов" });
    return;
  }
  if (db.users.some((u) => u.login === login)) {
    json(res, 409, { error: "Такой логин уже есть" });
    return;
  }

  const hashed = hashPassword(password);
  db.users.push({
    login,
    name,
    role,
    salt: hashed.salt,
    passwordHash: hashed.passwordHash,
  });
  await saveDb();
  json(res, 201, { user: { login, name, role } });
}

function handleListStaff(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    json(res, 401, { error: "Нужен вход" });
    return;
  }
  if (auth.user.role !== "admin") {
    json(res, 403, { error: "Только администратор" });
    return;
  }
  json(res, 200, {
    users: db.users.map((u) => publicUser(u)),
  });
}

function notFound(res) {
  json(res, 404, { error: "Не найдено" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;
    const method = req.method || "GET";

    if (method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (method === "POST" && pathname === "/api/auth/login") {
      await handleLogin(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/auth/logout") {
      await handleLogout(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/auth/me") {
      handleMe(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/bookings") {
      await handleCreateBooking(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/bookings/lookup") {
      await handleLookupBookings(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/bookings") {
      handleListBookings(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/bookings/stream") {
      handleBookingStream(req, res, url);
      return;
    }
    if (method === "GET" && pathname === "/api/bookings/trash") {
      handleListTrash(req, res);
      return;
    }
    if (method === "DELETE" && pathname === "/api/bookings/trash") {
      await handleEmptyTrash(req, res);
      return;
    }
    const bookingMatch = /^\/api\/bookings\/(\d+)$/.exec(pathname);
    if (method === "PATCH" && bookingMatch) {
      await handlePatchBooking(req, res, Number(bookingMatch[1]));
      return;
    }
    if (method === "DELETE" && bookingMatch) {
      await handleTrashBooking(req, res, Number(bookingMatch[1]));
      return;
    }
    const restoreMatch = /^\/api\/bookings\/(\d+)\/restore$/.exec(pathname);
    if (method === "POST" && restoreMatch) {
      await handleRestoreBooking(req, res, Number(restoreMatch[1]));
      return;
    }
    const purgeMatch = /^\/api\/bookings\/(\d+)\/permanent$/.exec(pathname);
    if (method === "DELETE" && purgeMatch) {
      await handlePurgeBooking(req, res, Number(purgeMatch[1]));
      return;
    }
    if (method === "GET" && pathname === "/api/staff") {
      handleListStaff(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/staff") {
      await handleCreateStaff(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/backup/download") {
      handleDownloadBackup(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/backup") {
      await handleListBackups(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/backup/restore") {
      await handleRestoreBackup(req, res);
      return;
    }

    if (SERVE_STATIC && (method === "GET" || method === "HEAD")) {
      if (await tryServeStatic(req, res, pathname)) return;
    }

    notFound(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сервера";
    json(res, 500, { error: message });
  }
});

function safeDistPath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split("?")[0] || "/");
  const relative = cleaned === "/" ? "index.html" : cleaned.replace(/^\/+/, "");
  const full = normalize(join(DIST_DIR, relative));
  if (!full.startsWith(DIST_DIR)) return null;
  return full;
}

async function tryServeStatic(req, res, pathname) {
  let filePath = safeDistPath(pathname);
  if (!filePath) return false;

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const asHtml = safeDistPath(`${pathname.replace(/\/$/, "")}.html`);
    if (asHtml && existsSync(asHtml) && statSync(asHtml).isFile()) {
      filePath = asHtml;
    } else {
      return false;
    }
  }

  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}

await ensureDb();
server.listen(PORT, HOST, () => {
  console.log(`TLS Service listening on http://${HOST}:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (SERVE_STATIC) console.log(`Static files from ${DIST_DIR}`);
});
