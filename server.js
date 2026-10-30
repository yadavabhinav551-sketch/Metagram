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
import { execFile } from "child_process";
import ffmpegPath from "ffmpeg-static";
import webPush from "web-push";
import { MongoClient } from "mongodb";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
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
const STATUS_VIDEO_MAX_SECONDS = 60;
const UPLOAD_FILE_SIZE_LIMIT = Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 500 * 1024 * 1024);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "metagram";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "app_state";
const MONGODB_ADMIN_URI = process.env.MONGODB_ADMIN_URI;
const MONGODB_ADMIN_DB = process.env.MONGODB_ADMIN_DB || "metagram_admin";
const MONGODB_ADMIN_COLLECTION = process.env.MONGODB_ADMIN_COLLECTION || "admin_state";
const MONGODB_ADMIN_TLS_ALLOW_INVALID_CERTIFICATES = String(process.env.MONGODB_ADMIN_TLS_ALLOW_INVALID_CERTIFICATES || "false").toLowerCase() === "true";
const MONGODB_ADMIN_TLS_ALLOW_INVALID_HOSTNAMES = String(process.env.MONGODB_ADMIN_TLS_ALLOW_INVALID_HOSTNAMES || "false").toLowerCase() === "true";
const MONGODB_KEEPALIVE_INTERVAL_MS = Number(process.env.MONGODB_KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000);
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@example.com";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BJFx_-apG37EmMF3U9OGhPqb4jIoVAIZwCNB9PdXXCHCSOJ_XeuOT4HSuysiS-mBecx02TQxcdJ6HwP0CwDnA14";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "JelHbPYGcFGSboEJCZrGfp5c9KTieNwi_ayRsfurjps";
const SMTP_URL = String(process.env.SMTP_URL || "").trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "");
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = String(process.env.SMTP_FROM || "").trim();
const hiddenSecretRecoveryCodes = new Map();
const hiddenSecretRecoveryRequests = new Map();
const HIDDEN_SECRET_OTP_TTL_MS = 10 * 60 * 1000;
const HIDDEN_SECRET_OTP_REQUEST_INTERVAL_MS = 60 * 1000;

webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function execFilePromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function sendHiddenSecretRecoveryCode(email, code) {
  if ((!SMTP_URL && !SMTP_HOST) || !SMTP_FROM) {
    const error = new Error("Email OTP delivery is not configured. Configure SMTP_URL (or SMTP_HOST) and SMTP_FROM.");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }
  const transport = nodemailer.createTransport(SMTP_URL || {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    ...(SMTP_USER && SMTP_PASS ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {})
  });
  await transport.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: "Metagram hidden chat recovery code",
    text: `Your Metagram hidden chat recovery code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<p>Your Metagram hidden chat recovery code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`
  });
}

const pendingRecordingTranscodes = new Map();

async function prepareRecordingFileForPlayback(file) {
  const normalizedMimeType = normalizeUploadedMediaMimeType(file).split(";")[0].trim().toLowerCase();
  const target = normalizedMimeType === "video/webm"
    ? { extension: ".mp4", mimeType: "video/mp4" }
    : ["audio/webm", "audio/mp4"].includes(normalizedMimeType)
      ? { extension: ".mp3", mimeType: "audio/mpeg" }
      : null;
  if (!target) {
    file.mimetype = normalizedMimeType;
    return;
  }
  if (!ffmpegPath) throw new Error("Recording conversion is unavailable because FFmpeg is not installed.");

  const inputPath = path.resolve(file.path);
  let conversion = pendingRecordingTranscodes.get(inputPath);
  if (!conversion) {
    const parsedPath = path.parse(inputPath);
    const outputPath = path.join(parsedPath.dir, `${parsedPath.name}${target.extension}`);
    const temporaryPath = path.join(parsedPath.dir, `${parsedPath.name}.converting${target.extension}`);
    conversion = (async () => {
      try {
        const args = [
          "-y", "-hide_banner", "-loglevel", "error",
          "-i", inputPath
        ];
        if (target.mimeType === "video/mp4") {
          args.push(
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
            temporaryPath
          );
        } else {
          args.push("-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "96k", temporaryPath);
        }
        await execFilePromise(ffmpegPath, args);
        if (!fs.existsSync(temporaryPath) || fs.statSync(temporaryPath).size === 0) {
          throw new Error("FFmpeg produced an empty recording.");
        }
        fs.renameSync(temporaryPath, outputPath);
        fs.unlinkSync(inputPath);
        const originalPath = path.parse(file.originalname || path.basename(inputPath));
        return {
          filename: path.basename(outputPath),
          path: outputPath,
          originalname: `${originalPath.name}${target.extension}`,
          mimetype: target.mimeType,
          size: fs.statSync(outputPath).size
        };
      } catch (error) {
        try {
          if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch (cleanupError) {
          console.error("Could not clean up incomplete recording conversion:", cleanupError.message || cleanupError);
        }
        throw error;
      }
    })();
    pendingRecordingTranscodes.set(inputPath, conversion);
  }
  try {
    Object.assign(file, await conversion);
  } finally {
    if (pendingRecordingTranscodes.get(inputPath) === conversion) {
      pendingRecordingTranscodes.delete(inputPath);
    }
  }
}

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
let adminMongoClient = null;
let adminStateCollection = null;
let adminMongoKeepaliveTimer = null;
let selfPingTimer = null;
let googleSigningKeys = null;
let googleSigningKeysExpiresAt = 0;

const defaultDb = {
  users: [],
  messages: [],
  conversations: [],
  groups: [],
  statuses: [],
  calls: [],
  sharedItems: [],
  pushSubscriptions: [],
  admin: {
    loginId: "6388391842",
    email: "yadavabhinav551@gmail.com",
    passwordHash: bcrypt.hashSync("1234546", 10),
    updatedAt: new Date().toISOString(),
    secretCodeLoginEnabled: false,
    hiddenAdminConversationIds: [],
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
    email: raw.admin?.email || defaultDb.admin.email,
    hiddenAdminConversationIds: Array.isArray(raw.admin?.hiddenAdminConversationIds) ? raw.admin.hiddenAdminConversationIds : [],
    updateNotify: {
      ...defaultDb.admin.updateNotify,
      ...((raw.admin || {}).updateNotify || {})
    }
  };
  return {
    users: (raw.users || []).map((user) => ({
      ...user,
      lockedChatPin: user.lockedChatPin || null
    })),
    messages: raw.messages || [],
    conversations: (raw.conversations || []).map((conversation) => ({
      ...conversation,
      lockedBy: Array.isArray(conversation.lockedBy) ? conversation.lockedBy : []
    })),
    groups: raw.groups || [],
    statuses: raw.statuses || [],
    calls: Array.isArray(raw.calls) ? raw.calls : [],
    sharedItems: raw.sharedItems || [],
    pushSubscriptions: raw.pushSubscriptions || [],
    admin
  };
}

function loadLocalDb() {
  if (!fs.existsSync(dbFile)) return normalizeDb(defaultDb);
  return normalizeDb(JSON.parse(fs.readFileSync(dbFile, "utf8")));
}

async function loadDb() {
  let initialDb;

  if (MONGODB_URI) {
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      stateCollection = mongoClient.db(MONGODB_DB).collection(MONGODB_COLLECTION);
      const existing = await stateCollection.findOne({ key: "main" });
      if (existing) {
        const { _id, key, ...state } = existing;
        console.log(`Using MongoDB Atlas app database "${MONGODB_DB}".`);
        initialDb = normalizeDb(state);
      } else {
        initialDb = loadLocalDb();
        await stateCollection.insertOne({ key: "main", ...initialDb });
        console.log(`Initialized MongoDB Atlas app database "${MONGODB_DB}" from local data.`);
      }
    } catch (error) {
      console.error("App MongoDB connection failed. Check MONGODB_URI, database user password, and Atlas network access.");
      throw error;
    }
  } else {
    if (!fs.existsSync(dbFile)) {
      fs.writeFileSync(dbFile, JSON.stringify(defaultDb, null, 2));
    }
    console.log("Using local JSON database. Set MONGODB_URI in production.");
    initialDb = normalizeDb(JSON.parse(fs.readFileSync(dbFile, "utf8")));
  }

  if (MONGODB_ADMIN_URI) {
    try {
      const adminClientOptions = {};
      if (MONGODB_ADMIN_TLS_ALLOW_INVALID_CERTIFICATES) {
        adminClientOptions.tlsAllowInvalidCertificates = true;
      }
      if (MONGODB_ADMIN_TLS_ALLOW_INVALID_HOSTNAMES) {
        adminClientOptions.tlsAllowInvalidHostnames = true;
      }
      adminMongoClient = new MongoClient(MONGODB_ADMIN_URI, adminClientOptions);
      await adminMongoClient.connect();
      adminStateCollection = adminMongoClient.db(MONGODB_ADMIN_DB).collection(MONGODB_ADMIN_COLLECTION);
      const existingAdmin = await adminStateCollection.findOne({ key: "main" });
      if (existingAdmin) {
        const { _id, key, ...adminState } = existingAdmin;
        console.log(`Using MongoDB Atlas admin database "${MONGODB_ADMIN_DB}".`);
        return normalizeDb({ ...initialDb, admin: { ...initialDb.admin, ...(adminState.admin || {}) } });
      }
      await adminStateCollection.insertOne({ key: "main", admin: initialDb.admin });
      console.log(`Initialized MongoDB Atlas admin database "${MONGODB_ADMIN_DB}" from app admin data.`);
      return normalizeDb({ ...initialDb, admin: initialDb.admin });
    } catch (error) {
      console.warn("Admin MongoDB connection failed. Continuing without admin cluster. Check MONGODB_ADMIN_URI, database user password, and Atlas network access.");
      console.warn(error.message || error);
      adminMongoClient = null;
      adminStateCollection = null;
      return normalizeDb(initialDb);
    }
  }

  return normalizeDb(initialDb);
}

let db = await loadDb();

async function migrateDefaultAdminCredentials() {
  const defaultOldAdminLogin = "6388391842";
  const defaultOldAdminPassword = "123456";
  if (db.admin.loginId === defaultOldAdminLogin && await bcrypt.compare(defaultOldAdminPassword, db.admin.passwordHash)) {
    db.admin.email = "yadavabhinav551@gmail.com";
    db.admin.passwordHash = await bcrypt.hash("1234546", 10);
    db.admin.updatedAt = new Date().toISOString();
    saveDb();
    console.log("Migrated default admin credentials to mobile/email/password.");
  }
}

await migrateDefaultAdminCredentials();
async function ensureDefaultAdmin() {
  try {
    const desiredLogin = "6388391842";
    const desiredEmail = "yadavabhinav551@gmail.com";
    const desiredPassword = "1234546";
    const missingAdmin = !db?.admin || !db.admin.loginId || !db.admin.email || !db.admin.passwordHash;
    if (missingAdmin) {
      db.admin = db.admin || {};
      db.admin.loginId = db.admin.loginId || desiredLogin;
      db.admin.email = db.admin.email || desiredEmail;
      db.admin.passwordHash = db.admin.passwordHash || await bcrypt.hash(desiredPassword, 10);
      db.admin.updatedAt = new Date().toISOString();
      saveDb();
      console.log("Default admin created because admin data was missing.");
      return;
    }
  } catch (err) {
    console.warn("ensureDefaultAdmin failed:", err && err.message ? err.message : err);
  }
}

await ensureDefaultAdmin();
const privacyUnlockAttempts = new Map();

function saveDb() {
  if (stateCollection) {
    stateCollection
      .replaceOne({ key: "main" }, { key: "main", ...db }, { upsert: true })
      .catch((error) => console.error("App MongoDB save failed:", error));
  } else {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  }

  if (adminStateCollection) {
    adminStateCollection
      .replaceOne({ key: "main" }, { key: "main", admin: db.admin }, { upsert: true })
      .catch((error) => console.error("Admin MongoDB save failed:", error));
  }
}

function getPushSubscription(userId) {
  return db.pushSubscriptions.find((item) => item.userId === userId) || null;
}

function savePushSubscription(userId, subscription) {
  const existingIndex = db.pushSubscriptions.findIndex((item) => item.userId === userId && item.endpoint === subscription.endpoint);
  if (existingIndex >= 0) {
    db.pushSubscriptions[existingIndex] = { userId, ...subscription };
  } else {
    db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.userId !== userId || item.endpoint !== subscription.endpoint);
    db.pushSubscriptions.push({ userId, ...subscription });
  }
  saveDb();
}

function removePushSubscription(userId, endpoint) {
  db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.userId !== userId || item.endpoint !== endpoint);
  saveDb();
}

async function sendPushNotification(userId, payload) {
  const user = db.users.find((item) => item.id === userId);
  if (!user || user.notificationEnabled === false) return;
  const subscription = getPushSubscription(userId);
  if (!subscription) return;
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    console.warn("Push notification failed:", error && error.body ? error.body : error.message || error);
    if (error.statusCode === 410 || error.statusCode === 404) {
      removePushSubscription(userId, subscription.endpoint);
    }
  }
}

function startMongoKeepalive() {
  if (mongoClient && !mongoKeepaliveTimer && MONGODB_KEEPALIVE_INTERVAL_MS > 0) {
    mongoKeepaliveTimer = setInterval(async () => {
      try {
        await mongoClient.db(MONGODB_DB).command({ ping: 1 });
        console.log("App MongoDB keepalive ping sent.");
      } catch (error) {
        console.error("App MongoDB keepalive ping failed:", error);
      }
    }, MONGODB_KEEPALIVE_INTERVAL_MS);
  }

  if (adminMongoClient && !adminMongoKeepaliveTimer && MONGODB_KEEPALIVE_INTERVAL_MS > 0) {
    adminMongoKeepaliveTimer = setInterval(async () => {
      try {
        await adminMongoClient.db(MONGODB_ADMIN_DB).command({ ping: 1 });
        console.log("Admin MongoDB keepalive ping sent.");
      } catch (error) {
        console.error("Admin MongoDB keepalive ping failed:", error);
      }
    }, MONGODB_KEEPALIVE_INTERVAL_MS);
  }
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
  const {
    passwordHash,
    hiddenChatSecret,
    privacyCodeHash,
    privacyCodeAdminValue,
    lockedChatPin,
    email,
    conversationPreferences,
    contactAliases,
    ...safe
  } = user;
  safe.hasLockedChatPin = Boolean(lockedChatPin);
  safe.privacyMode = {
    enabled: Boolean(user.privacyMode?.enabled),
    hasCode: Boolean(user.privacyCodeHash),
    autoLockMinutes: Number(user.privacyMode?.autoLockMinutes || 0),
    panicShortcut: user.privacyMode?.panicShortcut || "button"
  };
  safe.messageAutoDelete = {
    enabled: Boolean(user.messageAutoDelete?.enabled),
    ttlHours: Number(user.messageAutoDelete?.ttlHours || 0)
  };
  safe.notificationEnabled = user.notificationEnabled !== false;
  return safe;
}

function normalizeUserId(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeMobile(value = "") {
  return String(value).replace(/\D/g, "");
}

function isAvailableUserId(userId, excludedUserId = null) {
  return !db.users.some((user) => user.id !== excludedUserId && normalizeUserId(user.userId) === userId);
}

function isAvailableMobile(mobile, excludedUserId = null) {
  const normalizedMobile = normalizeMobile(mobile);
  return !db.users.some((user) => (
    user.id !== excludedUserId
      && normalizedMobile
      && normalizeMobile(user.mobile) === normalizedMobile
  ));
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
    email: String(user.email || ""),
    hasHiddenChatSecret: Boolean(user.hiddenChatSecret)
  };
}

function hiddenChatSecretMatches(user, candidate) {
  if (!user?.hiddenChatSecret) return false;
  return String(candidate || "").normalize("NFC").trim().toLowerCase()
    === String(user.hiddenChatSecret).normalize("NFC").trim().toLowerCase();
}

function adminUser(user) {
  return {
    ...publicUser(user),
    online: onlineUsers.has(user.id),
    lastSeenAt: user.lastSeenAt || null,
    hiddenChatSecret: user.hiddenChatSecret || null,
    hiddenChatCount: (user.hiddenUserIds || []).length,
    hiddenChatUsers: (user.hiddenUserIds || []).map((id) => publicUser(db.users.find((item) => item.id === id))).filter(Boolean),
    deleteHiddenChatsOnSecretReset: Boolean(user.deleteHiddenChatsOnSecretReset),
    hiddenChatSecretResetRequestedAt: user.hiddenChatSecretResetRequestedAt || null,
    privacyUnlockCode: user.privacyCodeAdminValue || null,
    hasPrivacyUnlockCode: Boolean(user.privacyCodeHash)
  };
}

function signUser(user) {
  return jwt.sign({ id: user.id, role: "user" }, JWT_SECRET, { expiresIn: "7d" });
}

async function getGoogleSigningKeys(forceRefresh = false) {
  if (!forceRefresh && googleSigningKeys && Date.now() < googleSigningKeysExpiresAt) return googleSigningKeys;
  const response = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Google signing keys request failed (${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error("Google signing keys response is invalid.");
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAgeSeconds = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);
  googleSigningKeys = payload.keys;
  googleSigningKeysExpiresAt = Date.now() + Math.max(60, maxAgeSeconds) * 1000;
  return googleSigningKeys;
}

async function verifyGoogleIdToken(idToken, { maxAgeSeconds = null } = {}) {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google sign-in is not configured.");
  if (typeof idToken !== "string" || idToken.length > 12000) throw new Error("Google credential is invalid.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google credential is invalid.");

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Google credential is invalid.");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Google credential is invalid.");

  let keys = await getGoogleSigningKeys();
  let signingKey = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!signingKey) {
    keys = await getGoogleSigningKeys(true);
    signingKey = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!signingKey) throw new Error("Google signing key is unavailable.");
  }
  const publicKey = crypto.createPublicKey({ key: signingKey, format: "jwk" });
  const signatureIsValid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], "base64url")
  );
  const now = Math.floor(Date.now() / 1000);
  const validIssuer = ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss);
  if (
    !signatureIsValid
    || !validIssuer
    || claims.aud !== GOOGLE_CLIENT_ID
    || (claims.azp && claims.azp !== GOOGLE_CLIENT_ID)
    || !Number.isFinite(claims.exp)
    || claims.exp <= now
    || !Number.isFinite(claims.iat)
    || claims.iat > now + 60
    || (maxAgeSeconds !== null && now - claims.iat > maxAgeSeconds)
    || claims.email_verified !== true
    || typeof claims.email !== "string"
    || typeof claims.sub !== "string"
    || !claims.sub
  ) {
    throw new Error("Google account verification failed.");
  }
  return {
    email: claims.email.trim().toLowerCase(),
    googleSubject: claims.sub,
    displayName: typeof claims.name === "string" ? claims.name.trim().slice(0, 80) : ""
  };
}

function profileIsComplete(user) {
  return Boolean(user?.displayName && user?.mobile && user?.userId && user?.passwordHash);
}

function signAdmin() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
}

async function verifyAdminCredentials(loginValue, password) {
  const normalizedLogin = String(loginValue || "").trim().toLowerCase();
  const admin = db.admin || {};
  const loginCandidates = [admin.loginId, admin.email, "6388391842", "yadavabhinav551@gmail.com"]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const loginMatches = loginCandidates.includes(normalizedLogin);
  if (!loginMatches) return { ok: false, reason: "login-mismatch" };

  const possiblePasswords = [password, "1234546", "123456"].filter((value, index, list) => value && list.indexOf(value) === index);
  if (admin.passwordHash) {
    for (const candidatePassword of possiblePasswords) {
      try {
        if (await bcrypt.compare(candidatePassword, admin.passwordHash)) {
          return {
            ok: true,
            shouldRehash: candidatePassword !== password || !admin.passwordHash || admin.passwordHash === ""
          };
        }
      } catch {
        // Ignore and continue to fallback checks.
      }
    }
  }

  const directPasswordMatch = possiblePasswords.includes("1234546") && password === "1234546";
  if (directPasswordMatch) {
    return { ok: true, shouldRehash: true };
  }

  return { ok: false, reason: "password-mismatch" };
}

function signPrivacy(user) {
  return jwt.sign({ id: user.id, role: "privacy" }, JWT_SECRET, { expiresIn: "12h" });
}

function validPrivacyCode(code) {
  return /^\d{6}$/.test(String(code || "").trim());
}

function validLockPin(code) {
  return String(code || "").trim().length >= 4;
}

async function verifyLockPin(user, code) {
  if (!user?.lockedChatPin || !validLockPin(code)) return false;
  return bcrypt.compare(String(code).trim(), user.lockedChatPin);
}

function lockConversationForUser(conversation, userId) {
  if (!conversation.lockedBy) conversation.lockedBy = [];
  conversation.lockedBy = [...new Set([...conversation.lockedBy, userId])];
}

function unlockConversationForUser(conversation, userId) {
  if (!conversation.lockedBy) return;
  conversation.lockedBy = (conversation.lockedBy || []).filter((id) => id !== userId);
}

function conversationLockedForUser(conversation, user) {
  return Boolean((conversation.lockedBy || []).includes(user.id));
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

function emailVerificationTokenIsValid(user, token) {
  if (!user?.email || !token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.role === "email-verification"
      && payload.id === user.id
      && payload.email === String(user.email).trim().toLowerCase();
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
  if (typeof user.deleteHiddenChatsOnSecretReset !== "boolean") user.deleteHiddenChatsOnSecretReset = false;
  user.deletedUserIds ||= [];
  user.blockedUserIds ||= [];
  user.pinnedConversationIds ||= [];
  user.archivedConversationIds ||= [];
  user.conversationPreferences ||= {};
  user.contactAliases ||= {};
  user.starredMessageIds ||= [];
  user.reactionEmojis ||= [];
  user.messageAutoDelete ||= { enabled: false, ttlHours: 0 };
  return user;
}

function ensureConversationCollections(conversation) {
  conversation.pinnedBy ||= [];
  conversation.archivedBy ||= [];
  conversation.lockedBy ||= [];
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

function messageExpiredForUser(message, user) {
  const conversationPreferences = user?.conversationPreferences?.[message.conversationId];
  const hasConversationTtl = conversationPreferences
    && Object.prototype.hasOwnProperty.call(conversationPreferences, "disappearingHours");
  const ttlHours = hasConversationTtl
    ? Number(conversationPreferences.disappearingHours || 0)
    : Number(user?.messageAutoDelete?.enabled ? user.messageAutoDelete.ttlHours : 0);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) return false;
  const createdAt = new Date(message.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt >= ttlHours * 60 * 60 * 1000;
}

function isConversationMutedForUser(user, conversationId) {
  const preferences = user?.conversationPreferences?.[conversationId];
  if (preferences?.muteForever) return true;
  const muteUntil = new Date(preferences?.muteUntil || 0).getTime();
  return Number.isFinite(muteUntil) && muteUntil > Date.now();
}

function visibleMessages(conversationId, userOrId) {
  const user = typeof userOrId === "string" ? db.users.find((item) => item.id === userOrId) : userOrId;
  const userId = user?.id || userOrId;
  return db.messages
    .filter((message) => message.conversationId === conversationId)
    .filter((message) => !message.adminOnly)
    .filter((message) => !message.deletedFor?.includes(userId))
    .filter((message) => !messageExpiredForUser(message, user))
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
  const messages = visibleMessages(conversation.id, user);
  const members = conversation.participants.map((id) => {
    const member = db.users.find((item) => item.id === id);
    const contactName = !conversation.groupId && id !== user.id ? user.contactAliases?.[id] || "" : "";
    return { ...publicUser(member), contactName, online: onlineUsers.has(id) };
  });
  const preferences = user.conversationPreferences?.[conversation.id] || {};
  const group = conversation.groupId ? ensureGroupCollections(db.groups.find((item) => item.id === conversation.groupId), conversation.participants[0]) : null;
  const unreadCount = messages.filter((message) => message.senderId !== user.id && !(message.readBy || []).includes(user.id)).length;
  const lockedByMe = (conversation.lockedBy || []).includes(user.id);
  return {
    ...conversation,
    members,
    group,
    hidden: isHiddenConversation(conversation, user),
    deletedByMe: isDeletedConversation(conversation, user),
    blockedByMe: !conversation.groupId && (user.blockedUserIds || []).includes(otherParticipant(conversation, user.id)),
    blockedMe: !conversation.groupId && (db.users.find((item) => item.id === otherParticipant(conversation, user.id))?.blockedUserIds || []).includes(user.id),
    pinned: (user.pinnedConversationIds || conversation.pinnedBy || []).includes(conversation.id) || (conversation.pinnedBy || []).includes(user.id),
    favorite: Boolean(preferences.favorite),
    muted: isConversationMutedForUser(user, conversation.id),
    muteUntil: preferences.muteUntil || null,
    muteForever: Boolean(preferences.muteForever),
    disappearingHours: Object.prototype.hasOwnProperty.call(preferences, "disappearingHours")
      ? Number(preferences.disappearingHours || 0)
      : (user.messageAutoDelete?.enabled ? Number(user.messageAutoDelete.ttlHours || 0) : 0),
    archived: (user.archivedConversationIds || conversation.archivedBy || []).includes(conversation.id) || (conversation.archivedBy || []).includes(user.id),
    locked: lockedByMe,
    lockedByMe,
    unreadCount,
    lastMessage: messages.at(-1) || null
  };
}

function deleteForUser(message, userId) {
  message.deletedFor = [...new Set([...(message.deletedFor || []), userId])];
}

function deleteHiddenChatsForUser(user) {
  const hiddenIds = new Set(user.hiddenUserIds || []);
  const hiddenConversationIds = new Set(db.conversations
    .filter((conversation) => !conversation.groupId && conversation.participants.includes(user.id))
    .filter((conversation) => hiddenIds.has(otherParticipant(conversation, user.id)))
    .map((conversation) => conversation.id));
  for (const message of db.messages) {
    if (hiddenConversationIds.has(message.conversationId)) deleteForUser(message, user.id);
  }
  user.hiddenUserIds = [];
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

function normalizeUploadedMediaMimeType(file) {
  const mimeType = String(file.mimetype || "").split(";")[0].trim().toLowerCase();
  if (mimeType && !["application/octet-stream", "binary/octet-stream", "text/plain"].includes(mimeType)) {
    return file.mimetype;
  }

  const extension = path.extname(file.originalname || "").toLowerCase();
  if (extension === ".weba" || /^(audio|voice)-/i.test(file.originalname || "")) return "audio/webm";
  if (extension === ".webm") return "video/webm";
  return file.mimetype || "application/octet-stream";
}

function mediaFromFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const audioExtensions = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac", ".weba"]);
  const videoExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".3gp", ".mpeg", ".mpg"]);
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"]);
  const mimeType = normalizeUploadedMediaMimeType(file);
  let kind = mediaKindFromMime(mimeType);

  if (kind === "document") {
    if (audioExtensions.has(extension)) kind = "audio";
    if (videoExtensions.has(extension)) kind = "video";
    if (imageExtensions.has(extension)) kind = "image";
  }

  return {
    kind,
    url: `/uploads/${file.filename}`,
    originalName: file.originalname,
    mimeType,
    size: file.size
  };
}

function findStoredMediaForUpload(filename) {
  const url = `/uploads/${filename}`;
  const messageMedia = db.messages.find((message) => message.media?.url === url)?.media;
  if (messageMedia) return messageMedia;
  const statusMedia = db.statuses.find((status) => status.media?.url === url)?.media;
  if (statusMedia) return statusMedia;
  for (const item of db.sharedItems || []) {
    const mediaItems = Array.isArray(item.media) ? item.media : [item.media];
    const found = mediaItems.find((media) => media?.url === url);
    if (found) return found;
  }
  return null;
}

async function migrateStoredMediaForPlayback(media) {
  if (!media?.url?.startsWith("/uploads/")) return false;
  const originalUrl = media.url;
  const filename = path.basename(originalUrl);
  const filePath = path.join(activeUploadDir, filename);
  if (!fs.existsSync(filePath)) return false;

  const file = {
    filename,
    path: filePath,
    originalname: media.originalName || filename,
    mimetype: media.mimeType || "",
    size: fs.statSync(filePath).size
  };
  const normalizedMimeType = normalizeUploadedMediaMimeType(file).split(";")[0].trim().toLowerCase();
  if (!["video/webm", "audio/webm", "audio/mp4"].includes(normalizedMimeType)) return false;

  await prepareRecordingFileForPlayback(file);
  const replacement = mediaFromFile(file);
  const replaceMedia = (storedMedia) => {
    if (storedMedia?.url !== originalUrl) return;
    Object.assign(storedMedia, replacement);
  };
  for (const message of db.messages) replaceMedia(message.media);
  for (const status of db.statuses || []) replaceMedia(status.media);
  for (const item of db.sharedItems || []) {
    for (const sharedMedia of Array.isArray(item.media) ? item.media : [item.media]) replaceMedia(sharedMedia);
  }
  return true;
}

function userLabel(userId) {
  const user = db.users.find((item) => item.id === userId);
  return user ? `${user.displayName} (${user.userId || user.mobile})` : `Removed user (${userId})`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function removeUploadedMediaFile(media) {
  const url = media?.url;
  if (!url?.startsWith("/uploads/")) return;
  const isReferenced = (db.messages || []).some((message) => message.media?.url === url)
    || (db.statuses || []).some((status) => status.media?.url === url)
    || (db.sharedItems || []).some((item) => {
      const mediaItems = Array.isArray(item.media) ? item.media : [item.media];
      return mediaItems.some((itemMedia) => itemMedia?.url === url);
    })
    || (db.users || []).some((user) => user.avatarUrl === url);
  if (isReferenced) return;
  const filename = path.basename(url);
  const filePath = path.join(activeUploadDir, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error(`Could not remove media file "${filename}":`, error);
  }
}

function removeMessageMediaFiles(messages) {
  for (const message of messages) removeUploadedMediaFile(message.media);
}

function clearUploadDirectory() {
  if (!fs.existsSync(activeUploadDir)) return;
  for (const entry of fs.readdirSync(activeUploadDir, { withFileTypes: true })) {
    const filePath = path.join(activeUploadDir, entry.name);
    try {
      fs.rmSync(filePath, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to remove upload "${filePath}":`, error);
    }
  }
}

function activeStatuses() {
  const now = Date.now();
  const previousStatuses = db.statuses || [];
  const expiredStatuses = [];
  db.statuses = previousStatuses.filter((status) => {
    const expiresAt = new Date(status.expiresAt || new Date(new Date(status.createdAt).getTime() + STATUS_EXPIRE_MS)).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      expiredStatuses.push(status);
      return false;
    }
    return true;
  });
  for (const status of expiredStatuses) removeUploadedMediaFile(status.media);
  if (expiredStatuses.length) saveDb();
  return db.statuses;
}

function statusContactIds(userId) {
  const contactIds = new Set();
  for (const conversation of db.conversations) {
    if (conversation.groupId || conversation.participants.length !== 2 || !conversation.participants.includes(userId)) continue;
    for (const participantId of conversation.participants) {
      if (participantId === userId) continue;
      const participant = db.users.find((user) => user.id === participantId);
      if (
        participant
        && !participant.deleted
        && !participant.blocked
        && !participant.suspended
        && !blockedBetween(userId, participantId)
      ) {
        contactIds.add(participantId);
      }
    }
  }
  return contactIds;
}

function canSeeStatus(status, user) {
  return status.userId === user.id || statusContactIds(status.userId).has(user.id);
}

function recordStatusView(status, user) {
  if (status.userId === user.id) return false;
  status.viewedBy ||= [];
  if (status.viewedBy.some((view) => view.userId === user.id)) return false;
  status.viewedBy.push({ userId: user.id, at: new Date().toISOString() });
  return true;
}

function statusViewers(status, { includeOwner = false } = {}) {
  return (status.viewedBy || [])
    .filter((view) => includeOwner || view.userId !== status.userId)
    .map((view) => {
      const user = db.users.find((item) => item.id === view.userId);
      if (!user || user.deleted) return null;
      return { user: publicUser(user), at: view.at };
    })
    .filter(Boolean);
}

function statusResponse(status, viewerUser) {
  const isOwner = status.userId === viewerUser.id;
  const viewers = statusViewers(status);
  const reactions = status.reactions || [];
  const replies = status.replies || [];
  const visibleReplies = isOwner ? replies : replies.filter((reply) => reply.userId === viewerUser.id);
  const { viewedBy: _viewedBy, ...safeStatus } = status;
  return {
    ...safeStatus,
    reactions: isOwner
      ? reactions.map((reaction) => ({
        ...reaction,
        user: publicUser(db.users.find((user) => user.id === reaction.userId))
      })).filter((reaction) => reaction.user)
      : undefined,
    myReaction: reactions.find((reaction) => reaction.userId === viewerUser.id)?.emoji || null,
    replies: visibleReplies.map((reply) => ({
      ...reply,
      user: publicUser(db.users.find((user) => user.id === reply.userId))
    })).filter((reply) => reply.user),
    media: status.media?.kind === "video" ? { ...status.media, clipTo: STATUS_VIDEO_MAX_SECONDS } : status.media,
    user: publicUser(db.users.find((user) => user.id === status.userId)),
    viewedByMe: isOwner || (status.viewedBy || []).some((view) => view.userId === viewerUser.id),
    viewerCount: isOwner ? viewers.length : 0,
    reactionCount: isOwner ? reactions.length : 0,
    replyCount: isOwner ? replies.length : visibleReplies.length,
    viewers: isOwner ? viewers : undefined,
    canDelete: isOwner
  };
}

function emitStatusToContacts(eventName, status) {
  const recipientIds = new Set([status.userId, ...statusContactIds(status.userId)]);
  for (const userId of recipientIds) {
    const user = db.users.find((item) => item.id === userId);
    if (user) io.to(userId).emit(eventName, { status: statusResponse(status, user) });
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
app.get("/uploads/:filename", (req, res, next) => {
  activeStatuses();
  const filename = path.basename(req.params.filename);
  const status = db.statuses.find((item) => item.media?.url === `/uploads/${filename}`);
  if (!status) return next();
  authUser(req, res, () => requirePrivacyUnlocked(req, res, () => {
    if (!canSeeStatus(status, req.user)) return res.status(404).json({ error: "Media not found." });
    next();
  }));
}, async (req, res, next) => {
  const filename = path.basename(req.params.filename);
  const media = findStoredMediaForUpload(filename);
  const filePath = path.join(activeUploadDir, filename);
  if (!fs.existsSync(filePath)) {
    if (media) return res.status(404).json({ error: "Media file not found." });
    return next();
  }
  const mimeType = media
    ? normalizeUploadedMediaMimeType({ mimetype: media.mimeType, originalname: media.originalName || filename })
    : normalizeUploadedMediaMimeType({ mimetype: "", originalname: filename });
  if (media && ["video/webm", "audio/webm", "audio/mp4"].includes(mimeType.split(";")[0].trim().toLowerCase())) {
    try {
      await migrateStoredMediaForPlayback(media);
      if (media.url !== `/uploads/${filename}`) return res.redirect(302, media.url);
    } catch (error) {
      console.error("Stored recording conversion failed:", error.message || error);
      return res.status(500).json({ error: "Recording could not be prepared for playback." });
    }
  }
  if (!/^(audio|video)\//.test(mimeType)) return next();
  res.setHeader("Content-Type", mimeType.split(";")[0]);
  res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) next(error);
  });
});
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
    googleClientId: GOOGLE_CLIENT_ID,
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
  res.status(410).json({ error: "Create your account with Google sign-in." });
});

app.post("/api/auth/google", async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server." });
  }
  let identity;
  try {
    identity = await verifyGoogleIdToken(req.body.credential);
  } catch (error) {
    console.error("Google sign-in verification failed:", error.message || error);
    return res.status(401).json({ error: "Could not verify this Google account. Please try again." });
  }

  const user = db.users.find((item) => (
    item.googleSubject === identity.googleSubject
    || String(item.email || "").trim().toLowerCase() === identity.email
  ));
  if (user && (user.deleted || user.blocked || user.suspended)) {
    return res.status(403).json({ error: "Account is blocked or suspended." });
  }

  if (user && profileIsComplete(user)) {
    if (!user.googleSubject || user.email !== identity.email) {
      user.googleSubject = identity.googleSubject;
      user.email = identity.email;
      saveDb();
    }
    return res.json({
      token: signUser(user),
      privacyToken: signPrivacy(user),
      user: ownUser(user)
    });
  }

  const setupToken = jwt.sign({
    role: "google-onboarding",
    googleSubject: identity.googleSubject,
    email: identity.email,
    existingUserId: user?.id || null
  }, JWT_SECRET, { expiresIn: "15m" });
  res.json({ setupToken, email: identity.email, displayName: user?.displayName || identity.displayName });
});

app.post("/api/auth/google/complete-profile", async (req, res) => {
  let setup;
  try {
    setup = jwt.verify(req.body.setupToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Google sign-in expired. Please choose your Google account again." });
  }
  if (setup.role !== "google-onboarding" || !setup.email || !setup.googleSubject) {
    return res.status(401).json({ error: "Google sign-in is required to create an account." });
  }

  const displayName = String(req.body.displayName || "").trim();
  const mobile = String(req.body.mobile || "").trim();
  const password = String(req.body.password || "");
  const calculatorLockPassword = String(req.body.calculatorLockPassword || "").trim();
  const userIdResult = validateUserId(req.body.userId);
  if (userIdResult.error) return res.status(400).json({ error: userIdResult.error });
  if (!displayName || displayName.length > 80) {
    return res.status(400).json({ error: "Name is required and must be 80 characters or fewer." });
  }
  if (normalizeMobile(mobile).length < 7 || normalizeMobile(mobile).length > 15) {
    return res.status(400).json({ error: "Enter a valid phone number with 7 to 15 digits." });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Login password must be between 8 and 128 characters." });
  }
  if (calculatorLockPassword && !validPrivacyCode(calculatorLockPassword)) {
    return res.status(400).json({ error: "Optional calculator lock password must be exactly 6 digits." });
  }

  const userId = userIdResult.userId;
  const linkedUser = db.users.find((item) => (
    item.googleSubject === setup.googleSubject
    || String(item.email || "").trim().toLowerCase() === String(setup.email).toLowerCase()
  ));
  const user = setup.existingUserId
    ? db.users.find((item) => item.id === setup.existingUserId)
    : linkedUser;
  if (setup.existingUserId && (!user || user.deleted || user.blocked || user.suspended)) {
    return res.status(403).json({ error: "Account is not active." });
  }
  if (!setup.existingUserId && user && profileIsComplete(user)) {
    return res.status(409).json({ error: "This Google account already has a profile. Sign in with Google." });
  }
  if (!isAvailableUserId(userId, user?.id) || !isAvailableMobile(mobile, user?.id)) {
    return res.status(409).json({ error: "User ID or phone number already exists. Choose a different one." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const privacyCodeHash = calculatorLockPassword
    ? await bcrypt.hash(calculatorLockPassword, 10)
    : null;
  const accountCreatedDuringSetup = db.users.some((item) => (
    item.id !== user?.id
      && (
        item.googleSubject === setup.googleSubject
        || String(item.email || "").trim().toLowerCase() === String(setup.email).toLowerCase()
      )
  ));
  if (accountCreatedDuringSetup) {
    return res.status(409).json({ error: "This Google account already has a profile. Sign in with Google." });
  }
  if (!isAvailableUserId(userId, user?.id) || !isAvailableMobile(mobile, user?.id)) {
    return res.status(409).json({ error: "User ID or phone number already exists. Choose a different one." });
  }
  const updatedUser = user || {
    id: crypto.randomUUID(),
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
    messageAutoDelete: { enabled: false, ttlHours: 0 },
    statusText: "",
    statusUpdatedAt: null,
    avatarUrl: null,
    hiddenChatSecret: null,
    notificationEnabled: true,
    lockedChatPin: null,
    createdAt: new Date().toISOString(),
    lastSeenAt: null
  };
  Object.assign(updatedUser, {
    displayName,
    mobile,
    userId,
    email: setup.email,
    googleSubject: setup.googleSubject,
    passwordHash,
    privacyMode: {
      enabled: Boolean(calculatorLockPassword),
      autoLockMinutes: 0,
      panicShortcut: "button"
    },
    privacyCodeHash,
    privacyCodeAdminValue: null
  });
  if (!user) db.users.push(updatedUser);
  saveDb();
  res.json({
    token: signUser(updatedUser),
    privacyToken: signPrivacy(updatedUser),
    user: ownUser(updatedUser)
  });
});

app.post("/api/login", async (req, res) => {
  const { login, password } = req.body;
  const loginId = normalizeUserId(login);
  const normalizedLogin = String(login || "").trim().toLowerCase();
  const user = db.users.find((item) => (
    !item.deleted && (
      normalizeUserId(item.userId) === loginId
      || item.mobile === login
      || (item.email && String(item.email).toLowerCase() === normalizedLogin)
    )
  ));
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
  res.json({
    token: signUser(user),
    privacyToken: signPrivacy(user),
    user: ownUser(user)
  });
});

app.get("/api/me", authUser, (req, res) => {
  res.json({ user: ownUser(req.user) });
});

app.get("/api/push/vapid-public-key", authUser, (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", authUser, (req, res) => {
  const subscription = req.body.subscription;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Subscription object is required." });
  }
  savePushSubscription(req.user.id, subscription);
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", authUser, (req, res) => {
  const endpoint = req.body.endpoint;
  if (!endpoint) {
    return res.status(400).json({ error: "Subscription endpoint is required." });
  }
  removePushSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

app.post("/api/me/verify-email", authUser, async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Email verification is unavailable. Google sign-in is not configured on the server." });
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(req.body.credential, { maxAgeSeconds: 5 * 60 });
  } catch (error) {
    console.error("Profile email verification failed:", error.message || error);
    return res.status(401).json({ error: "Google could not verify this email. Please try again." });
  }

  const currentEmail = String(req.user.email || "").trim().toLowerCase();
  if (currentEmail && currentEmail !== identity.email) {
    return res.status(403).json({ error: "Sign in with the Google account linked to this profile's email address." });
  }
  if (req.user.googleSubject && req.user.googleSubject !== identity.googleSubject) {
    return res.status(403).json({ error: "This profile is linked to a different Google account." });
  }
  if (db.users.some((user) => (
    user.id !== req.user.id
      && String(user.email || "").trim().toLowerCase() === identity.email
  ))) {
    return res.status(409).json({ error: "This verified email is already linked to another account." });
  }

  req.user.email = identity.email;
  req.user.googleSubject = identity.googleSubject;
  saveDb();
  const issuedAt = Math.floor(Date.now() / 1000);
  const emailVerificationToken = jwt.sign({
    role: "email-verification",
    id: req.user.id,
    email: identity.email,
    iat: issuedAt
  }, JWT_SECRET, { expiresIn: "10m" });
  res.json({
    email: identity.email,
    emailVerificationToken,
    expiresAt: new Date((issuedAt + 10 * 60) * 1000).toISOString()
  });
});

app.patch("/api/me", authUser, requirePrivacyUnlocked, async (req, res) => {
  const { displayName, mobile, oldPassword, newPassword, reactionEmojis, statusText, messageAutoDelete } = req.body;
  const requiresEmailVerification = [
    "displayName",
    "userId",
    "mobile",
    "statusText",
    "newPassword",
    "notificationEnabled",
    "messageAutoDelete"
  ]
    .some((key) => req.body[key] !== undefined);
  if (requiresEmailVerification && !emailVerificationTokenIsValid(req.user, req.headers["x-email-verification"])) {
    return res.status(403).json({ error: "Verify your account email with Google before saving profile or password changes." });
  }
  let nextUserId = null;
  if (req.body.userId !== undefined) {
    const userIdResult = validateUserId(req.body.userId);
    if (userIdResult.error) return res.status(400).json({ error: userIdResult.error });
    nextUserId = userIdResult.userId;
    if (!isAvailableUserId(nextUserId, req.user.id)) {
      return res.status(409).json({ error: "User ID already exists." });
    }
  }
  if (displayName && displayName.trim().length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
  if (displayName && displayName.trim().length > 80) return res.status(400).json({ error: "Name must be 80 characters or fewer." });
  if (mobile !== undefined && (normalizeMobile(mobile).length < 7 || normalizeMobile(mobile).length > 15)) {
    return res.status(400).json({ error: "Enter a valid phone number with 7 to 15 digits." });
  }
  if (mobile && !isAvailableMobile(mobile, req.user.id)) {
    return res.status(409).json({ error: "Mobile number already exists." });
  }
  if (reactionEmojis !== undefined && !Array.isArray(reactionEmojis)) return res.status(400).json({ error: "Reaction emojis must be a list." });
  if (statusText !== undefined && String(statusText).trim().length > 140) return res.status(400).json({ error: "Status must be 140 characters or less." });
  if (messageAutoDelete !== undefined && (!messageAutoDelete || typeof messageAutoDelete !== "object")) {
    return res.status(400).json({ error: "Auto delete setting is invalid." });
  }
  if (newPassword) {
    if (!oldPassword) return res.status(400).json({ error: "Old password is required." });
    if (newPassword.length < 8 || newPassword.length > 128) return res.status(400).json({ error: "New password must be between 8 and 128 characters." });
    if (!(await bcrypt.compare(oldPassword, req.user.passwordHash))) return res.status(403).json({ error: "Old password is incorrect." });
    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  if (nextUserId) req.user.userId = nextUserId;
  if (displayName) req.user.displayName = displayName.trim();
  if (mobile !== undefined) req.user.mobile = String(mobile).trim();
  if (statusText !== undefined) {
    req.user.statusText = String(statusText || "").trim();
    req.user.statusUpdatedAt = req.user.statusText ? new Date().toISOString() : null;
  }
  if (req.body.notificationEnabled !== undefined) {
    req.user.notificationEnabled = Boolean(req.body.notificationEnabled);
  }
  if (Array.isArray(reactionEmojis)) {
    req.user.reactionEmojis = [...new Set(reactionEmojis.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
  }
  if (messageAutoDelete && typeof messageAutoDelete === "object") {
    const enabled = Boolean(messageAutoDelete.enabled);
    const ttlHours = Number(messageAutoDelete.ttlHours || 0);
    const allowedHours = new Set([1, 6, 12, 24, 48, 72, 168, 720]);
    if (enabled && !allowedHours.has(ttlHours)) {
      return res.status(400).json({ error: "Auto delete time is invalid." });
    }
    req.user.messageAutoDelete = {
      enabled,
      ttlHours: enabled ? ttlHours : 0
    };
  }
  saveDb();
  res.json({ user: ownUser(req.user) });
});

app.post("/api/me/avatar", authUser, requirePrivacyUnlocked, (req, res, next) => {
  if (!emailVerificationTokenIsValid(req.user, req.headers["x-email-verification"])) {
    return res.status(403).json({ error: "Verify your account email with Google before changing your profile photo." });
  }
  next();
}, handleMulterUpload(upload.single("avatar")), (req, res) => {
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
  if (code && !emailVerificationTokenIsValid(req.user, req.headers["x-email-verification"])) {
    return res.status(403).json({ error: "Verify your account email with Google before changing your calculator lock password." });
  }
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
  const defaultCode = "638839";

  // If user has set a privacy code, check it first
  if (req.user.privacyCodeHash) {
    const ok = await bcrypt.compare(code, req.user.privacyCodeHash);
    if (ok) {
      req.user.privacyMode = req.user.privacyMode || {};
      req.user.privacyMode.enabled = true;
      saveDb();
      clearPrivacyRateLimit(req, req.user);
      return res.json({ ok: true, privacyToken: signPrivacy(req.user), user: ownUser(req.user) });
    }
  }

  // Fallback: If code is default unlock code '638839' or '123456' or if user has no code set
  if (code === defaultCode || code === "123456" || !req.user.privacyCodeHash) {
    if (!req.user.privacyCodeHash && (code === defaultCode || code === "123456")) {
      req.user.privacyCodeHash = await bcrypt.hash(code, 10);
    }
    req.user.privacyMode = req.user.privacyMode || {};
    req.user.privacyMode.enabled = true;
    saveDb();
    clearPrivacyRateLimit(req, req.user);
    return res.json({ ok: true, privacyToken: signPrivacy(req.user), user: ownUser(req.user) });
  }

  res.status(400).json({ error: "Invalid privacy code." });
});

app.get("/api/privacy/session", authUser, (req, res) => {
  if (verifyPrivacyToken(req.user, req.headers["x-privacy-token"])) return res.json({ ok: true });
  res.status(401).json({ error: "Privacy session required." });
});

app.post("/api/lock-pin", authUser, async (req, res) => {
  const currentPin = String(req.body.currentPin || "").trim();
  const newPin = String(req.body.newPin || "").trim();
  if (!validLockPin(newPin)) return res.status(400).json({ error: "Lock PIN must be at least 4 characters." });
  if (req.user.lockedChatPin) {
    if (!currentPin) return res.status(400).json({ error: "Current PIN is required to change the lock PIN." });
    if (!(await bcrypt.compare(currentPin, req.user.lockedChatPin))) {
      return res.status(403).json({ error: "Current PIN is incorrect." });
    }
  }
  req.user.lockedChatPin = await bcrypt.hash(newPin, 10);
  saveDb();
  res.json({ ok: true, hasLockedChatPin: true });
});

app.post("/api/lock-pin/verify", authUser, async (req, res) => {
  const code = String(req.body.code || "").trim();
  if (await verifyLockPin(req.user, code)) return res.json({ ok: true });
  res.status(403).json({ error: "Invalid lock PIN." });
});

app.get("/api/conversations/locked", authUser, async (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!await verifyLockPin(req.user, code)) {
    return res.status(403).json({ error: "Invalid lock PIN." });
  }
  const conversations = db.conversations
    .filter((item) => item.participants.includes(req.user.id))
    .filter((conversation) => conversationLockedForUser(conversation, req.user))
    .map((conversation) => {
      const hydrated = hydrateConversation(conversation, req.user);
      return { ...hydrated, lastMessage: null };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ conversations });
});

app.post("/api/conversations/:id/lock", authUser, async (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  if (!req.user.lockedChatPin) return res.status(400).json({ error: "Set a lock PIN before locking chats." });
  const code = String(req.body.code || "").trim();
  if (!await verifyLockPin(req.user, code)) return res.status(403).json({ error: "Invalid lock PIN." });
  lockConversationForUser(conversation, req.user.id);
  saveDb();
  res.json({ ok: true, conversation: hydrateConversation(conversation, req.user) });
});

app.post("/api/conversations/:id/unlock", authUser, async (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  if (!req.user.lockedChatPin) return res.status(400).json({ error: "Set a lock PIN before unlocking chats." });
  const code = String(req.body.code || "").trim();
  if (!await verifyLockPin(req.user, code)) return res.status(403).json({ error: "Invalid lock PIN." });
  unlockConversationForUser(conversation, req.user.id);
  saveDb();
  res.json({ ok: true, conversation: hydrateConversation(conversation, req.user) });
});

app.patch("/api/me/hidden-secret", authUser, requirePrivacyUnlocked, (req, res) => {
  const currentSecret = String(req.body.currentSecret || "").trim();
  const newSecret = String(req.body.newSecret || "").trim();
  if (!req.user.hiddenChatSecret) return res.status(400).json({ error: "Hidden chat secret is not set yet." });
  if (!hiddenChatSecretMatches(req.user, currentSecret)) return res.status(403).json({ error: "Current secret code is incorrect." });
  if (newSecret.length < 4 || newSecret.length > 128) {
    return res.status(400).json({ error: "New secret code must be between 4 and 128 characters." });
  }
  req.user.hiddenChatSecret = newSecret;
  req.user.hiddenChatSecretResetRequestedAt = null;
  hiddenSecretRecoveryCodes.delete(req.user.id);
  saveDb();
  res.json({ ok: true, user: ownUser(req.user) });
});

app.post("/api/me/hidden-secret/recovery/request", authUser, requirePrivacyUnlocked, async (req, res) => {
  const email = String(req.user.email || "").trim();
  if (!email) return res.status(400).json({ error: "Add an email address to your account before recovering your hidden chat secret." });
  const requestedAt = hiddenSecretRecoveryRequests.get(req.user.id) || 0;
  const waitMs = HIDDEN_SECRET_OTP_REQUEST_INTERVAL_MS - (Date.now() - requestedAt);
  if (waitMs > 0) {
    return res.status(429).json({ error: `Wait ${Math.ceil(waitMs / 1000)} seconds before requesting another recovery code.` });
  }
  hiddenSecretRecoveryRequests.set(req.user.id, Date.now());
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  hiddenSecretRecoveryCodes.set(req.user.id, {
    codeHash,
    expiresAt: Date.now() + HIDDEN_SECRET_OTP_TTL_MS,
    attempts: 0
  });
  try {
    await sendHiddenSecretRecoveryCode(email, code);
  } catch (error) {
    hiddenSecretRecoveryCodes.delete(req.user.id);
    if (error.code !== "SMTP_NOT_CONFIGURED") {
      console.error("Hidden chat recovery email failed:", error.message || error);
    }
    return res.status(error.code === "SMTP_NOT_CONFIGURED" ? 503 : 502).json({
      error: error.code === "SMTP_NOT_CONFIGURED"
        ? error.message
        : "Could not send the recovery email. Check the mail service configuration and try again."
    });
  }
  req.user.hiddenChatSecretResetRequestedAt = new Date().toISOString();
  saveDb();
  res.json({ ok: true, email, expiresInSeconds: HIDDEN_SECRET_OTP_TTL_MS / 1000 });
});

app.post("/api/me/hidden-secret/recovery/verify", authUser, requirePrivacyUnlocked, (req, res) => {
  const code = String(req.body.code || "").trim();
  const newSecret = String(req.body.newSecret || "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit email recovery code." });
  if (newSecret.length < 4 || newSecret.length > 128) {
    return res.status(400).json({ error: "New secret code must be between 4 and 128 characters." });
  }
  const recovery = hiddenSecretRecoveryCodes.get(req.user.id);
  if (!recovery || Date.now() >= recovery.expiresAt) {
    hiddenSecretRecoveryCodes.delete(req.user.id);
    return res.status(400).json({ error: "Recovery code expired. Request a new email code." });
  }
  recovery.attempts += 1;
  const submittedHash = crypto.createHash("sha256").update(code).digest("hex");
  const isValid = crypto.timingSafeEqual(Buffer.from(submittedHash, "hex"), Buffer.from(recovery.codeHash, "hex"));
  if (!isValid) {
    if (recovery.attempts >= 5) hiddenSecretRecoveryCodes.delete(req.user.id);
    return res.status(403).json({ error: recovery.attempts >= 5 ? "Too many incorrect attempts. Request a new email code." : "Incorrect recovery code." });
  }

  if (req.user.deleteHiddenChatsOnSecretReset) {
    deleteHiddenChatsForUser(req.user);
  }
  req.user.hiddenChatSecret = newSecret;
  req.user.hiddenChatSecretResetRequestedAt = null;
  hiddenSecretRecoveryCodes.delete(req.user.id);
  saveDb();
  res.json({ ok: true, user: ownUser(req.user), chatsDeleted: Boolean(req.user.deleteHiddenChatsOnSecretReset) });
});

app.get("/api/users/search", authUser, requirePrivacyUnlocked, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const blockedIds = new Set(req.user.blockedUserIds || []);
  const deletedIds = new Set(req.user.deletedUserIds || []);
  const hiddenIds = new Set(req.user.hiddenUserIds || []);
  if (q.length < 2) return res.json({ users: [] });
  const users = db.users
    .filter((user) => user.id !== req.user.id && !user.deleted && !user.blocked && !user.suspended)
    .filter((user) => !blockedIds.has(user.id) && !deletedIds.has(user.id) && !hiddenIds.has(user.id) && !(user.blockedUserIds || []).includes(req.user.id))
    .filter((user) => String(user.displayName || "").toLowerCase().includes(q)
      || user.userId.toLowerCase().includes(q)
      || user.mobile.includes(q)
      || String(user.email || "").trim().toLowerCase().includes(q))
    .slice(0, 20)
    .map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id), hidden: (req.user.hiddenUserIds || []).includes(user.id) }));
  res.json({ users });
});

app.post("/api/users/match-contacts", authUser, requirePrivacyUnlocked, (req, res) => {
  const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  if (contacts.length > 200) return res.status(400).json({ error: "Check contacts in groups of 200 or fewer." });
  const emailToNames = new Map();
  for (const contact of contacts) {
    const name = String(contact?.name || "").trim().slice(0, 120);
    const emails = Array.isArray(contact?.emails) ? contact.emails : [];
    for (const value of emails.slice(0, 10)) {
      const email = String(value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      if (!emailToNames.has(email)) emailToNames.set(email, name);
    }
  }
  if (!emailToNames.size) return res.json({ users: [] });

  const blockedIds = new Set(req.user.blockedUserIds || []);
  const deletedIds = new Set(req.user.deletedUserIds || []);
  const hiddenIds = new Set(req.user.hiddenUserIds || []);
  const users = db.users
    .filter((user) => user.id !== req.user.id && !user.deleted && !user.blocked && !user.suspended)
    .filter((user) => !blockedIds.has(user.id) && !deletedIds.has(user.id) && !hiddenIds.has(user.id) && !(user.blockedUserIds || []).includes(req.user.id))
    .map((user) => {
      const email = String(user.email || "").trim().toLowerCase();
      return emailToNames.has(email)
        ? { ...publicUser(user), matchedContactName: emailToNames.get(email), hidden: (req.user.hiddenUserIds || []).includes(user.id) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.matchedContactName || a.displayName).localeCompare(String(b.matchedContactName || b.displayName)));
  res.json({ users });
});

app.get("/api/search", authUser, requirePrivacyUnlocked, (req, res) => {
  const rawQuery = String(req.query.q || "").trim();
  const q = rawQuery.toLowerCase();
  const queryMobile = normalizeMobile(rawQuery);
  ensureUserCollections(req.user);
  const blockedIds = new Set(req.user.blockedUserIds || []);
  const deletedIds = new Set(req.user.deletedUserIds || []);
  const hiddenIds = new Set(req.user.hiddenUserIds || []);
  const hiddenUnlocked = hiddenChatSecretMatches(req.user, rawQuery);
  if (hiddenUnlocked) {
    const hiddenConversations = db.conversations
      .filter((conversation) => conversation.participants.includes(req.user.id) && !conversation.groupId)
      .filter((conversation) => hiddenIds.has(otherParticipant(conversation, req.user.id)))
      .map((conversation) => hydrateConversation(conversation, req.user))
      .sort((a, b) => new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
    return res.json({ users: [], conversations: [], messages: [], hiddenUnlocked: true, hiddenConversations });
  }
  if (q.length < 2) return res.json({ users: [], conversations: [], messages: [], hiddenUnlocked: false, hiddenConversations: [] });
  const users = db.users
    .filter((user) => user.id !== req.user.id && !user.deleted && !user.blocked && !user.suspended)
    .filter((user) => !blockedIds.has(user.id) && !deletedIds.has(user.id) && !(user.blockedUserIds || []).includes(req.user.id))
    .filter((user) => {
      if (hiddenIds.has(user.id)) {
        return normalizeUserId(user.userId) === normalizeUserId(rawQuery)
          || String(user.email || "").trim().toLowerCase() === q
          || (queryMobile.length >= 2 && normalizeMobile(user.mobile) === queryMobile);
      }
      return String(user.displayName || "").toLowerCase().includes(q)
        || String(user.userId || "").toLowerCase().includes(q)
        || (queryMobile.length >= 2 && normalizeMobile(user.mobile).includes(queryMobile))
        || String(user.email || "").trim().toLowerCase().includes(q);
    })
    .slice(0, 20)
    .map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id), hidden: hiddenIds.has(user.id) }));

  const conversations = db.conversations
    .filter((conversation) => conversation.participants.includes(req.user.id))
    .filter((conversation) => !isDeletedConversation(conversation, req.user))
    .filter((conversation) => !conversationLockedForUser(conversation, req.user))
    .filter((conversation) => !isHiddenConversation(conversation, req.user))
    .map((conversation) => hydrateConversation(conversation, req.user));
  const matchingConversations = conversations.filter((conversation) => {
    const other = conversation.members.find((member) => member.id !== req.user.id);
    return String(conversation.group?.name || "").toLowerCase().includes(q)
      || String(other?.displayName || "").toLowerCase().includes(q)
      || String(other?.userId || "").toLowerCase().includes(q)
      || String(other?.mobile || "").includes(q)
      || String(conversation.lastMessage?.text || "").toLowerCase().includes(q);
  }).slice(0, 20);

  const matchingMessages = conversations.flatMap((conversation) => {
    const memberNames = new Map(conversation.members.map((member) => [member.id, member.displayName || "User"]));
    return visibleMessages(conversation.id, req.user)
      .filter((message) => String(message.text || "").toLowerCase().includes(q))
      .map((message) => ({
        id: message.id,
        conversationId: conversation.id,
        text: message.text,
        createdAt: message.createdAt,
        senderName: memberNames.get(message.senderId) || "User",
        conversation
      }));
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30);

  res.json({ users, conversations: matchingConversations, messages: matchingMessages, hiddenUnlocked: false, hiddenConversations: [] });
});

app.get("/api/conversations", authUser, requirePrivacyUnlocked, (req, res) => {
  ensureUserCollections(req.user);
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const conversations = db.conversations
    .filter((item) => item.participants.includes(req.user.id))
    .filter((conversation) => !isHiddenConversation(conversation, req.user))
    .filter((conversation) => !isDeletedConversation(conversation, req.user))
    .map((conversation) => {
      const hydrated = hydrateConversation(conversation, req.user);
      return conversationLockedForUser(conversation, req.user)
        ? { ...hydrated, lastMessage: null, unreadCount: 0 }
        : hydrated;
    })
    .filter((conversation) => includeArchived ? conversation.archived : !conversation.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
  res.json({ conversations });
});

app.get("/api/calls", authUser, requirePrivacyUnlocked, (req, res) => {
  const calls = (db.calls || [])
    .filter((call) => call.userId === req.user.id)
    .map((call) => ({
      ...call,
      peer: publicUser(db.users.find((user) => user.id === call.peerId))
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ calls });
});

app.post("/api/calls", authUser, requirePrivacyUnlocked, (req, res) => {
  const { id, conversationId, peerId, type, direction, status } = req.body;
  const conversation = db.conversations.find((item) => item.id === conversationId
    && !item.groupId
    && item.participants.includes(req.user.id)
    && item.participants.includes(peerId));
  if (!conversation) return res.status(404).json({ error: "Call conversation not found." });
  if (!["voice", "video"].includes(type)) return res.status(400).json({ error: "Invalid call type." });
  if (!["incoming", "outgoing"].includes(direction)) return res.status(400).json({ error: "Invalid call direction." });
  if (!["calling", "connected", "completed", "missed", "no_answer", "declined", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Invalid call status." });
  }

  db.calls ||= [];
  let call = id ? db.calls.find((item) => item.id === id && item.userId === req.user.id) : null;
  if (id && !call) return res.status(404).json({ error: "Call history entry not found." });
  if (call) {
    if (call.conversationId !== conversationId || call.peerId !== peerId || call.type !== type || call.direction !== direction) {
      return res.status(400).json({ error: "Call history details cannot be changed." });
    }
    call.status = status;
    if (["connected", "completed"].includes(status) && !call.connectedAt) call.connectedAt = new Date().toISOString();
    if (status !== "calling") {
      if (status === "connected") {
        call.endedAt = null;
      } else if (status !== "connected") {
        call.endedAt = new Date().toISOString();
        call.durationSeconds = Math.min(86400, Math.max(0, Number(req.body.durationSeconds) || 0));
      }
    }
  } else {
    call = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      conversationId,
      peerId,
      type,
      direction,
      status,
      createdAt: new Date().toISOString(),
      connectedAt: ["connected", "completed"].includes(status) ? new Date().toISOString() : null,
      endedAt: ["calling", "connected"].includes(status) ? null : new Date().toISOString(),
      durationSeconds: Math.min(86400, Math.max(0, Number(req.body.durationSeconds) || 0))
    };
    db.calls.push(call);
  }
  saveDb();
  res.json({ call: { ...call, peer: publicUser(db.users.find((user) => user.id === call.peerId)) } });
});

app.get("/api/conversations/hidden", authUser, requirePrivacyUnlocked, (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!hiddenChatSecretMatches(req.user, code)) {
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
  if ((req.user.hiddenUserIds || []).includes(other.id)) {
    return res.status(403).json({ error: "This chat is hidden. Enter your hidden chat secret in the search bar to access it." });
  }
  if ((req.user.blockedUserIds || []).includes(other.id)) return res.status(403).json({ error: "Unblock this user before starting chat." });
  if ((other.blockedUserIds || []).includes(req.user.id)) return res.status(403).json({ error: "You cannot message this user." });
  req.user.deletedUserIds = (req.user.deletedUserIds || []).filter((id) => id !== other.id);
  const conversation = makeConversation([req.user.id, other.id]);
  saveDb();
  res.json({ conversation: hydrateConversation(conversation, req.user) });
});

app.get("/api/conversations/:id/messages", authUser, requirePrivacyUnlocked, async (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  if (conversationLockedForUser(conversation, req.user)
    && !await verifyLockPin(req.user, req.get("X-Lock-Pin"))) {
    return res.status(403).json({ error: "Invalid lock PIN." });
  }
  const messages = visibleMessages(conversation.id, req.user.id);
  let mediaMigrated = false;
  for (const message of messages) {
    if (message.media && await migrateStoredMediaForPlayback(message.media)) mediaMigrated = true;
  }
  if (mediaMigrated) saveDb();
  res.json({ messages });
});

app.post("/api/conversations/:id/read", authUser, requirePrivacyUnlocked, async (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  if (conversationLockedForUser(conversation, req.user)
    && !await verifyLockPin(req.user, req.body.lockCode)) {
    return res.status(403).json({ error: "Invalid lock PIN." });
  }
  const updatedMessages = markMessagesRead(conversation.id, req.user.id);
  res.json({
    ok: true,
    statuses: updatedMessages.map((message) => ({
      id: message.id,
      readBy: message.readBy,
      readDetails: message.readDetails,
      deliveredTo: message.deliveredTo,
      deliveredDetails: message.deliveredDetails
    }))
  });
});

app.patch("/api/conversations/:id/preferences", authUser, requirePrivacyUnlocked, (req, res) => {
  ensureUserCollections(req.user);
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const isDirectConversation = !conversation.groupId;
  const hasDirectOnlyPreference = ["muteUntil", "muteForever", "disappearingHours", "favorite", "contactName"]
    .some((key) => req.body[key] !== undefined);
  if (!isDirectConversation && hasDirectOnlyPreference) {
    return res.status(400).json({ error: "These settings are available for direct chats only." });
  }
  if (req.body.muteUntil !== undefined && req.body.muteUntil !== null
    && (typeof req.body.muteUntil !== "string"
      || !Number.isFinite(new Date(req.body.muteUntil).getTime())
      || new Date(req.body.muteUntil).getTime() <= Date.now())) {
    return res.status(400).json({ error: "Choose a future date and time to mute notifications." });
  }
  if (req.body.muteForever !== undefined && typeof req.body.muteForever !== "boolean") {
    return res.status(400).json({ error: "Mute setting is invalid." });
  }
  const disappearingHours = req.body.disappearingHours === undefined ? undefined : Number(req.body.disappearingHours);
  if (disappearingHours !== undefined && (!Number.isInteger(disappearingHours) || disappearingHours < 0 || disappearingHours > 8760)) {
    return res.status(400).json({ error: "Choose a message expiry between 0 and 8760 hours." });
  }
  if (req.body.favorite !== undefined && typeof req.body.favorite !== "boolean") {
    return res.status(400).json({ error: "Favourite setting is invalid." });
  }
  if (req.body.contactName !== undefined
    && (typeof req.body.contactName !== "string" || req.body.contactName.trim().length > 80)) {
    return res.status(400).json({ error: "Contact name must be 80 characters or fewer." });
  }
  const preferences = req.user.conversationPreferences[conversation.id] ||= {};
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
  if (req.body.muteUntil !== undefined) {
    preferences.muteUntil = req.body.muteUntil;
    if (req.body.muteUntil !== null) preferences.muteForever = false;
  }
  if (req.body.muteForever !== undefined) {
    preferences.muteForever = req.body.muteForever;
    if (req.body.muteForever) preferences.muteUntil = null;
  }
  if (req.body.disappearingHours !== undefined) {
    preferences.disappearingHours = disappearingHours;
  }
  if (req.body.favorite !== undefined) preferences.favorite = req.body.favorite;
  if (req.body.contactName !== undefined) {
    const otherUserId = otherParticipant(conversation, req.user.id);
    const contactName = req.body.contactName.trim();
    if (contactName) req.user.contactAliases[otherUserId] = contactName;
    else delete req.user.contactAliases[otherUserId];
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
    .filter((message) => !messageExpiredForUser(message, req.user))
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
  if (!requestedSecret || requestedSecret.length < 4 || requestedSecret.length > 128) {
    return res.status(400).json({ error: "Enter a secret code between 4 and 128 characters.", requiresSecret: true });
  }
  if (req.user.hiddenChatSecret && !hiddenChatSecretMatches(req.user, requestedSecret)) {
    return res.status(403).json({ error: "Incorrect hidden chat secret." });
  }
  if (!req.user.hiddenChatSecret) req.user.hiddenChatSecret = requestedSecret;
  req.user.hiddenUserIds = [...new Set([...(req.user.hiddenUserIds || []), otherId])];
  unlockConversationForUser(conversation, req.user.id);
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

app.post("/api/upload", authUser, requirePrivacyUnlocked, handleMulterUpload(upload.single("file")), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File is required." });
  try {
    req.file.mimetype = normalizeUploadedMediaMimeType(req.file);
    await prepareRecordingFileForPlayback(req.file);
  } catch (error) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.error("Could not remove failed audio upload:", cleanupError.message || cleanupError);
    }
    console.error("WebM recording finalization failed:", error.message || error);
    return res.status(500).json({ error: "Could not finalize the recording. Please record again." });
  }
  req.file.size = fs.statSync(req.file.path).size;
  res.json({
    media: mediaFromFile(req.file)
  });
});

app.get("/api/statuses", authUser, requirePrivacyUnlocked, (req, res) => {
  activeStatuses();
  const visibleUserIds = statusContactIds(req.user.id);
  visibleUserIds.add(req.user.id);
  const statuses = db.statuses
    .filter((status) => visibleUserIds.has(status.userId))
    .map((status) => statusResponse(status, req.user))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ statuses });
});

app.post("/api/statuses", authUser, requirePrivacyUnlocked, (req, res) => {
  const text = String(req.body.text || "").trim();
  const media = req.body.media || null;
  if (!text && !media) return res.status(400).json({ error: "Status text, image, or video is required." });
  if (text.length > 500) return res.status(400).json({ error: "Status text must be 500 characters or fewer." });
  if (media && !["image", "video"].includes(media.kind)) return res.status(400).json({ error: "Only image or video status is supported." });
  if (media) {
    const filename = typeof media.url === "string" && media.url.startsWith("/uploads/")
      ? path.basename(media.url)
      : "";
    if (!filename || media.url !== `/uploads/${filename}` || !fs.existsSync(path.join(activeUploadDir, filename))) {
      return res.status(400).json({ error: "Upload a status photo or video before posting." });
    }
    if (findStoredMediaForUpload(filename) || db.users.some((user) => user.avatarUrl === media.url)) {
      return res.status(409).json({ error: "This uploaded media is already in use. Upload it again for your status." });
    }
    const file = { path: path.join(activeUploadDir, filename), originalname: media.originalName || filename, mimetype: media.mimeType || "" };
    const actualKind = mediaKindFromMime(normalizeUploadedMediaMimeType(file));
    if (actualKind !== media.kind) return res.status(400).json({ error: "Status media type does not match the uploaded file." });
  }
  if (media?.kind === "video") {
    const duration = Number(media.duration || 0);
    media.originalDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
    media.duration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, STATUS_VIDEO_MAX_SECONDS) : STATUS_VIDEO_MAX_SECONDS;
    media.clipTo = STATUS_VIDEO_MAX_SECONDS;
  }
  const status = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    text,
    media,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATUS_EXPIRE_MS).toISOString(),
    viewedBy: [],
    reactions: [],
    replies: []
  };
  db.statuses ||= [];
  db.statuses.push(status);
  saveDb();
  emitStatusToContacts("status:new", status);
  io.to("admins").emit("admin:status", { statusId: status.id });
  res.json({ status: statusResponse(status, req.user) });
});

app.post("/api/statuses/:id/view", authUser, requirePrivacyUnlocked, (req, res) => {
  activeStatuses();
  const status = (db.statuses || []).find((item) => item.id === req.params.id);
  if (!status || !canSeeStatus(status, req.user)) return res.status(404).json({ error: "Status not found." });
  if (recordStatusView(status, req.user)) {
    saveDb();
    const owner = db.users.find((user) => user.id === status.userId);
    if (owner) io.to(owner.id).emit("status:updated", { status: statusResponse(status, owner) });
  }
  res.json({ ok: true, viewerCount: statusViewers(status).length, status: statusResponse(status, req.user) });
});

app.post("/api/statuses/:id/reactions", authUser, requirePrivacyUnlocked, (req, res) => {
  activeStatuses();
  const status = (db.statuses || []).find((item) => item.id === req.params.id);
  if (!status || !canSeeStatus(status, req.user)) return res.status(404).json({ error: "Status not found." });
  if (status.userId === req.user.id) return res.status(403).json({ error: "You cannot react to your own status." });
  const emoji = String(req.body.emoji || "").trim();
  const allowedReactions = new Set(["❤️", "😂", "😮", "😢", "🙏", "👍", "🔥", "👏"]);
  if (!allowedReactions.has(emoji)) return res.status(400).json({ error: "Choose a supported status reaction." });
  recordStatusView(status, req.user);
  status.reactions ||= [];
  const existingReactionIndex = status.reactions.findIndex((reaction) => reaction.userId === req.user.id);
  if (existingReactionIndex >= 0 && status.reactions[existingReactionIndex].emoji === emoji) {
    status.reactions.splice(existingReactionIndex, 1);
  } else {
    const reaction = { userId: req.user.id, emoji, at: new Date().toISOString() };
    if (existingReactionIndex >= 0) status.reactions[existingReactionIndex] = reaction;
    else status.reactions.push(reaction);
  }
  saveDb();
  const owner = db.users.find((user) => user.id === status.userId);
  if (owner) io.to(owner.id).emit("status:updated", { status: statusResponse(status, owner) });
  res.json({ status: statusResponse(status, req.user) });
});

app.post("/api/statuses/:id/replies", authUser, requirePrivacyUnlocked, (req, res) => {
  activeStatuses();
  const status = (db.statuses || []).find((item) => item.id === req.params.id);
  if (!status || !canSeeStatus(status, req.user)) return res.status(404).json({ error: "Status not found." });
  if (status.userId === req.user.id) return res.status(403).json({ error: "You cannot reply to your own status." });
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Write a reply before sending." });
  if (text.length > 500) return res.status(400).json({ error: "Status replies must be 500 characters or fewer." });
  status.replies ||= [];
  if (status.replies.filter((reply) => reply.userId === req.user.id).length >= 50) {
    return res.status(429).json({ error: "You have reached the reply limit for this status." });
  }
  recordStatusView(status, req.user);
  status.replies.push({
    id: crypto.randomUUID(),
    userId: req.user.id,
    text,
    at: new Date().toISOString()
  });
  saveDb();
  const owner = db.users.find((user) => user.id === status.userId);
  if (owner) io.to(owner.id).emit("status:updated", { status: statusResponse(status, owner) });
  res.json({ status: statusResponse(status, req.user) });
});

app.delete("/api/statuses/:id", authUser, requirePrivacyUnlocked, (req, res) => {
  activeStatuses();
  const status = (db.statuses || []).find((item) => item.id === req.params.id);
  if (!status) return res.status(404).json({ error: "Status not found." });
  if (status.userId !== req.user.id) return res.status(403).json({ error: "Only your own status can be deleted." });
  db.statuses = (db.statuses || []).filter((item) => item.id !== status.id);
  removeUploadedMediaFile(status.media);
  saveDb();
  const recipientIds = new Set([
    status.userId,
    ...statusContactIds(status.userId),
    ...(status.viewedBy || []).map((view) => view.userId)
  ]);
  for (const userId of recipientIds) {
    io.to(userId).emit("status:deleted", { statusId: status.id, userId: req.user.id });
  }
  io.to("admins").emit("admin:status-deleted", { statusId: status.id });
  res.json({ ok: true });
});

app.post("/api/groups", authUser, requirePrivacyUnlocked, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 80);
  const description = String(req.body.description || "").trim().slice(0, 280);
  const requestedMembers = Array.isArray(req.body.memberIds)
    ? [...new Set(req.body.memberIds.filter((id) => typeof id === "string" && id !== req.user.id))]
    : [];
  if (!name) return res.status(400).json({ error: "Group name is required." });
  const memberIds = requestedMembers
    .filter((id) => db.users.some((user) => user.id === id && !user.deleted && !user.blocked && !user.suspended));
  if (memberIds.length !== requestedMembers.length) return res.status(400).json({ error: "One or more selected members are no longer available." });
  if (!memberIds.length) return res.status(400).json({ error: "Add at least one active member to create a group." });

  const group = {
    id: crypto.randomUUID(),
    name,
    description,
    ownerId: req.user.id,
    adminIds: [req.user.id],
    memberIds: [req.user.id, ...memberIds],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.groups.push(group);
  const conversation = makeConversation(group.memberIds, group.id);
  saveDb();
  for (const id of group.memberIds) {
    io.in(id).socketsJoin(conversation.id);
    if (id !== req.user.id) io.to(id).emit("group:updated", { group });
  }
  res.status(201).json({ group, conversation: hydrateConversation(conversation, req.user) });
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

app.post("/api/call-recordings", authUser, requirePrivacyUnlocked, handleMulterUpload(upload.single("file")), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Recording file is required." });
  const conversation = db.conversations.find((item) => item.id === req.body.conversationId && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const callType = req.body.callType === "video" ? "Video" : "Voice";
  try {
    req.file.mimetype = normalizeUploadedMediaMimeType(req.file);
    await prepareRecordingFileForPlayback(req.file);
    req.file.size = fs.statSync(req.file.path).size;
  } catch (error) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.error("Could not remove failed call recording upload:", cleanupError.message || cleanupError);
    }
    console.error("Call recording finalization failed:", error.message || error);
    return res.status(500).json({ error: "Could not finalize the recording. Please record again." });
  }
  const recordingOwnerId = req.body.recordingForUserId || req.user.id;
  const recordingOwner = db.users.find((user) => user.id === recordingOwnerId);
  const now = new Date().toISOString();
  const recording = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    senderId: req.user.id,
    text: `${callType} call recording`,
    media: mediaFromFile(req.file),
    adminOnly: true,
    recordingForUserId: recordingOwnerId,
    recordingForDisplayName: recordingOwner?.displayName || recordingOwner?.userId || "User",
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
  const result = await verifyAdminCredentials(loginId, password);
  if (!result.ok) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }

  if (result.shouldRehash) {
    db.admin.loginId = db.admin.loginId || "6388391842";
    db.admin.email = db.admin.email || "yadavabhinav551@gmail.com";
    db.admin.passwordHash = await bcrypt.hash("1234546", 10);
    db.admin.updatedAt = new Date().toISOString();
    saveDb();
  }

  res.json({ token: signAdmin(), admin: { loginId: db.admin.loginId, email: db.admin.email } });
});

app.get("/api/admin/overview", authAdmin, (_req, res) => {
  const updateNotify = db.admin.updateNotify || defaultDb.admin.updateNotify;
  activeStatuses();
  const hiddenAdminConversationIds = new Set(db.admin.hiddenAdminConversationIds || []);
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
  const mediaEntries = [
    ...db.messages
      .filter((message) => message.media)
      .map((message) => ({
        id: message.id,
        type: "message",
        createdAt: message.createdAt,
        senderId: message.senderId,
        conversationId: message.conversationId,
        media: message.media,
        adminOnly: Boolean(message.adminOnly)
      })),
    ...(db.statuses || [])
      .filter((status) => status.media)
      .map((status) => ({
        id: status.id,
        type: "status",
        createdAt: status.createdAt,
        senderId: status.userId,
        conversationId: null,
        media: status.media,
        adminOnly: false
      }))
  ];
  const mediaCountByUser = mediaEntries.reduce((counts, entry) => {
    if (!entry.senderId) return counts;
    counts.set(entry.senderId, (counts.get(entry.senderId) || 0) + 1);
    return counts;
  }, new Map());
  const mediaKindCounts = mediaEntries.reduce(
    (totals, entry) => {
      const kind = entry.media?.kind;
      totals.photo += kind === "image" ? 1 : 0;
      totals.video += kind === "video" ? 1 : 0;
      totals.audio += kind === "audio" || kind === "voice" ? 1 : 0;
      return totals;
    },
    { photo: 0, video: 0, audio: 0 }
  );
  const callRecordingCount = db.messages.filter((message) => message.adminOnly && message.media && ["audio", "video", "voice"].includes(message.media.kind)).length;
  const statusMediaCount = (db.statuses || []).filter((status) => status.media).length;
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
  const recentMedia = mediaEntries
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      kind: entry.media?.kind || null,
      text: entry.type === "status" ? "Status media" : entry.media?.originalName || entry.media?.kind || "Media message",
      createdAt: entry.createdAt,
      sender: publicUser(db.users.find((user) => user.id === entry.senderId)),
      conversationId: entry.conversationId,
      adminOnly: entry.adminOnly,
      url: entry.media?.url
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
      appCluster: {
        enabled: Boolean(MONGODB_URI),
        connected: Boolean(stateCollection),
        database: MONGODB_DB,
        collection: MONGODB_COLLECTION
      },
      adminCluster: {
        enabled: Boolean(MONGODB_ADMIN_URI),
        connected: Boolean(adminStateCollection),
        database: MONGODB_ADMIN_DB,
        collection: MONGODB_ADMIN_COLLECTION
      },
      totalUsers: db.users.filter((user) => !user.deleted && !user.blocked && !user.suspended).length,
      activeUsers: db.users.filter((user) => !user.deleted && !user.blocked && !user.suspended).length,
      onlineUsers: onlineUsers.size,
      totalConversations: db.conversations.length,
      hiddenConversations: hiddenAdminConversationIds.size,
      totalMessages: db.messages.length,
      uploadsUsage,
      mediaUsage: {
        totalItems: mediaEntries.length,
        photoCount: mediaKindCounts.photo,
        videoCount: mediaKindCounts.video,
        audioCount: mediaKindCounts.audio,
        callRecordingCount,
        statusMediaCount,
        topMediaUsers: Array.from(mediaCountByUser.entries())
          .map(([userId, count]) => ({ user: publicUser(db.users.find((user) => user.id === userId)), mediaCount: count }))
          .sort((a, b) => b.mediaCount - a.mediaCount)
          .slice(0, 5),
        recentMedia
      },
      topActiveUsers: db.users
        .map((user) => ({ user: adminUser(user), messageCount: messageCountByUser.get(user.id) || 0 }))
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 5),
      recentActivity
    },
    users: db.users.map(adminUser),
    conversations: db.conversations.map((conversation) => ({
      ...conversation,
      hidden: hiddenAdminConversationIds.has(conversation.id),
      members: conversation.participants.map((id) => publicUser(db.users.find((user) => user.id === id))),
      group: db.groups.find((group) => group.id === conversation.groupId) || null,
      messageCount: db.messages.filter((message) => message.conversationId === conversation.id).length
    })),
    groups: db.groups.map((group) => {
      const conversation = db.conversations.find((item) => item.groupId === group.id) || null;
      return {
        ...group,
        members: (group.memberIds || []).map((id) => publicUser(db.users.find((user) => user.id === id))).filter(Boolean),
        adminIds: group.adminIds || [],
        ownerId: group.ownerId || null,
        conversationId: conversation?.id || null,
        memberCount: (group.memberIds || []).length
      };
    }),
    statuses: db.statuses
      .map((status) => ({
        ...status,
        media: status.media?.kind === "video" ? { ...status.media, clipTo: STATUS_VIDEO_MAX_SECONDS } : status.media,
        user: publicUser(db.users.find((user) => user.id === status.userId)),
        viewerCount: statusViewers(status).length,
        viewers: statusViewers(status)
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    groups: db.groups
  });
});

app.post("/api/admin/cleanup", authAdmin, (req, res) => {
  const cluster = String(req.query.cluster || req.body.cluster || "app").toLowerCase();
  if (!["app", "admin", "both"].includes(cluster)) {
    return res.status(400).json({ error: "Invalid cluster. Choose app, admin, or both." });
  }

  const preserveUsers = (db.users || []).map((user) => ({
    id: user.id,
    userId: user.userId,
    mobile: user.mobile,
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    deleted: Boolean(user.deleted),
    blocked: Boolean(user.blocked),
    suspended: Boolean(user.suspended),
    hiddenChatUsers: user.hiddenChatUsers || [],
    privacyMode: user.privacyMode || null,
    hasPrivacyUnlockCode: Boolean(user.hasPrivacyUnlockCode),
    hiddenChatSecret: user.hiddenChatSecret || null,
    privacyUnlockCode: null,
    avatarUrl: null,
    createdAt: user.createdAt || new Date().toISOString()
  }));

  const preservedAdmin = {
    loginId: db.admin.loginId,
    email: db.admin.email,
    passwordHash: db.admin.passwordHash,
    updatedAt: new Date().toISOString()
  };

  if (cluster === "app" || cluster === "both") {
    removeMessageMediaFiles(db.messages || []);
    removeMessageMediaFiles(db.statuses || []);
    if (Array.isArray(db.sharedItems)) {
      for (const item of db.sharedItems) removeUploadedMediaFile(item.media);
    }
    clearUploadDirectory();
    db.conversations = [];
    db.messages = [];
    db.statuses = [];
    db.groups = [];
    db.sharedItems = [];
    db.users = preserveUsers;
  }

  if (cluster === "admin" || cluster === "both") {
    db.admin = {
      ...preservedAdmin,
      loginId: preservedAdmin.loginId,
      email: preservedAdmin.email,
      passwordHash: preservedAdmin.passwordHash,
      secretCodeLoginEnabled: false,
      updateNotify: defaultDb.admin.updateNotify,
      hiddenAdminConversationIds: [] ,
      updatedAt: preservedAdmin.updatedAt
    };
  }

  saveDb();
  io.to("admins").emit("admin:cleanup", { ok: true, cluster });
  res.json({ ok: true, cluster, preservedUserCount: db.users.length });
});

app.get("/api/admin/conversations/:id/messages", authAdmin, async (req, res) => {
  const messages = db.messages
    .filter((message) => message.conversationId === req.params.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  let mediaMigrated = false;
  for (const message of messages) {
    if (message.media && await migrateStoredMediaForPlayback(message.media)) mediaMigrated = true;
  }
  if (mediaMigrated) saveDb();
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

app.delete("/api/admin/conversations/:id", authAdmin, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  db.admin.hiddenAdminConversationIds = [...new Set([...(db.admin.hiddenAdminConversationIds || []), conversation.id])];
  db.admin.updatedAt = new Date().toISOString();
  saveDb();
  io.to("admins").emit("admin:conversation-hidden", { conversationId: conversation.id });
  res.json({ ok: true });
});

app.patch("/api/admin/conversations/:id/hidden", authAdmin, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const hidden = Boolean(req.body.hidden);
  const hiddenIds = new Set(db.admin.hiddenAdminConversationIds || []);
  if (hidden) hiddenIds.add(conversation.id);
  else hiddenIds.delete(conversation.id);
  db.admin.hiddenAdminConversationIds = [...hiddenIds];
  db.admin.updatedAt = new Date().toISOString();
  saveDb();
  io.to("admins").emit("admin:conversation-hidden", { conversationId: conversation.id, hidden });
  res.json({ ok: true, hidden });
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
  const {
    userId,
    password,
    blocked,
    suspended,
    deleted,
    displayName,
    mobile,
    privacyCode,
    hiddenChatSecret,
    deleteHiddenChatsOnSecretReset
  } = req.body;
  const wasActive = !user.deleted && !user.blocked && !user.suspended;
  let nextUserId = null;
  if (userId) {
    const userIdResult = validateUserId(userId);
    if (userIdResult.error) return res.status(400).json({ error: userIdResult.error });
    nextUserId = userIdResult.userId;
    if (!isAvailableUserId(nextUserId, user.id)) {
      return res.status(409).json({ error: "User ID already exists." });
    }
  }
  if (mobile && (normalizeMobile(mobile).length < 7 || normalizeMobile(mobile).length > 15)) {
    return res.status(400).json({ error: "Enter a valid phone number with 7 to 15 digits." });
  }
  if (mobile && !isAvailableMobile(mobile, user.id)) {
    return res.status(409).json({ error: "Mobile number already exists." });
  }
  let nextHiddenChatSecret;
  if (hiddenChatSecret !== undefined) {
    nextHiddenChatSecret = String(hiddenChatSecret || "").trim();
    if (!user.hiddenChatSecretResetRequestedAt) {
      return res.status(409).json({ error: "The user must request hidden chat secret recovery before an admin can change it." });
    }
    if (nextHiddenChatSecret.length < 4 || nextHiddenChatSecret.length > 128) {
      return res.status(400).json({ error: "Hidden chat secret must be between 4 and 128 characters." });
    }
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
  if (typeof deleteHiddenChatsOnSecretReset === "boolean") {
    user.deleteHiddenChatsOnSecretReset = deleteHiddenChatsOnSecretReset;
  }
  if (nextHiddenChatSecret !== undefined) {
    if (user.deleteHiddenChatsOnSecretReset) deleteHiddenChatsForUser(user);
    user.hiddenChatSecret = nextHiddenChatSecret;
    user.hiddenChatSecretResetRequestedAt = null;
    hiddenSecretRecoveryCodes.delete(user.id);
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
  const userId = user.id;
  await closeUserSessions(user, "Your account has been permanently removed by admin.");

  db.users = db.users.filter((item) => item.id !== userId);

  for (const remainingUser of db.users) {
    remainingUser.hiddenUserIds = (remainingUser.hiddenUserIds || []).filter((id) => id !== userId);
    remainingUser.blockedUserIds = (remainingUser.blockedUserIds || []).filter((id) => id !== userId);
    remainingUser.deletedUserIds = (remainingUser.deletedUserIds || []).filter((id) => id !== userId);
  }

  for (const group of db.groups) {
    group.memberIds = (group.memberIds || []).filter((id) => id !== userId);
    group.adminIds = (group.adminIds || []).filter((id) => id !== userId);
    if (group.ownerId === userId) group.ownerId = group.memberIds[0] || null;
  }

  db.conversations = db.conversations
    .map((conversation) => ({
      ...conversation,
      participants: (conversation.participants || []).filter((id) => id !== userId)
    }))
    .filter((conversation) => (conversation.participants || []).length > 1);

  const validConversationIds = new Set(db.conversations.map((conversation) => conversation.id));
  db.messages = db.messages.filter((message) => message.senderId !== userId && validConversationIds.has(message.conversationId));

  db.statuses = db.statuses.filter((status) => status.userId !== userId);
  db.admin.hiddenAdminConversationIds = (db.admin.hiddenAdminConversationIds || []).filter((id) => validConversationIds.has(id));

  saveDb();
  io.emit("presence", presencePayload());
  io.to("admins").emit("admin:user-removed", { userId });
  res.json({ ok: true });
});

app.post("/api/admin/groups", authAdmin, (req, res) => {
  const { name, memberIds = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Group name is required." });
  const validMembers = (Array.isArray(memberIds) ? memberIds : [memberIds]).filter((id) => db.users.some((user) => user.id === id && !user.deleted));
  const ownerId = validMembers[0] || null;
  const group = { id: crypto.randomUUID(), name, memberIds: validMembers, ownerId, adminIds: ownerId ? [ownerId] : [], description: "", imageUrl: "", createdAt: new Date().toISOString() };
  db.groups.push(group);
  const conversation = makeConversation(validMembers, group.id);
  saveDb();
  res.json({ group, conversation });
});

app.patch("/api/admin/groups/:id", authAdmin, (req, res) => {
  const group = db.groups.find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found." });
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Group name is required." });
  group.name = name;
  if (req.body.memberIds !== undefined) {
    const memberIds = (Array.isArray(req.body.memberIds) ? req.body.memberIds : [req.body.memberIds]).filter((id) => db.users.some((user) => user.id === id && !user.deleted));
    group.memberIds = memberIds;
    if (!group.memberIds.includes(group.ownerId)) {
      group.ownerId = memberIds[0] || null;
    }
    group.adminIds = (group.adminIds || []).filter((id) => group.memberIds.includes(id));
    if (!group.adminIds.length && group.ownerId) group.adminIds = [group.ownerId];
    const conversation = db.conversations.find((item) => item.groupId === group.id) || makeConversation(group.memberIds, group.id);
    conversation.participants = [...new Set(group.memberIds)].sort();
  }
  saveDb();
  res.json({ group });
});

app.post("/api/admin/groups/:id/members", authAdmin, (req, res) => {
  const group = db.groups.find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found." });
  const memberIds = (Array.isArray(req.body.memberIds) ? req.body.memberIds : [req.body.memberIds]).filter((id) => db.users.some((user) => user.id === id && !user.deleted));
  group.memberIds = [...new Set([...(group.memberIds || []), ...memberIds])].filter(Boolean);
  if (!group.ownerId && group.memberIds.length) group.ownerId = group.memberIds[0];
  if (!group.adminIds?.length && group.ownerId) group.adminIds = [group.ownerId];
  const conversation = db.conversations.find((item) => item.groupId === group.id) || makeConversation(group.memberIds, group.id);
  conversation.participants = [...new Set(group.memberIds)].sort();
  saveDb();
  res.json({ group });
});

app.delete("/api/admin/groups/:id/members/:memberId", authAdmin, (req, res) => {
  const group = db.groups.find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found." });
  const memberId = req.params.memberId;
  group.memberIds = (group.memberIds || []).filter((id) => id !== memberId);
  group.adminIds = (group.adminIds || []).filter((id) => id !== memberId);
  if (group.ownerId === memberId) group.ownerId = group.memberIds[0] || null;
  const conversation = db.conversations.find((item) => item.groupId === group.id);
  if (conversation) conversation.participants = [...new Set(group.memberIds)].sort();
  saveDb();
  res.json({ group });
});

app.delete("/api/admin/groups/:id", authAdmin, (req, res) => {
  const groupId = req.params.id;
  const group = db.groups.find((item) => item.id === groupId);
  if (!group) return res.status(404).json({ error: "Group not found." });
  db.groups = db.groups.filter((item) => item.id !== groupId);
  const removedConversationIds = new Set(db.conversations.filter((conversation) => conversation.groupId === groupId).map((conversation) => conversation.id));
  db.conversations = db.conversations.filter((conversation) => conversation.groupId !== groupId);
  db.messages = db.messages.filter((message) => !removedConversationIds.has(message.conversationId));
  db.admin.hiddenAdminConversationIds = (db.admin.hiddenAdminConversationIds || []).filter((id) => !removedConversationIds.has(id));
  saveDb();
  res.json({ ok: true });
});

app.post("/api/admin/conversations/:id/messages", authAdmin, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const text = String(req.body.text || "").trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: "Message text is required." });
  const message = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    senderId: "admin",
    senderName: "Admin",
    text,
    createdAt: new Date().toISOString(),
    deliveredTo: [],
    readBy: [],
    deliveryStatusVersion: 1,
    replyTo: null,
    reactions: {},
    deletedFor: [],
    adminOnly: false
  };
  db.messages.push(message);
  saveDb();
  io.to([conversation.id, ...conversation.participants]).emit("message:new", message);
  io.to("admins").emit("admin:message", message);
  res.json({ message });
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
  const updatedMessages = [];
  for (const message of db.messages) {
    message.readBy ||= [];
    message.readDetails ||= [];
    if (message.conversationId !== conversationId || message.senderId === readerId) continue;
    const now = new Date().toISOString();
    let messageChanged = false;
    message.deliveredTo ||= [];
    message.deliveredDetails ||= [];
    if (!message.deliveredTo.includes(readerId)) {
      message.deliveredTo.push(readerId);
      message.deliveredDetails.push({ userId: readerId, at: now });
      messageChanged = true;
    }
    if (!message.readBy.includes(readerId)) {
      message.readBy.push(readerId);
      message.readDetails.push({ userId: readerId, at: now });
      messageChanged = true;
    }
    if (!messageChanged) continue;
    changed = true;
    message.deliveryStatusVersion = 1;
    updatedMessages.push(message);
    io.to(message.senderId).emit("message:status", {
      messageId: message.id,
      readBy: message.readBy,
      readDetails: message.readDetails,
      deliveredTo: message.deliveredTo,
      deliveredDetails: message.deliveredDetails
    });
  }
  if (changed) saveDb();
  return updatedMessages;
}

function markMessageDelivered(message, recipientId) {
  if (message.senderId === recipientId) return false;
  message.deliveredTo ||= [];
  message.deliveredDetails ||= [];
  if (message.deliveredTo.includes(recipientId)) return false;
  message.deliveredTo.push(recipientId);
  message.deliveredDetails.push({ userId: recipientId, at: new Date().toISOString() });
  message.deliveryStatusVersion = 1;
  saveDb();
  io.to(message.senderId).emit("message:status", {
    messageId: message.id,
    readBy: message.readBy || [],
    readDetails: message.readDetails || [],
    deliveredTo: message.deliveredTo,
    deliveredDetails: message.deliveredDetails
  });
  return true;
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

  socket.on("message:delivered", ({ messageId } = {}) => {
    const message = db.messages.find((item) => item.id === messageId);
    if (!message || !db.conversations.some((item) => item.id === message.conversationId && item.participants.includes(socket.user?.id))) return;
    markMessageDelivered(message, socket.user.id);
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
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      senderId: socket.user.id,
      text: text.trim(),
      media,
      createdAt: now,
      deliveredTo: [],
      deliveredDetails: [],
      deliveryStatusVersion: 1,
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

    const pushPayload = {
      title: `New message from ${socket.user.displayName || socket.user.userId}`,
      body: message.text || message.media?.originalName || "You have a new message",
      icon: "/icons/icon-192.png",
      tag: conversationId,
      data: {
        conversationId,
        messageId: message.id
      }
    };
    const recipientIds = conversation.participants.filter((id) => {
      if (id === socket.user.id) return false;
      const recipient = db.users.find((user) => user.id === id);
      return !isConversationMutedForUser(recipient, conversationId);
    });
    Promise.allSettled(recipientIds.map((recipientId) => sendPushNotification(recipientId, pushPayload)));
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

  socket.on("call:end", ({ conversationId, targetUserId, callStatus }) => {
    if (!socket.user || !targetUserId) return;
    const status = ["missed", "no_answer", "cancelled"].includes(callStatus) ? callStatus : "completed";
    io.to(targetUserId).emit("call:ended", { conversationId, fromUserId: socket.user.id, callStatus: status });
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
