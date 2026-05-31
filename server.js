import express from "express";
import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import dns from "dns";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { MongoClient } from "mongodb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const ADMIN_ENTRY = "/vault-6388391842";
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.RENDER_SERVICE_ID);
const PERSISTENT_ROOT = IS_RENDER ? "/tmp/metagram" : __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(PERSISTENT_ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PERSISTENT_ROOT, "uploads");
let activeDataDir = DATA_DIR;
let activeUploadDir = UPLOAD_DIR;
let dbFile = path.join(activeDataDir, "db.json");
const DELETE_EVERYONE_WINDOW_MS = 5 * 60 * 1000;
const EDIT_MESSAGE_WINDOW_MS = 15 * 60 * 1000;
const STATUS_EXPIRE_MS = 24 * 60 * 60 * 1000;
const UPLOAD_FILE_SIZE_LIMIT = Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 500 * 1024 * 1024);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "metagram";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "app_state";
const MONGODB_KEEPALIVE_INTERVAL_MS = Number(process.env.MONGODB_KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000);
const MONGODB_DNS_SERVERS = process.env.MONGODB_DNS_SERVERS?.split(",").map((server) => server.trim()).filter(Boolean);
const SELF_PING_ENABLED = String(process.env.SELF_PING_ENABLED ?? (IS_RENDER ? "true" : "false")).toLowerCase() === "true";
const SELF_PING_INTERVAL_MS = Number(process.env.SELF_PING_INTERVAL_MS || 12 * 60 * 1000);
const SELF_PING_URL = process.env.SELF_PING_URL
  || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/healthz` : "");

if (MONGODB_DNS_SERVERS?.length) {
  dns.setServers(MONGODB_DNS_SERVERS);
}

function ensureWritableDir(dir, fallbackDir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch (error) {
    if (!fallbackDir || dir === fallbackDir) throw error;
    console.warn(`Cannot write to "${dir}". Falling back to "${fallbackDir}".`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}

if (!MONGODB_URI) {
  activeDataDir = ensureWritableDir(DATA_DIR, path.join("/tmp", "metagram", "data"));
  dbFile = path.join(activeDataDir, "db.json");
}
activeUploadDir = ensureWritableDir(UPLOAD_DIR, path.join("/tmp", "metagram", "uploads"));

let mongoClient = null;
let stateCollection = null;
let mongoKeepaliveTimer = null;
let selfPingTimer = null;

const defaultDb = {
  users: [],
  messages: [],
  conversations: [],
  groups: [],
  statuses: [],
  sharedItems: [],
  admin: {
    loginId: "6388391842",
    passwordHash: bcrypt.hashSync("123456", 10),
    updatedAt: new Date().toISOString(),
    secretCodeLoginEnabled: false,
    updateNotify: {
      enabled: false,
      version: 1,
      message: "Please update the app to continue.",
      updatedAt: null
    }
  }
};

function normalizeDb(raw = {}) {
  const admin = {
    ...defaultDb.admin,
    ...(raw.admin || {}),
    updateNotify: {
      ...defaultDb.admin.updateNotify,
      ...((raw.admin || {}).updateNotify || {})
    }
  };
  return {
    users: raw.users || [],
    messages: raw.messages || [],
    conversations: raw.conversations || [],
    groups: raw.groups || [],
    statuses: raw.statuses || [],
    sharedItems: raw.sharedItems || [],
    admin
  };
}

function loadLocalDb() {
  if (!fs.existsSync(dbFile)) return normalizeDb(defaultDb);
  return normalizeDb(JSON.parse(fs.readFileSync(dbFile, "utf8")));
}

async function loadDb() {
  if (MONGODB_URI) {
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      stateCollection = mongoClient.db(MONGODB_DB).collection(MONGODB_COLLECTION);
      const existing = await stateCollection.findOne({ key: "main" });
      if (existing) {
        const { _id, key, ...state } = existing;
        console.log(`Using MongoDB Atlas database "${MONGODB_DB}".`);
        return normalizeDb(state);
      }
      const initialDb = loadLocalDb();
      await stateCollection.insertOne({ key: "main", ...initialDb });
      console.log(`Initialized MongoDB Atlas database "${MONGODB_DB}" from local data.`);
      return initialDb;
    } catch (error) {
      console.error("MongoDB connection failed. Check MONGODB_URI, database user password, and Atlas network access.");
      throw error;
    }
  }

  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify(defaultDb, null, 2));
  }
  console.log("Using local JSON database. Set MONGODB_URI in production.");
  return normalizeDb(JSON.parse(fs.readFileSync(dbFile, "utf8")));
}

let db = await loadDb();
const privacyUnlockAttempts = new Map();

function saveDb() {
  if (stateCollection) {
    stateCollection
      .replaceOne({ key: "main" }, { key: "main", ...db }, { upsert: true })
      .catch((error) => console.error("MongoDB save failed:", error));
    return;
  }
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function startMongoKeepalive() {
  if (!mongoClient || mongoKeepaliveTimer || MONGODB_KEEPALIVE_INTERVAL_MS <= 0) return;
  mongoKeepaliveTimer = setInterval(async () => {
    try {
      await mongoClient.db(MONGODB_DB).command({ ping: 1 });
      console.log("MongoDB keepalive ping sent.");
    } catch (error) {
      console.error("MongoDB keepalive ping failed:", error);
    }
  }, MONGODB_KEEPALIVE_INTERVAL_MS);
}

startMongoKeepalive();

function startSelfPing() {
  if (!SELF_PING_ENABLED || !SELF_PING_URL || selfPingTimer || SELF_PING_INTERVAL_MS <= 0) return;
  selfPingTimer = setInterval(async () => {
    try {
      const response = await fetch(SELF_PING_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`Self ping ok: ${SELF_PING_URL}`);
    } catch (error) {
      console.error("Self ping failed:", error);
    }
  }, SELF_PING_INTERVAL_MS);
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, hiddenChatSecret, privacyCodeHash, privacyCodeAdminValue, ...safe } = user;
  safe.privacyMode = {
    enabled: Boolean(user.privacyMode?.enabled),
    hasCode: Boolean(user.privacyCodeHash),
    autoLockMinutes: Number(user.privacyMode?.autoLockMinutes || 0),
    panicShortcut: user.privacyMode?.panicShortcut || "button"
  };
  return safe;
}

function normalizeUserId(value = "") {
  return String(value).trim().toLowerCase();
}

function validUserId(value = "") {
  return /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$/.test(value) && !value.includes("..");
}

function validateUserId(value = "") {
  const userId = normalizeUserId(value);
  if (!validUserId(userId)) {
    return { error: "User ID must be 3-30 characters and can use lowercase letters, numbers, dots, and underscores." };
  }
  return { userId };
}

function ownUser(user) {
  return {
    ...publicUser(user),
    hasHiddenChatSecret: Boolean(user.hiddenChatSecret)
  };
}

function adminUser(user) {
  return {
    ...publicUser(user),
    online: onlineUsers.has(user.id),
    lastSeenAt: user.lastSeenAt || null,
    hiddenChatSecret: user.hiddenChatSecret || null,
    hiddenChatCount: (user.hiddenUserIds || []).length,
    hiddenChatUsers: (user.hiddenUserIds || []).map((id) => publicUser(db.users.find((item) => item.id === id))).filter(Boolean),
    privacyUnlockCode: user.privacyCodeAdminValue || null,
    hasPrivacyUnlockCode: Boolean(user.privacyCodeHash)
  };
}

function signUser(user) {
  return jwt.sign({ id: user.id, role: "user" }, JWT_SECRET, { expiresIn: "7d" });
}

function signAdmin() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
}

function signPrivacy(user) {
  return jwt.sign({ id: user.id, role: "privacy" }, JWT_SECRET, { expiresIn: "12h" });
}

function validPrivacyCode(code) {
  return /^\d{6}$/.test(String(code || "").trim());
}

function checkPrivacyRateLimit(req, user) {
  const key = `${user.id}:${req.ip}`;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 8;
  const entry = privacyUnlockAttempts.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  privacyUnlockAttempts.set(key, entry);
  return entry.count <= maxAttempts;
}

function privacyRateLimited(req, user) {
  const entry = privacyUnlockAttempts.get(`${user.id}:${req.ip}`);
  return Boolean(entry && Date.now() <= entry.resetAt && entry.count >= 8);
}

function clearPrivacyRateLimit(req, user) {
  privacyUnlockAttempts.delete(`${user.id}:${req.ip}`);
}

function privacyModeEnabled(user) {
  return Boolean(user?.privacyMode?.enabled && user.privacyCodeHash);
}

function verifyPrivacyToken(user, token) {
  if (!privacyModeEnabled(user)) return true;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.role === "privacy" && payload.id === user.id;
  } catch {
    return false;
  }
}

function requirePrivacyUnlocked(req, res, next) {
  if (verifyPrivacyToken(req.user, req.headers["x-privacy-token"])) return next();
  res.status(423).json({ error: "Privacy session required." });
}

function authUser(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((item) => item.id === payload.id && !item.deleted);
    if (!user || user.blocked || user.suspended) return res.status(403).json({ error: "Account is not active." });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Authentication required." });
  }
}

function authAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("not admin");
    next();
  } catch {
    res.status(401).json({ error: "Admin authentication required." });
  }
}

function makeConversation(participants, groupId = null) {
  const normalized = [...new Set(participants)].sort();
  let conversation = db.conversations.find((item) => {
    if (groupId) return item.groupId === groupId;
    return !item.groupId && JSON.stringify(item.participants.sort()) === JSON.stringify(normalized);
  });
  if (!conversation) {
    conversation = {
      id: crypto.randomUUID(),
      participants: normalized,
      groupId,
      pinnedBy: [],
      archivedBy: [],
      createdAt: new Date().toISOString()
    };
    db.conversations.push(conversation);
    saveDb();
  }
  return conversation;
}

function ensureUserCollections(user) {
  user.hiddenUserIds ||= [];
  user.deletedUserIds ||= [];
  user.blockedUserIds ||= [];
  user.pinnedConversationIds ||= [];
  user.archivedConversationIds ||= [];
  user.starredMessageIds ||= [];
  user.reactionEmojis ||= [];
  return user;
}

function ensureConversationCollections(conversation) {
  conversation.pinnedBy ||= [];
  conversation.archivedBy ||= [];
  return conversation;
}

function ensureGroupCollections(group, ownerId = null) {
  if (!group) return group;
  group.memberIds ||= [];
  group.adminIds ||= [];
  if (ownerId && !group.ownerId) group.ownerId = ownerId;
  if (group.ownerId) group.adminIds = [...new Set([group.ownerId, ...group.adminIds])];
  return group;
}

function groupCanManage(group, userId) {
  ensureGroupCollections(group);
  return Boolean(group?.ownerId === userId || (group?.adminIds || []).includes(userId));
}

function visibleMessages(conversationId, userId) {
  return db.messages
    .filter((message) => message.conversationId === conversationId)
    .filter((message) => !message.adminOnly)
    .filter((message) => !message.deletedFor?.includes(userId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function otherParticipant(conversation, userId) {
  return conversation.participants.find((id) => id !== userId);
}

function isHiddenConversation(conversation, user) {
  if (conversation.groupId) return false;
  return (user.hiddenUserIds || []).includes(otherParticipant(conversation, user.id));
}

function isDeletedConversation(conversation, user) {
  if (conversation.groupId) return false;
  return (user.deletedUserIds || []).includes(otherParticipant(conversation, user.id));
}

function blockedBetween(userAId, userBId) {
  const userA = db.users.find((item) => item.id === userAId);
  const userB = db.users.find((item) => item.id === userBId);
  return Boolean((userA?.blockedUserIds || []).includes(userBId) || (userB?.blockedUserIds || []).includes(userAId));
}

function hydrateConversation(conversation, user) {
  ensureUserCollections(user);
  ensureConversationCollections(conversation);
  const messages = visibleMessages(conversation.id, user.id);
  const members = conversation.participants.map((id) => {
    const member = db.users.find((item) => item.id === id);
    return { ...publicUser(member), online: onlineUsers.has(id) };
  });
  const group = conversation.groupId ? ensureGroupCollections(db.groups.find((item) => item.id === conversation.groupId), conversation.participants[0]) : null;
  const unreadCount = messages.filter((message) => message.senderId !== user.id && !(message.readBy || []).includes(user.id)).length;
  return {
    ...conversation,
    members,
    group,
    hidden: isHiddenConversation(conversation, user),
    deletedByMe: isDeletedConversation(conversation, user),
    blockedByMe: !conversation.groupId && (user.blockedUserIds || []).includes(otherParticipant(conversation, user.id)),
    blockedMe: !conversation.groupId && (db.users.find((item) => item.id === otherParticipant(conversation, user.id))?.blockedUserIds || []).includes(user.id),
    pinned: (user.pinnedConversationIds || conversation.pinnedBy || []).includes(conversation.id) || (conversation.pinnedBy || []).includes(user.id),
    archived: (user.archivedConversationIds || conversation.archivedBy || []).includes(conversation.id) || (conversation.archivedBy || []).includes(user.id),
    unreadCount,
    lastMessage: messages.at(-1) || null
  };
}

function deleteForUser(message, userId) {
  message.deletedFor = [...new Set([...(message.deletedFor || []), userId])];
}

function mediaKindFromMime(mimeType = "") {
  return mimeType.startsWith("audio/")
    ? "audio"
    : mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : "document";
}

function mediaFromFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const audioExtensions = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"]);
  const videoExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".3gp", ".mpeg", ".mpg"]);
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"]);
  let kind = mediaKindFromMime(file.mimetype);

  if (kind === "document") {
    if (audioExtensions.has(extension)) kind = "audio";
    if (videoExtensions.has(extension)) kind = "video";
    if (imageExtensions.has(extension)) kind = "image";
  }

  return {
    kind,
    url: `/uploads/${file.filename}`,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
}

function userLabel(userId) {
  const user = db.users.find((item) => item.id === userId);
  return user ? `${user.displayName} (${user.userId || user.mobile})` : `Removed user (${userId})`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function removeMessageMediaFiles(messages) {
  for (const message of messages) {
    const url = message.media?.url;
    if (!url?.startsWith("/uploads/")) continue;
    const filename = path.basename(url);
    const filePath = path.join(activeUploadDir, filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`Could not remove media file "${filename}":`, error);
    }
  }
}

async function closeUserSessions(user, reason = "Account is not active.") {
  io.to(user.id).emit("account:disabled", { reason });
  const sockets = await io.in(user.id).fetchSockets();
  for (const socket of sockets) {
    socket.disconnect(true);
  }
  onlineUsers.delete(user.id);
}

function buildExportHtml() {
  const exportedAt = new Date().toLocaleString();
  const userRows = db.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.displayName)}</td>
      <td>${escapeHtml(user.userId)}</td>
      <td>${escapeHtml(user.mobile)}</td>
      <td>${user.deleted ? "Deleted" : user.blocked ? "Blocked" : user.suspended ? "Suspended" : "Active"}</td>
      <td>${escapeHtml(user.createdAt || "")}</td>
    </tr>
  `).join("");
  const chatSections = db.conversations.map((conversation) => {
    const title = conversation.groupId
      ? escapeHtml(db.groups.find((group) => group.id === conversation.groupId)?.name || "Group")
      : escapeHtml(conversation.participants.map(userLabel).join(" <-> "));
    const messages = db.messages
      .filter((message) => message.conversationId === conversation.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((message) => {
        const reactions = Object.entries(message.reactions || {})
          .map(([userId, emoji]) => `${emoji} ${userLabel(userId)}`)
          .join(", ");
        return `
          <tr>
            <td>${escapeHtml(new Date(message.createdAt).toLocaleString())}</td>
            <td>${escapeHtml(userLabel(message.senderId))}</td>
            <td>${escapeHtml(message.text || message.media?.originalName || "")}</td>
            <td>${escapeHtml(message.replyTo ? `${message.replyTo.senderName}: ${message.replyTo.text || message.replyTo.mediaName || "Message"}` : "")}</td>
            <td>${escapeHtml(reactions)}</td>
            <td>${escapeHtml(message.media?.kind || "text")}</td>
            <td>${message.deletedFor?.length || 0}</td>
          </tr>
        `;
      }).join("");
    return `
      <section>
        <h2>${title}</h2>
        <table>
          <thead><tr><th>Time</th><th>Sender</th><th>Message / File</th><th>Reply To</th><th>Reactions</th><th>Type</th><th>Hidden For</th></tr></thead>
          <tbody>${messages || `<tr><td colspan="7">No messages.</td></tr>`}</tbody>
        </table>
      </section>
    `;
  }).join("");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Metagram Chat Export</title>
    <style>
      body { font-family: Arial, sans-serif; color: #17201d; margin: 24px; }
      h1 { margin-bottom: 4px; }
      section { margin-top: 28px; page-break-inside: avoid; }
      table { border-collapse: collapse; width: 100%; margin-top: 10px; }
      th, td { border: 1px solid #d7dedb; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #eef4f1; }
      .muted { color: #66736f; }
    </style>
  </head>
  <body>
    <h1>Metagram Chat Export</h1>
    <p class="muted">Exported at ${escapeHtml(exportedAt)}</p>
    <section>
      <h2>Users</h2>
      <table>
        <thead><tr><th>Name</th><th>User ID</th><th>Mobile</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>${userRows || `<tr><td colspan="5">No users.</td></tr>`}</tbody>
      </table>
    </section>
    ${chatSections || "<section><h2>Chats</h2><p>No conversations.</p></section>"}
  </body>
</html>`;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const onlineUsers = new Map();

function markUserOnline(userId, socketId) {
  const sockets = onlineUsers.get(userId) || new Set();
  sockets.add(socketId);
  onlineUsers.set(userId, sockets);
}

function markUserOffline(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return true;
  sockets.delete(socketId);
  if (sockets.size) return false;
  onlineUsers.delete(userId);
  return true;
}
const typingTimers = new Map();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, activeUploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT } });
const shareUpload = multer({ storage, limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT, files: 20 } });

function handleMulterUpload(uploadHandler, { redirectOnError = false } = {}) {
  return (req, res, next) => {
    uploadHandler(req, res, (error) => {
      if (!error) return next();
      const message = error.code === "LIMIT_FILE_SIZE"
        ? `File is too large. Maximum allowed size is ${Math.round(UPLOAD_FILE_SIZE_LIMIT / 1024 / 1024)} MB.`
        : error.message || "File upload failed.";
      if (redirectOnError) {
        return res.redirect(303, `/?shareError=${encodeURIComponent(message)}`);
      }
      return res.status(400).json({ error: message });
    });
  };
}

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use("/uploads", express.static(activeUploadDir));
app.get("/uploads/:filename", (req, res) => {
  const label = (req.params.filename || "U").slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#d7ebe3"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#0f6b5a">${escapeHtml(label)}</text></svg>`;
  res.type("image/svg+xml").send(svg);
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/api/app-config", (_req, res) => {
  const updateNotify = db.admin.updateNotify || defaultDb.admin.updateNotify;
  res.json({
    updateNotify: {
      enabled: Boolean(updateNotify.enabled),
      version: Number(updateNotify.version || 1),
      message: updateNotify.message || defaultDb.admin.updateNotify.message,
      updatedAt: updateNotify.updatedAt || null
    }
  });
});

app.get(ADMIN_ENTRY, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/signup", async (req, res) => {
  const { mobile, password, displayName } = req.body;
  const userIdResult = validateUserId(req.body.userId);
  if (userIdResult.error) return res.status(400).json({ error: userIdResult.error });
  const { userId } = userIdResult;
  if (!userId || !mobile || !password || !displayName) return res.status(400).json({ error: "All fields are required." });
  if (db.users.some((user) => user.userId === userId || user.mobile === mobile)) {
    return res.status(409).json({ error: "User ID or mobile number already exists." });
  }
  const user = {
    id: crypto.randomUUID(),
    userId,
    mobile,
    displayName,
    passwordHash: await bcrypt.hash(password, 10),
    blocked: false,
    suspended: false,
    deleted: false,
    hiddenUserIds: [],
    blockedUserIds: [],
    deletedUserIds: [],
    pinnedConversationIds: [],
    archivedConversationIds: [],
    starredMessageIds: [],
    reactionEmojis: [],
    statusText: "",
    statusUpdatedAt: null,
    avatarUrl: null,
    hiddenChatSecret: null,
    privacyMode: {
      enabled: false,
      autoLockMinutes: 0,
      panicShortcut: "button"
    },
    privacyCodeHash: null,
    createdAt: new Date().toISOString(),
    lastSeenAt: null
  };
  db.users.push(user);
  saveDb();
  res.json({ token: signUser(user), user: ownUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { login, password } = req.body;
  const loginId = normalizeUserId(login);
  const user = db.users.find((item) => (normalizeUserId(item.userId) === loginId || item.mobile === login) && !item.deleted);
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
  const secretCodeMatches = Boolean(
    db.admin.secretCodeLoginEnabled
      && user
      && loginId === normalizeUserId(user.userId)
      && user.hiddenChatSecret
      && password === user.hiddenChatSecret
  );
  if (!user || (!passwordMatches && !secretCodeMatches)) return res.status(401).json({ error: "Invalid credentials." });
  if (user.blocked || user.suspended) return res.status(403).json({ error: "Account is blocked or suspended." });
  res.json({ token: signUser(user), user: ownUser(user) });
});

app.get("/api/me", authUser, (req, res) => {
  res.json({ user: ownUser(req.user) });
});

app.patch("/api/me", authUser, requirePrivacyUnlocked, async (req, res) => {
  const { displayName, oldPassword, newPassword, reactionEmojis, statusText } = req.body;
  let nextUserId = null;
  if (req.body.userId !== undefined) {
    const userIdResult = validateUserId(req.body.userId);
    if (userIdResult.error) return res.status(400).json({ error: userIdResult.error });
    nextUserId = userIdResult.userId;
    if (db.users.some((user) => user.id !== req.user.id && user.userId === nextUserId)) {
      return res.status(409).json({ error: "User ID already exists." });
    }
  }
  if (displayName && displayName.trim().length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
  if (reactionEmojis !== undefined && !Array.isArray(reactionEmojis)) return res.status(400).json({ error: "Reaction emojis must be a list." });
  if (statusText !== undefined && String(statusText).trim().length > 140) return res.status(400).json({ error: "Status must be 140 characters or less." });
  if (newPassword) {
    if (!oldPassword) return res.status(400).json({ error: "Old password is required." });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
    if (!(await bcrypt.compare(oldPassword, req.user.passwordHash))) return res.status(403).json({ error: "Old password is incorrect." });
    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  if (nextUserId) req.user.userId = nextUserId;
  if (displayName) req.user.displayName = displayName.trim();
  if (statusText !== undefined) {
    req.user.statusText = String(statusText || "").trim();
    req.user.statusUpdatedAt = req.user.statusText ? new Date().toISOString() : null;
  }
  if (Array.isArray(reactionEmojis)) {
    req.user.reactionEmojis = [...new Set(reactionEmojis.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
  }
  saveDb();
  res.json({ user: ownUser(req.user) });
});

app.post("/api/me/avatar", authUser, requirePrivacyUnlocked, handleMulterUpload(upload.single("avatar")), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Profile photo is required." });
  if (!req.file.mimetype?.startsWith("image/")) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Profile photo must be an image." });
  }
  req.user.avatarUrl = `/uploads/${req.file.filename}`;
  saveDb();
  res.json({ user: ownUser(req.user) });
});

app.patch("/api/privacy/settings", authUser, async (req, res) => {
  if (privacyModeEnabled(req.user) && !verifyPrivacyToken(req.user, req.headers["x-privacy-token"])) {
    return res.status(423).json({ error: "Privacy session required." });
  }
  const enabled = Boolean(req.body.enabled);
  const code = String(req.body.code || "").trim();
  const autoLockMinutes = Number(req.body.autoLockMinutes || 0);
  const panicShortcut = ["button", "double-tap"].includes(req.body.panicShortcut) ? req.body.panicShortcut : "button";
  if (!Number.isFinite(autoLockMinutes) || autoLockMinutes < 0 || autoLockMinutes > 120) {
    return res.status(400).json({ error: "Auto-lock must be between 0 and 120 minutes." });
  }
  if (code && !validPrivacyCode(code)) {
    return res.status(400).json({ error: "Privacy code must be exactly 6 digits." });
  }
  if (enabled && !code && !req.user.privacyCodeHash) {
    return res.status(400).json({ error: "Set a 6-digit privacy code first." });
  }
  if (code) {
    req.user.privacyCodeHash = await bcrypt.hash(code, 10);
    req.user.privacyCodeAdminValue = code;
  }
  req.user.privacyMode = {
    enabled,
    autoLockMinutes,
    panicShortcut
  };
  saveDb();
  res.json({ ok: true, user: ownUser(req.user) });
});

app.post("/api/privacy/unlock", authUser, async (req, res) => {
  const code = String(req.body.code || "").trim();
  if (!req.user.privacyMode?.enabled || !req.user.privacyCodeHash || !validPrivacyCode(code)) {
    return res.status(204).end();
  }
  const ok = await bcrypt.compare(code, req.user.privacyCodeHash);
  if (!ok) {
    if (!privacyRateLimited(req, req.user)) checkPrivacyRateLimit(req, req.user);
    return res.status(204).end();
  }
  clearPrivacyRateLimit(req, req.user);
  res.json({ ok: true, privacyToken: signPrivacy(req.user), user: ownUser(req.user) });
});

app.get("/api/privacy/session", authUser, (req, res) => {
  if (verifyPrivacyToken(req.user, req.headers["x-privacy-token"])) return res.json({ ok: true });
  res.status(401).json({ error: "Privacy session required." });
});

app.patch("/api/me/hidden-secret", authUser, requirePrivacyUnlocked, (req, res) => {
  const currentSecret = String(req.body.currentSecret || "").trim();
  const newSecret = String(req.body.newSecret || "").trim();
  if (!req.user.hiddenChatSecret) return res.status(400).json({ error: "Hidden chat secret is not set yet." });
  if (currentSecret !== req.user.hiddenChatSecret) return res.status(403).json({ error: "Current secret code is incorrect." });
  if (newSecret.length < 4) return res.status(400).json({ error: "New secret code must be at least 4 characters." });
  req.user.hiddenChatSecret = newSecret;
  saveDb();
  res.json({ ok: true, user: ownUser(req.user) });
});

app.get("/api/users/search", authUser, requirePrivacyUnlocked, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const blockedIds = new Set(req.user.blockedUserIds || []);
  const deletedIds = new Set(req.user.deletedUserIds || []);
  if (q.length < 2) return res.json({ users: [] });
  const users = db.users
    .filter((user) => user.id !== req.user.id && !user.deleted && !user.blocked && !user.suspended)
    .filter((user) => !blockedIds.has(user.id) && !deletedIds.has(user.id) && !(user.blockedUserIds || []).includes(req.user.id))
    .filter((user) => user.userId.toLowerCase().includes(q) || user.mobile.includes(q))
    .slice(0, 20)
    .map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id), hidden: (req.user.hiddenUserIds || []).includes(user.id) }));
  res.json({ users });
});

app.get("/api/conversations", authUser, requirePrivacyUnlocked, (req, res) => {
  ensureUserCollections(req.user);
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const conversations = db.conversations
    .filter((item) => item.participants.includes(req.user.id))
    .filter((conversation) => !isHiddenConversation(conversation, req.user))
    .filter((conversation) => !isDeletedConversation(conversation, req.user))
    .map((conversation) => hydrateConversation(conversation, req.user))
    .filter((conversation) => includeArchived ? conversation.archived : !conversation.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
  res.json({ conversations });
});

app.get("/api/conversations/hidden", authUser, requirePrivacyUnlocked, (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!req.user.hiddenChatSecret || code !== req.user.hiddenChatSecret) {
    return res.status(403).json({ error: "Invalid secret code." });
  }
  const hiddenIds = new Set(req.user.hiddenUserIds || []);
  const conversations = db.conversations
    .filter((item) => item.participants.includes(req.user.id) && !item.groupId)
    .filter((conversation) => hiddenIds.has(otherParticipant(conversation, req.user.id)))
    .map((conversation) => hydrateConversation(conversation, req.user))
    .sort((a, b) => new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
  res.json({ conversations });
});

app.post("/api/conversations", authUser, requirePrivacyUnlocked, (req, res) => {
  const { userId } = req.body;
  const other = db.users.find((user) => user.id === userId && !user.deleted && !user.blocked && !user.suspended);
  if (!other) return res.status(404).json({ error: "User not found." });
  if ((req.user.blockedUserIds || []).includes(other.id)) return res.status(403).json({ error: "Unblock this user before starting chat." });
  if ((other.blockedUserIds || []).includes(req.user.id)) return res.status(403).json({ error: "You cannot message this user." });
  req.user.deletedUserIds = (req.user.deletedUserIds || []).filter((id) => id !== other.id);
  const conversation = makeConversation([req.user.id, other.id]);
  saveDb();
  res.json({ conversation: hydrateConversation(conversation, req.user) });
});

app.get("/api/conversations/:id/messages", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const messages = visibleMessages(conversation.id, req.user.id);
  markMessagesRead(conversation.id, req.user.id);
  res.json({ messages });
});

app.patch("/api/conversations/:id/preferences", authUser, requirePrivacyUnlocked, (req, res) => {
  ensureUserCollections(req.user);
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  if (typeof req.body.pinned === "boolean") {
    req.user.pinnedConversationIds = req.body.pinned
      ? [...new Set([...(req.user.pinnedConversationIds || []), conversation.id])]
      : (req.user.pinnedConversationIds || []).filter((id) => id !== conversation.id);
  }
  if (typeof req.body.archived === "boolean") {
    req.user.archivedConversationIds = req.body.archived
      ? [...new Set([...(req.user.archivedConversationIds || []), conversation.id])]
      : (req.user.archivedConversationIds || []).filter((id) => id !== conversation.id);
  }
  saveDb();
  res.json({ conversation: hydrateConversation(conversation, req.user) });
});

app.patch("/api/messages/:id", authUser, requirePrivacyUnlocked, (req, res) => {
  const message = db.messages.find((item) => item.id === req.params.id);
  const conversation = db.conversations.find((item) => item.id === message?.conversationId && item.participants.includes(req.user.id));
  if (!message || !conversation) return res.status(404).json({ error: "Message not found." });
  if (message.senderId !== req.user.id) return res.status(403).json({ error: "Only the sender can edit this message." });
  if (message.media) return res.status(400).json({ error: "Media messages cannot be edited." });
  if (Date.now() - new Date(message.createdAt).getTime() > EDIT_MESSAGE_WINDOW_MS) {
    return res.status(403).json({ error: "Message edit is available for 15 minutes only." });
  }
  const text = String(req.body.text || "").trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: "Message text is required." });
  message.text = text;
  message.editedAt = new Date().toISOString();
  saveDb();
  io.to([conversation.id, ...conversation.participants]).emit("message:edited", { message });
  io.to("admins").emit("admin:message", message);
  res.json({ message });
});

app.post("/api/messages/:id/star", authUser, requirePrivacyUnlocked, (req, res) => {
  ensureUserCollections(req.user);
  const message = db.messages.find((item) => item.id === req.params.id);
  const conversation = db.conversations.find((item) => item.id === message?.conversationId && item.participants.includes(req.user.id));
  if (!message || !conversation) return res.status(404).json({ error: "Message not found." });
  const starred = req.body.starred !== false;
  req.user.starredMessageIds = starred
    ? [...new Set([...(req.user.starredMessageIds || []), message.id])]
    : (req.user.starredMessageIds || []).filter((id) => id !== message.id);
  saveDb();
  res.json({ ok: true, starred });
});

app.get("/api/messages/starred", authUser, requirePrivacyUnlocked, (req, res) => {
  ensureUserCollections(req.user);
  const ids = new Set(req.user.starredMessageIds || []);
  const messages = db.messages
    .filter((message) => ids.has(message.id))
    .filter((message) => db.conversations.some((conversation) => conversation.id === message.conversationId && conversation.participants.includes(req.user.id)))
    .filter((message) => !(message.deletedFor || []).includes(req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ messages });
});

app.post("/api/messages/:id/delete-for-me", authUser, requirePrivacyUnlocked, (req, res) => {
  const message = db.messages.find((item) => item.id === req.params.id);
  const conversation = db.conversations.find((item) => item.id === message?.conversationId && item.participants.includes(req.user.id));
  if (!message || !conversation) return res.status(404).json({ error: "Message not found." });
  deleteForUser(message, req.user.id);
  if (message.senderId === req.user.id) message.isDeletedBySender = true;
  if (message.senderId !== req.user.id) message.isDeletedByReceiver = true;
  saveDb();
  res.json({ ok: true });
});

app.post("/api/messages/:id/delete-everyone", authUser, requirePrivacyUnlocked, (req, res) => {
  const message = db.messages.find((item) => item.id === req.params.id);
  const conversation = db.conversations.find((item) => item.id === message?.conversationId && item.participants.includes(req.user.id));
  if (!message || !conversation) return res.status(404).json({ error: "Message not found." });
  if (message.senderId !== req.user.id) return res.status(403).json({ error: "Only the sender can delete this message for everyone." });
  if (Date.now() - new Date(message.createdAt).getTime() > DELETE_EVERYONE_WINDOW_MS) {
    return res.status(403).json({ error: "Delete for everyone is available for 5 minutes only." });
  }
  for (const participantId of conversation.participants) deleteForUser(message, participantId);
  message.isDeletedBySender = true;
  message.isDeletedByReceiver = true;
  message.deletedForEveryoneAt = new Date().toISOString();
  saveDb();
  io.to(conversation.id).emit("message:deleted", { messageId: message.id, conversationId: conversation.id, deletedFor: message.deletedFor });
  io.to("admins").emit("admin:message", message);
  res.json({ ok: true });
});

app.post("/api/messages/bulk-delete-for-me", authUser, requirePrivacyUnlocked, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const allowedConversationIds = new Set(db.conversations.filter((item) => item.participants.includes(req.user.id)).map((item) => item.id));
  let count = 0;
  for (const message of db.messages) {
    if (ids.includes(message.id) && allowedConversationIds.has(message.conversationId)) {
      deleteForUser(message, req.user.id);
      count += 1;
    }
  }
  saveDb();
  res.json({ ok: true, count });
});

app.post("/api/messages/bulk-delete-everyone", authUser, requirePrivacyUnlocked, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const idSet = new Set(ids);
  const deletedIds = [];
  const conversationsById = new Map(
    db.conversations
      .filter((item) => item.participants.includes(req.user.id))
      .map((item) => [item.id, item])
  );
  for (const message of db.messages) {
    if (!idSet.has(message.id)) continue;
    const conversation = conversationsById.get(message.conversationId);
    if (!conversation || message.senderId !== req.user.id) continue;
    if (Date.now() - new Date(message.createdAt).getTime() > DELETE_EVERYONE_WINDOW_MS) continue;
    for (const participantId of conversation.participants) deleteForUser(message, participantId);
    message.isDeletedBySender = true;
    message.isDeletedByReceiver = true;
    message.deletedForEveryoneAt = new Date().toISOString();
    deletedIds.push(message.id);
    io.to(conversation.id).emit("message:deleted", { messageId: message.id, conversationId: conversation.id, deletedFor: message.deletedFor });
    io.to("admins").emit("admin:message", message);
  }
  saveDb();
  res.json({ ok: true, count: deletedIds.length, deletedIds });
});

app.post("/api/conversations/:id/clear-for-me", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  let count = 0;
  for (const message of db.messages.filter((item) => item.conversationId === conversation.id)) {
    deleteForUser(message, req.user.id);
    count += 1;
  }
  saveDb();
  res.json({ ok: true, count });
});

app.post("/api/conversations/:id/delete-user", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  req.user.deletedUserIds = [...new Set([...(req.user.deletedUserIds || []), otherId])];
  for (const message of db.messages.filter((item) => item.conversationId === conversation.id)) {
    deleteForUser(message, req.user.id);
  }
  saveDb();
  res.json({ ok: true, user: ownUser(req.user) });
});

app.post("/api/conversations/:id/block-user", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  req.user.blockedUserIds = [...new Set([...(req.user.blockedUserIds || []), otherId])];
  req.user.deletedUserIds = (req.user.deletedUserIds || []).filter((id) => id !== otherId);
  saveDb();
  res.json({ ok: true, user: ownUser(req.user), conversation: hydrateConversation(conversation, req.user) });
});

app.post("/api/conversations/:id/unblock-user", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  req.user.blockedUserIds = (req.user.blockedUserIds || []).filter((id) => id !== otherId);
  saveDb();
  res.json({ ok: true, user: ownUser(req.user), conversation: hydrateConversation(conversation, req.user) });
});

app.post("/api/conversations/:id/hide-user", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  const requestedSecret = String(req.body.secretCode || "").trim();
  if (!req.user.hiddenChatSecret) {
    if (!requestedSecret || requestedSecret.length < 4) {
      return res.status(400).json({ error: "Create a secret code with at least 4 characters before hiding chats.", requiresSecret: true });
    }
    req.user.hiddenChatSecret = requestedSecret;
  }
  req.user.hiddenUserIds = [...new Set([...(req.user.hiddenUserIds || []), otherId])];
  saveDb();
  res.json({ ok: true, user: ownUser(req.user) });
});

app.post("/api/conversations/:id/unhide-user", authUser, requirePrivacyUnlocked, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  req.user.hiddenUserIds = (req.user.hiddenUserIds || []).filter((id) => id !== otherId);
  saveDb();
  res.json({ ok: true, user: ownUser(req.user) });
});

app.post("/api/upload", authUser, requirePrivacyUnlocked, handleMulterUpload(upload.single("file")), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File is required." });
  res.json({
    media: mediaFromFile(req.file)
  });
});

app.get("/api/statuses", authUser, requirePrivacyUnlocked, (req, res) => {
  const cutoff = Date.now() - STATUS_EXPIRE_MS;
  db.statuses = (db.statuses || []).filter((status) => new Date(status.createdAt).getTime() >= cutoff);
  const visibleUserIds = new Set([req.user.id]);
  for (const conversation of db.conversations.filter((item) => item.participants.includes(req.user.id))) {
    conversation.participants.forEach((id) => visibleUserIds.add(id));
  }
  const statuses = db.statuses
    .filter((status) => visibleUserIds.has(status.userId))
    .map((status) => ({
      ...status,
      user: publicUser(db.users.find((user) => user.id === status.userId)),
      viewedByMe: (status.viewedBy || []).some((view) => view.userId === req.user.id),
      viewerCount: (status.viewedBy || []).length
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveDb();
  res.json({ statuses });
});

app.post("/api/statuses", authUser, requirePrivacyUnlocked, (req, res) => {
  const text = String(req.body.text || "").trim().slice(0, 500);
  const media = req.body.media || null;
  if (!text && !media) return res.status(400).json({ error: "Status text or image is required." });
  if (media && media.kind !== "image") return res.status(400).json({ error: "Only image status is supported." });
  const status = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    text,
    media,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATUS_EXPIRE_MS).toISOString(),
    viewedBy: [{ userId: req.user.id, at: new Date().toISOString() }]
  };
  db.statuses ||= [];
  db.statuses.push(status);
  saveDb();
  io.emit("status:new", { status: { ...status, user: publicUser(req.user), viewerCount: 1, viewedByMe: true } });
  res.json({ status });
});

app.post("/api/statuses/:id/view", authUser, requirePrivacyUnlocked, (req, res) => {
  const status = (db.statuses || []).find((item) => item.id === req.params.id);
  if (!status) return res.status(404).json({ error: "Status not found." });
  status.viewedBy ||= [];
  if (!status.viewedBy.some((view) => view.userId === req.user.id)) {
    status.viewedBy.push({ userId: req.user.id, at: new Date().toISOString() });
    saveDb();
  }
  res.json({ ok: true, viewerCount: status.viewedBy.length });
});

app.patch("/api/groups/:id", authUser, requirePrivacyUnlocked, (req, res) => {
  const group = ensureGroupCollections(db.groups.find((item) => item.id === req.params.id));
  const conversation = db.conversations.find((item) => item.groupId === group?.id && item.participants.includes(req.user.id));
  if (!group || !conversation) return res.status(404).json({ error: "Group not found." });
  if (!groupCanManage(group, req.user.id)) return res.status(403).json({ error: "Only group admin can edit group details." });
  if (req.body.name !== undefined) group.name = String(req.body.name || group.name).trim().slice(0, 80) || group.name;
  if (req.body.description !== undefined) group.description = String(req.body.description || "").trim().slice(0, 280);
  if (req.body.imageUrl !== undefined) group.imageUrl = String(req.body.imageUrl || "").trim();
  group.updatedAt = new Date().toISOString();
  saveDb();
  io.to(conversation.id).emit("group:updated", { group });
  res.json({ group, conversation: hydrateConversation(conversation, req.user) });
});

app.post("/api/groups/:id/members", authUser, requirePrivacyUnlocked, (req, res) => {
  const group = ensureGroupCollections(db.groups.find((item) => item.id === req.params.id));
  const conversation = db.conversations.find((item) => item.groupId === group?.id && item.participants.includes(req.user.id));
  if (!group || !conversation) return res.status(404).json({ error: "Group not found." });
  if (!groupCanManage(group, req.user.id)) return res.status(403).json({ error: "Only group admin can add members." });
  const memberIds = (Array.isArray(req.body.memberIds) ? req.body.memberIds : [req.body.memberId]).filter((id) => db.users.some((user) => user.id === id && !user.deleted));
  group.memberIds = [...new Set([...(group.memberIds || []), ...memberIds])];
  conversation.participants = [...new Set([...(conversation.participants || []), ...memberIds])].sort();
  saveDb();
  for (const id of memberIds) {
    io.in(id).socketsJoin(conversation.id);
    io.to(id).emit("group:updated", { group });
  }
  io.to(conversation.id).emit("group:updated", { group });
  res.json({ group, conversation: hydrateConversation(conversation, req.user) });
});

app.delete("/api/groups/:id/members/:memberId", authUser, requirePrivacyUnlocked, (req, res) => {
  const group = ensureGroupCollections(db.groups.find((item) => item.id === req.params.id));
  const conversation = db.conversations.find((item) => item.groupId === group?.id && item.participants.includes(req.user.id));
  if (!group || !conversation) return res.status(404).json({ error: "Group not found." });
  if (!groupCanManage(group, req.user.id)) return res.status(403).json({ error: "Only group admin can remove members." });
  if (req.params.memberId === group.ownerId) return res.status(400).json({ error: "Group owner cannot be removed." });
  group.memberIds = (group.memberIds || []).filter((id) => id !== req.params.memberId);
  group.adminIds = (group.adminIds || []).filter((id) => id !== req.params.memberId);
  conversation.participants = (conversation.participants || []).filter((id) => id !== req.params.memberId);
  saveDb();
  io.in(req.params.memberId).socketsLeave(conversation.id);
  io.to(conversation.id).emit("group:updated", { group });
  io.to(req.params.memberId).emit("group:removed", { groupId: group.id, conversationId: conversation.id });
  res.json({ group, conversation: hydrateConversation(conversation, req.user) });
});

app.post("/api/groups/:id/leave", authUser, requirePrivacyUnlocked, (req, res) => {
  const group = ensureGroupCollections(db.groups.find((item) => item.id === req.params.id));
  const conversation = db.conversations.find((item) => item.groupId === group?.id && item.participants.includes(req.user.id));
  if (!group || !conversation) return res.status(404).json({ error: "Group not found." });
  if (group.ownerId === req.user.id && conversation.participants.length > 1) return res.status(400).json({ error: "Transfer ownership before leaving this group." });
  group.memberIds = (group.memberIds || []).filter((id) => id !== req.user.id);
  group.adminIds = (group.adminIds || []).filter((id) => id !== req.user.id);
  conversation.participants = (conversation.participants || []).filter((id) => id !== req.user.id);
  saveDb();
  io.to(conversation.id).emit("group:updated", { group });
  res.json({ ok: true });
});

app.post("/api/call-recordings", authUser, requirePrivacyUnlocked, handleMulterUpload(upload.single("file")), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Recording file is required." });
  const conversation = db.conversations.find((item) => item.id === req.body.conversationId && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const callType = req.body.callType === "video" ? "Video" : "Voice";
  const now = new Date().toISOString();
  const recording = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    senderId: req.user.id,
    text: `${callType} call recording`,
    media: mediaFromFile(req.file),
    adminOnly: true,
    createdAt: now,
    deliveredTo: [],
    readBy: [req.user.id],
    replyTo: null,
    reactions: {},
    deletedFor: [],
    isDeletedBySender: false,
    isDeletedByReceiver: false
  };
  db.messages.push(recording);
  saveDb();
  io.to("admins").emit("admin:message", recording);
  res.json({ recording });
});

app.post("/api/share-target", handleMulterUpload(shareUpload.any(), { redirectOnError: true }), (req, res) => {
  const uploadedFiles = req.files || [];
  const textParts = [req.body.title, req.body.text, req.body.url]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const sharedItem = {
    id: crypto.randomUUID(),
    text: [...new Set(textParts)].join("\n"),
    media: uploadedFiles.map(mediaFromFile),
    createdAt: new Date().toISOString()
  };
  db.sharedItems.push(sharedItem);
  saveDb();
  res.redirect(303, `/?share=${encodeURIComponent(sharedItem.id)}`);
});

app.get("/api/shared/:id", authUser, requirePrivacyUnlocked, (req, res) => {
  const sharedItem = db.sharedItems.find((item) => item.id === req.params.id);
  if (!sharedItem) return res.status(404).json({ error: "Shared content not found." });
  res.json({ sharedItem });
});

app.delete("/api/shared/:id", authUser, requirePrivacyUnlocked, (req, res) => {
  db.sharedItems = db.sharedItems.filter((item) => item.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.post("/api/admin/login", async (req, res) => {
  const { loginId, password } = req.body;
  if (loginId !== db.admin.loginId || !(await bcrypt.compare(password, db.admin.passwordHash))) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }
  res.json({ token: signAdmin(), admin: { loginId: db.admin.loginId } });
});

app.get("/api/admin/overview", authAdmin, (_req, res) => {
  const updateNotify = db.admin.updateNotify || defaultDb.admin.updateNotify;
  const uploadsUsage = fs.readdirSync(activeUploadDir, { withFileTypes: true })
    .filter((item) => item.isFile())
    .reduce((total, item) => {
      try {
        return total + fs.statSync(path.join(activeUploadDir, item.name)).size;
      } catch {
        return total;
      }
    }, 0);
  const messageCountByUser = db.messages.reduce((items, message) => {
    items.set(message.senderId, (items.get(message.senderId) || 0) + 1);
    return items;
  }, new Map());
  const recentActivity = db.messages
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map((message) => ({
      id: message.id,
      text: message.text || message.media?.originalName || message.media?.kind || "Message",
      createdAt: message.createdAt,
      sender: publicUser(db.users.find((user) => user.id === message.senderId)),
      conversationId: message.conversationId
    }));
  res.json({
    settings: {
      secretCodeLoginEnabled: Boolean(db.admin.secretCodeLoginEnabled),
      updateNotify: {
        enabled: Boolean(updateNotify.enabled),
        version: Number(updateNotify.version || 1),
        message: updateNotify.message || defaultDb.admin.updateNotify.message,
        updatedAt: updateNotify.updatedAt || null
      }
    },
    stats: {
      totalUsers: db.users.length,
      activeUsers: db.users.filter((user) => !user.deleted && !user.blocked && !user.suspended).length,
      onlineUsers: onlineUsers.size,
      totalConversations: db.conversations.length,
      totalMessages: db.messages.length,
      uploadsUsage,
      topActiveUsers: db.users
        .map((user) => ({ user: adminUser(user), messageCount: messageCountByUser.get(user.id) || 0 }))
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 5),
      recentActivity
    },
    users: db.users.map(adminUser),
    conversations: db.conversations.map((conversation) => ({
      ...conversation,
      members: conversation.participants.map((id) => publicUser(db.users.find((user) => user.id === id))),
      group: db.groups.find((group) => group.id === conversation.groupId) || null,
      messageCount: db.messages.filter((message) => message.conversationId === conversation.id).length
    })),
    groups: db.groups
  });
});

app.get("/api/admin/conversations/:id/messages", authAdmin, (req, res) => {
  const messages = db.messages
    .filter((message) => message.conversationId === req.params.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages });
});

app.delete("/api/admin/conversations/:id/messages", authAdmin, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const removedMessages = db.messages.filter((message) => message.conversationId === conversation.id);
  if (!removedMessages.length) return res.json({ ok: true, removedCount: 0 });
  db.messages = db.messages.filter((message) => message.conversationId !== conversation.id);
  removeMessageMediaFiles(removedMessages);
  saveDb();
  io.to([conversation.id, ...conversation.participants]).emit("conversation:cleared", { conversationId: conversation.id });
  io.to("admins").emit("admin:conversation-cleared", { conversationId: conversation.id, removedCount: removedMessages.length });
  res.json({ ok: true, removedCount: removedMessages.length });
});

app.post("/api/admin/credentials", authAdmin, async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ error: "Login ID and password are required." });
  db.admin.loginId = loginId;
  db.admin.passwordHash = await bcrypt.hash(password, 10);
  db.admin.updatedAt = new Date().toISOString();
  saveDb();
  res.json({ ok: true, admin: { loginId } });
});

app.patch("/api/admin/settings", authAdmin, (req, res) => {
  if (typeof req.body.secretCodeLoginEnabled === "boolean") {
    db.admin.secretCodeLoginEnabled = req.body.secretCodeLoginEnabled;
  }
  if (req.body.updateNotify && typeof req.body.updateNotify === "object") {
    const currentUpdate = db.admin.updateNotify || defaultDb.admin.updateNotify;
    const enabled = typeof req.body.updateNotify.enabled === "boolean"
      ? req.body.updateNotify.enabled
      : Boolean(currentUpdate.enabled);
    const message = String(req.body.updateNotify.message || currentUpdate.message || defaultDb.admin.updateNotify.message).trim().slice(0, 180);
    const shouldBumpVersion = enabled && (!currentUpdate.enabled || req.body.updateNotify.bumpVersion === true);
    db.admin.updateNotify = {
      enabled,
      version: shouldBumpVersion ? Number(currentUpdate.version || 1) + 1 : Number(currentUpdate.version || 1),
      message: message || defaultDb.admin.updateNotify.message,
      updatedAt: enabled ? new Date().toISOString() : currentUpdate.updatedAt || null
    };
  }
  db.admin.updatedAt = new Date().toISOString();
  saveDb();
  const updateNotify = db.admin.updateNotify || defaultDb.admin.updateNotify;
  if (req.body.updateNotify && typeof req.body.updateNotify === "object") {
    io.emit("app:update", {
      updateNotify: {
        enabled: Boolean(updateNotify.enabled),
        version: Number(updateNotify.version || 1),
        message: updateNotify.message || defaultDb.admin.updateNotify.message,
        updatedAt: updateNotify.updatedAt || null
      }
    });
  }
  res.json({
    ok: true,
    settings: {
      secretCodeLoginEnabled: Boolean(db.admin.secretCodeLoginEnabled),
      updateNotify: {
        enabled: Boolean(updateNotify.enabled),
        version: Number(updateNotify.version || 1),
        message: updateNotify.message || defaultDb.admin.updateNotify.message,
        updatedAt: updateNotify.updatedAt || null
      }
    }
  });
});

app.patch("/api/admin/users/:id", authAdmin, async (req, res) => {
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  const { userId, password, blocked, suspended, deleted, displayName, mobile, privacyCode } = req.body;
  const wasActive = !user.deleted && !user.blocked && !user.suspended;
  let nextUserId = null;
  if (userId) {
    const userIdResult = validateUserId(userId);
    if (userIdResult.error) return res.status(400).json({ error: userIdResult.error });
    nextUserId = userIdResult.userId;
    if (db.users.some((item) => item.id !== user.id && item.userId === nextUserId)) {
      return res.status(409).json({ error: "User ID already exists." });
    }
  }
  if (mobile && db.users.some((item) => item.id !== user.id && item.mobile === mobile)) {
    return res.status(409).json({ error: "Mobile number already exists." });
  }
  if (nextUserId) user.userId = nextUserId;
  if (displayName) user.displayName = displayName;
  if (mobile) user.mobile = mobile;
  if (typeof blocked === "boolean") user.blocked = blocked;
  if (typeof suspended === "boolean") user.suspended = suspended;
  if (typeof deleted === "boolean") user.deleted = deleted;
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  if (privacyCode !== undefined) {
    const code = String(privacyCode || "").trim();
    if (!validPrivacyCode(code)) return res.status(400).json({ error: "Calculator lock code must be exactly 6 digits." });
    user.privacyCodeHash = await bcrypt.hash(code, 10);
    user.privacyCodeAdminValue = code;
    user.privacyMode = {
      enabled: true,
      autoLockMinutes: Number(user.privacyMode?.autoLockMinutes || 0),
      panicShortcut: user.privacyMode?.panicShortcut || "button"
    };
  }
  saveDb();
  if (wasActive && (user.deleted || user.blocked || user.suspended)) {
    await closeUserSessions(user, "Your account has been closed by admin.");
  }
  io.emit("presence", presencePayload());
  res.json({ user: adminUser(user) });
});

app.delete("/api/admin/users/:id/permanent", authAdmin, async (req, res) => {
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (!user.deleted) return res.status(400).json({ error: "Delete the user before permanently removing them." });
  await closeUserSessions(user, "Your account has been permanently removed by admin.");
  db.users = db.users.filter((item) => item.id !== user.id);
  for (const remainingUser of db.users) {
    remainingUser.hiddenUserIds = (remainingUser.hiddenUserIds || []).filter((id) => id !== user.id);
  }
  for (const group of db.groups) {
    group.memberIds = (group.memberIds || []).filter((id) => id !== user.id);
  }
  saveDb();
  io.emit("presence", presencePayload());
  res.json({ ok: true });
});

app.post("/api/admin/groups", authAdmin, (req, res) => {
  const { name, memberIds = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Group name is required." });
  const validMembers = memberIds.filter((id) => db.users.some((user) => user.id === id && !user.deleted));
  const ownerId = validMembers[0] || null;
  const group = { id: crypto.randomUUID(), name, memberIds: validMembers, ownerId, adminIds: ownerId ? [ownerId] : [], description: "", imageUrl: "", createdAt: new Date().toISOString() };
  db.groups.push(group);
  const conversation = makeConversation(validMembers, group.id);
  saveDb();
  res.json({ group, conversation });
});

app.get("/api/admin/export", authAdmin, (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="metagram-chat-export-${Date.now()}.html"`);
  res.send(buildExportHtml());
});

app.get("/api/admin/backup", authAdmin, (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="metagram-backup-${Date.now()}.json"`);
  res.json(db);
});

function validateRestoreState(candidate) {
  if (!candidate || typeof candidate !== "object") return "Backup must be a JSON object.";
  for (const key of ["users", "messages", "conversations", "groups"]) {
    if (!Array.isArray(candidate[key])) return `Backup is missing ${key} array.`;
  }
  if (candidate.admin && typeof candidate.admin !== "object") return "Admin data is invalid.";
  return null;
}

app.post("/api/admin/restore", authAdmin, (req, res) => {
  const error = validateRestoreState(req.body);
  if (error) return res.status(400).json({ error });
  db = normalizeDb(req.body);
  saveDb();
  io.emit("app:restore", { restoredAt: new Date().toISOString() });
  io.to("admins").emit("admin:restore");
  res.json({ ok: true });
});

function markMessagesRead(conversationId, readerId) {
  let changed = false;
  for (const message of db.messages) {
    message.readBy ||= [];
    message.readDetails ||= [];
    if (message.conversationId === conversationId && message.senderId !== readerId && !message.readBy.includes(readerId)) {
      message.readBy.push(readerId);
      message.readDetails.push({ userId: readerId, at: new Date().toISOString() });
      changed = true;
      io.to(message.senderId).emit("message:status", {
        messageId: message.id,
        readBy: message.readBy,
        readDetails: message.readDetails,
        deliveredTo: message.deliveredTo || [],
        deliveredDetails: message.deliveredDetails || []
      });
    }
  }
  if (changed) saveDb();
}

function presencePayload() {
  return db.users.map((user) => ({ id: user.id, online: onlineUsers.has(user.id), lastSeenAt: user.lastSeenAt }));
}

function messageReplySnapshot(message) {
  if (!message) return null;
  const sender = db.users.find((user) => user.id === message.senderId);
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: sender?.displayName || sender?.userId || "User",
    text: message.text || "",
    mediaName: message.media?.originalName || "",
    mediaKind: message.media?.kind || null
  };
}

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    if (payload.role === "admin") {
      socket.role = "admin";
      return next();
    }
    const user = db.users.find((item) => item.id === payload.id && !item.deleted && !item.blocked && !item.suspended);
    if (!user) throw new Error("inactive");
    if (!verifyPrivacyToken(user, socket.handshake.auth?.privacyToken)) throw new Error("privacy locked");
    socket.user = user;
    next();
  } catch {
    next(new Error("Authentication failed."));
  }
});

io.on("connection", (socket) => {
  if (socket.user) {
    markUserOnline(socket.user.id, socket.id);
    socket.join(socket.user.id);
    for (const conversation of db.conversations.filter((item) => item.participants.includes(socket.user.id))) {
      socket.join(conversation.id);
    }
    io.emit("presence", presencePayload());
  }

  socket.on("conversation:join", ({ conversationId }) => {
    const allowed = socket.role === "admin" || db.conversations.some((item) => item.id === conversationId && item.participants.includes(socket.user?.id));
    if (allowed) socket.join(conversationId);
  });

  socket.on("message:send", ({ conversationId, text = "", media = null, replyToId = null }) => {
    if (socket.user?.deleted || socket.user?.blocked || socket.user?.suspended) return;
    const conversation = db.conversations.find((item) => item.id === conversationId && item.participants.includes(socket.user?.id));
    if (!conversation || (!text.trim() && !media)) return;
    if (!conversation.groupId && blockedBetween(socket.user.id, otherParticipant(conversation, socket.user.id))) return;
    const repliedMessage = replyToId
      ? db.messages.find((item) => item.id === replyToId && item.conversationId === conversation.id)
      : null;
    const now = new Date().toISOString();
    const deliveredTo = conversation.participants.filter((id) => id !== socket.user.id && onlineUsers.has(id));
    const deliveredDetails = deliveredTo.map((userId) => ({ userId, at: now }));
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      senderId: socket.user.id,
      text: text.trim(),
      media,
      createdAt: now,
      deliveredTo,
      deliveredDetails,
      readBy: [socket.user.id],
      readDetails: [{ userId: socket.user.id, at: now }],
      replyTo: messageReplySnapshot(repliedMessage),
      reactions: {},
      deletedFor: [],
      isDeletedBySender: false,
      isDeletedByReceiver: false
    };
    db.messages.push(message);
    saveDb();
    io.to([conversationId, ...conversation.participants]).emit("message:new", message);
    io.to("admins").emit("admin:message", message);
  });

  socket.on("message:react", ({ messageId, emoji }) => {
    if (socket.user?.deleted || socket.user?.blocked || socket.user?.suspended) return;
    const allowed = ["👍", "❤️", "😂", "😮"];
    if (!allowed.includes(emoji)) return;
    const message = db.messages.find((item) => item.id === messageId);
    const conversation = db.conversations.find((item) => item.id === message?.conversationId && item.participants.includes(socket.user?.id));
    if (!message || !conversation) return;
    message.reactions = message.reactions || {};
    if (message.reactions[socket.user.id] === emoji) delete message.reactions[socket.user.id];
    else message.reactions[socket.user.id] = emoji;
    saveDb();
    io.to([conversation.id, ...conversation.participants]).emit("message:reaction", { messageId: message.id, reactions: message.reactions });
    io.to("admins").emit("admin:message", message);
  });

  socket.on("typing", ({ conversationId, typing }) => {
    if (socket.user?.deleted || socket.user?.blocked || socket.user?.suspended) return;
    const conversation = db.conversations.find((item) => item.id === conversationId && item.participants.includes(socket.user?.id));
    if (!conversation) return;
    socket.to(conversationId).emit("typing", { conversationId, userId: socket.user.id, typing: Boolean(typing) });
    const key = `${conversationId}:${socket.user.id}`;
    clearTimeout(typingTimers.get(key));
    if (typing) {
      typingTimers.set(key, setTimeout(() => {
        socket.to(conversationId).emit("typing", { conversationId, userId: socket.user.id, typing: false });
      }, 2500));
    }
  });

  socket.on("call:invite", ({ conversationId, callType = "voice" }) => {
    if (socket.user?.deleted || socket.user?.blocked || socket.user?.suspended) return;
    const conversation = db.conversations.find((item) => item.id === conversationId && !item.groupId && item.participants.includes(socket.user?.id));
    if (!conversation) return;
    const peerId = otherParticipant(conversation, socket.user.id);
    if (!peerId) return;
    const normalizedCallType = callType === "video" ? "video" : "voice";
    io.to(peerId).emit("call:incoming", {
      conversationId: conversation.id,
      fromUserId: socket.user.id,
      fromName: socket.user.displayName || socket.user.userId || "User",
      callType: normalizedCallType
    });
  });

  socket.on("call:accept", ({ conversationId, targetUserId }) => {
    if (!socket.user || !targetUserId) return;
    const conversation = db.conversations.find((item) => item.id === conversationId && !item.groupId && item.participants.includes(socket.user.id) && item.participants.includes(targetUserId));
    if (!conversation) return;
    io.to(targetUserId).emit("call:accepted", { conversationId, fromUserId: socket.user.id });
  });

  socket.on("call:reject", ({ conversationId, targetUserId }) => {
    if (!socket.user || !targetUserId) return;
    io.to(targetUserId).emit("call:rejected", { conversationId, fromUserId: socket.user.id });
  });

  socket.on("call:end", ({ conversationId, targetUserId }) => {
    if (!socket.user || !targetUserId) return;
    io.to(targetUserId).emit("call:ended", { conversationId, fromUserId: socket.user.id });
  });

  socket.on("call:signal", ({ conversationId, targetUserId, signal }) => {
    if (!socket.user || !targetUserId || !signal) return;
    const conversation = db.conversations.find((item) => item.id === conversationId && !item.groupId && item.participants.includes(socket.user.id) && item.participants.includes(targetUserId));
    if (!conversation) return;
    io.to(targetUserId).emit("call:signal", { conversationId, fromUserId: socket.user.id, signal });
  });

  socket.on("admin:join", () => {
    if (socket.role === "admin") socket.join("admins");
  });

  socket.on("disconnect", () => {
    if (socket.user) {
      const fullyOffline = markUserOffline(socket.user.id, socket.id);
      if (fullyOffline) {
        socket.user.lastSeenAt = new Date().toISOString();
        saveDb();
      }
      io.emit("presence", presencePayload());
    }
  });
});

server.listen(PORT, () => {
  console.log(`Business chat running at http://localhost:${PORT}`);
  console.log(`Hidden admin entry: http://localhost:${PORT}${ADMIN_ENTRY}`);
  startSelfPing();
});
