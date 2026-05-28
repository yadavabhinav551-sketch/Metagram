import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const ADMIN_ENTRY = "/vault-6388391842";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const DELETE_EVERYONE_WINDOW_MS = 5 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const defaultDb = {
  users: [],
  messages: [],
  conversations: [],
  groups: [],
  admin: {
    loginId: "6388391842",
    passwordHash: bcrypt.hashSync("123456", 10),
    updatedAt: new Date().toISOString()
  }
};

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function signUser(user) {
  return jwt.sign({ id: user.id, role: "user" }, JWT_SECRET, { expiresIn: "7d" });
}

function signAdmin() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
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
      createdAt: new Date().toISOString()
    };
    db.conversations.push(conversation);
    saveDb();
  }
  return conversation;
}

function visibleMessages(conversationId, userId) {
  return db.messages
    .filter((message) => message.conversationId === conversationId)
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

function hydrateConversation(conversation, user) {
  const messages = visibleMessages(conversation.id, user.id);
  const members = conversation.participants.map((id) => {
    const member = db.users.find((item) => item.id === id);
    return { ...publicUser(member), online: onlineUsers.has(id) };
  });
  const group = conversation.groupId ? db.groups.find((item) => item.id === conversation.groupId) : null;
  return {
    ...conversation,
    members,
    group,
    hidden: isHiddenConversation(conversation, user),
    lastMessage: messages.at(-1) || null
  };
}

function deleteForUser(message, userId) {
  message.deletedFor = [...new Set([...(message.deletedFor || []), userId])];
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const onlineUsers = new Map();
const typingTimers = new Map();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

app.get(ADMIN_ENTRY, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/signup", async (req, res) => {
  const { userId, mobile, password, displayName } = req.body;
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
    createdAt: new Date().toISOString(),
    lastSeenAt: null
  };
  db.users.push(user);
  saveDb();
  res.json({ token: signUser(user), user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { login, password } = req.body;
  const user = db.users.find((item) => (item.userId === login || item.mobile === login) && !item.deleted);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Invalid credentials." });
  if (user.blocked || user.suspended) return res.status(403).json({ error: "Account is blocked or suspended." });
  res.json({ token: signUser(user), user: publicUser(user) });
});

app.get("/api/me", authUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/me", authUser, async (req, res) => {
  const { displayName, oldPassword, newPassword } = req.body;
  if (displayName && displayName.trim().length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
  if (newPassword) {
    if (!oldPassword) return res.status(400).json({ error: "Old password is required." });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
    if (!(await bcrypt.compare(oldPassword, req.user.passwordHash))) return res.status(403).json({ error: "Old password is incorrect." });
    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  if (displayName) req.user.displayName = displayName.trim();
  saveDb();
  res.json({ user: publicUser(req.user) });
});

app.get("/api/users/search", authUser, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const users = db.users
    .filter((user) => user.id !== req.user.id && !user.deleted && !user.blocked && !user.suspended)
    .filter((user) => user.userId.toLowerCase().includes(q) || user.mobile.includes(q))
    .slice(0, 20)
    .map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id), hidden: (req.user.hiddenUserIds || []).includes(user.id) }));
  res.json({ users });
});

app.get("/api/conversations", authUser, (req, res) => {
  const conversations = db.conversations
    .filter((item) => item.participants.includes(req.user.id))
    .filter((conversation) => !isHiddenConversation(conversation, req.user))
    .map((conversation) => hydrateConversation(conversation, req.user))
    .sort((a, b) => new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
  res.json({ conversations });
});

app.post("/api/conversations", authUser, (req, res) => {
  const { userId } = req.body;
  const other = db.users.find((user) => user.id === userId && !user.deleted && !user.blocked && !user.suspended);
  if (!other) return res.status(404).json({ error: "User not found." });
  res.json({ conversation: hydrateConversation(makeConversation([req.user.id, other.id]), req.user) });
});

app.get("/api/conversations/:id/messages", authUser, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const messages = visibleMessages(conversation.id, req.user.id);
  markMessagesRead(conversation.id, req.user.id);
  res.json({ messages });
});

app.post("/api/messages/:id/delete-for-me", authUser, (req, res) => {
  const message = db.messages.find((item) => item.id === req.params.id);
  const conversation = db.conversations.find((item) => item.id === message?.conversationId && item.participants.includes(req.user.id));
  if (!message || !conversation) return res.status(404).json({ error: "Message not found." });
  deleteForUser(message, req.user.id);
  if (message.senderId === req.user.id) message.isDeletedBySender = true;
  if (message.senderId !== req.user.id) message.isDeletedByReceiver = true;
  saveDb();
  res.json({ ok: true });
});

app.post("/api/messages/:id/delete-everyone", authUser, (req, res) => {
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

app.post("/api/messages/bulk-delete-for-me", authUser, (req, res) => {
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

app.post("/api/conversations/:id/clear-for-me", authUser, (req, res) => {
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

app.post("/api/conversations/:id/hide-user", authUser, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  req.user.hiddenUserIds = [...new Set([...(req.user.hiddenUserIds || []), otherId])];
  saveDb();
  res.json({ ok: true });
});

app.post("/api/conversations/:id/unhide-user", authUser, (req, res) => {
  const conversation = db.conversations.find((item) => item.id === req.params.id && item.participants.includes(req.user.id));
  if (!conversation || conversation.groupId) return res.status(404).json({ error: "Direct conversation not found." });
  const otherId = otherParticipant(conversation, req.user.id);
  req.user.hiddenUserIds = (req.user.hiddenUserIds || []).filter((id) => id !== otherId);
  saveDb();
  res.json({ ok: true });
});

app.post("/api/upload", authUser, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File is required." });
  const kind = req.file.mimetype.startsWith("audio/") ? "voice" : req.file.mimetype.startsWith("image/") ? "image" : "document";
  res.json({
    media: {
      kind,
      url: `/uploads/${req.file.filename}`,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    }
  });
});

app.post("/api/admin/login", async (req, res) => {
  const { loginId, password } = req.body;
  if (loginId !== db.admin.loginId || !(await bcrypt.compare(password, db.admin.passwordHash))) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }
  res.json({ token: signAdmin(), admin: { loginId: db.admin.loginId } });
});

app.get("/api/admin/overview", authAdmin, (_req, res) => {
  res.json({
    users: db.users.map(publicUser),
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

app.post("/api/admin/credentials", authAdmin, async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ error: "Login ID and password are required." });
  db.admin.loginId = loginId;
  db.admin.passwordHash = await bcrypt.hash(password, 10);
  db.admin.updatedAt = new Date().toISOString();
  saveDb();
  res.json({ ok: true, admin: { loginId } });
});

app.patch("/api/admin/users/:id", authAdmin, async (req, res) => {
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  const { userId, password, blocked, suspended, deleted, displayName, mobile } = req.body;
  if (userId && db.users.some((item) => item.id !== user.id && item.userId === userId)) {
    return res.status(409).json({ error: "User ID already exists." });
  }
  if (mobile && db.users.some((item) => item.id !== user.id && item.mobile === mobile)) {
    return res.status(409).json({ error: "Mobile number already exists." });
  }
  if (userId) user.userId = userId;
  if (displayName) user.displayName = displayName;
  if (mobile) user.mobile = mobile;
  if (typeof blocked === "boolean") user.blocked = blocked;
  if (typeof suspended === "boolean") user.suspended = suspended;
  if (typeof deleted === "boolean") user.deleted = deleted;
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  saveDb();
  io.emit("presence", presencePayload());
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/groups", authAdmin, (req, res) => {
  const { name, memberIds = [] } = req.body;
  if (!name) return res.status(400).json({ error: "Group name is required." });
  const validMembers = memberIds.filter((id) => db.users.some((user) => user.id === id && !user.deleted));
  const group = { id: crypto.randomUUID(), name, memberIds: validMembers, createdAt: new Date().toISOString() };
  db.groups.push(group);
  const conversation = makeConversation(validMembers, group.id);
  saveDb();
  res.json({ group, conversation });
});

app.get("/api/admin/export", authAdmin, (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="business-chat-export-${Date.now()}.json"`);
  res.json(db);
});

function markMessagesRead(conversationId, readerId) {
  let changed = false;
  for (const message of db.messages) {
    if (message.conversationId === conversationId && message.senderId !== readerId && !message.readBy.includes(readerId)) {
      message.readBy.push(readerId);
      changed = true;
      io.to(message.senderId).emit("message:status", { messageId: message.id, readBy: message.readBy });
    }
  }
  if (changed) saveDb();
}

function presencePayload() {
  return db.users.map((user) => ({ id: user.id, online: onlineUsers.has(user.id), lastSeenAt: user.lastSeenAt }));
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
    socket.user = user;
    next();
  } catch {
    next(new Error("Authentication failed."));
  }
});

io.on("connection", (socket) => {
  if (socket.user) {
    onlineUsers.set(socket.user.id, socket.id);
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

  socket.on("message:send", ({ conversationId, text = "", media = null }) => {
    const conversation = db.conversations.find((item) => item.id === conversationId && item.participants.includes(socket.user?.id));
    if (!conversation || (!text.trim() && !media)) return;
    const now = new Date().toISOString();
    const deliveredTo = conversation.participants.filter((id) => id !== socket.user.id && onlineUsers.has(id));
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      senderId: socket.user.id,
      text: text.trim(),
      media,
      createdAt: now,
      deliveredTo,
      readBy: [socket.user.id],
      deletedFor: [],
      isDeletedBySender: false,
      isDeletedByReceiver: false
    };
    db.messages.push(message);
    saveDb();
    io.to([conversationId, ...conversation.participants]).emit("message:new", message);
    io.to("admins").emit("admin:message", message);
  });

  socket.on("typing", ({ conversationId, typing }) => {
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

  socket.on("admin:join", () => {
    if (socket.role === "admin") socket.join("admins");
  });

  socket.on("disconnect", () => {
    if (socket.user) {
      onlineUsers.delete(socket.user.id);
      socket.user.lastSeenAt = new Date().toISOString();
      saveDb();
      io.emit("presence", presencePayload());
    }
  });
});

server.listen(PORT, () => {
  console.log(`Business chat running at http://localhost:${PORT}`);
  console.log(`Hidden admin entry: http://localhost:${PORT}${ADMIN_ENTRY}`);
});
