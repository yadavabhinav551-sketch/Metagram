const state = {
  token: localStorage.getItem("chatToken"),
  user: null,
  socket: null,
  conversations: [],
  activeConversation: null,
  messages: [],
  presence: [],
  recorder: null,
  audioChunks: []
};

const $ = (id) => document.getElementById(id);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
};

function setAuthMode(mode) {
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("loginForm").classList.toggle("hidden", mode !== "login");
  $("signupForm").classList.toggle("hidden", mode !== "signup");
  $("authError").textContent = "";
}

function showChat() {
  $("authView").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  $("meName").textContent = state.user.displayName;
  $("meHandle").textContent = `${state.user.userId} · ${state.user.mobile}`;
}

function showAuth() {
  localStorage.removeItem("chatToken");
  state.token = null;
  state.user = null;
  state.socket?.disconnect();
  $("authView").classList.remove("hidden");
  $("chatView").classList.add("hidden");
}

function connectSocket() {
  state.socket?.disconnect();
  state.socket = io({ auth: { token: state.token } });
  state.socket.on("presence", (presence) => {
    state.presence = presence;
    renderConversations();
    renderHeader();
  });
  state.socket.on("message:new", (message) => {
    if (message.conversationId === state.activeConversation?.id) {
      state.messages.push(message);
      renderMessages();
      loadMessages(state.activeConversation.id);
    }
    loadConversations();
    notifyNewMessage(message);
  });
  state.socket.on("message:status", ({ messageId, readBy }) => {
    const message = state.messages.find((item) => item.id === messageId);
    if (message) message.readBy = readBy;
    renderMessages();
  });
  state.socket.on("typing", ({ conversationId, userId, typing }) => {
    if (conversationId !== state.activeConversation?.id || userId === state.user.id) return;
    $("typingLine").textContent = typing ? "Typing..." : "";
  });
}

async function bootstrap() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  if (!state.token) return;
  try {
    const { user } = await api("/api/me");
    state.user = user;
    showChat();
    connectSocket();
    await loadConversations();
  } catch {
    showAuth();
  }
}

async function loadConversations() {
  const { conversations } = await api("/api/conversations");
  state.conversations = conversations;
  renderConversations();
}

async function loadMessages(conversationId) {
  const { messages } = await api(`/api/conversations/${conversationId}/messages`);
  state.messages = messages;
  renderMessages();
}

function getOtherMember(conversation) {
  return conversation.members.find((member) => member.id !== state.user.id) || conversation.members[0];
}

function isOnline(userId) {
  return state.presence.find((item) => item.id === userId)?.online;
}

function renderConversations() {
  $("conversationList").innerHTML = state.conversations.map((conversation) => {
    const title = conversation.group?.name || getOtherMember(conversation)?.displayName || "Chat";
    const other = getOtherMember(conversation);
    const status = conversation.group ? `${conversation.members.length} members` : (isOnline(other?.id) ? "Online" : "Offline");
    const last = conversation.lastMessage?.media ? `[${conversation.lastMessage.media.kind}]` : conversation.lastMessage?.text || "No messages yet";
    return `
      <button class="conversation ${state.activeConversation?.id === conversation.id ? "active" : ""}" data-id="${conversation.id}" type="button">
        <span class="avatar">${title.slice(0, 1).toUpperCase()}</span>
        <span class="conversation-main">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(last)}</small>
        </span>
        <span class="status-dot ${status === "Online" ? "online" : ""}" title="${status}"></span>
      </button>`;
  }).join("");
}

function renderHeader() {
  const conversation = state.activeConversation;
  if (!conversation) return;
  const other = getOtherMember(conversation);
  const title = conversation.group?.name || other?.displayName || "Chat";
  $("chatTitle").textContent = title;
  $("chatAvatar").textContent = title.slice(0, 1).toUpperCase();
  $("chatStatus").textContent = conversation.group ? `${conversation.members.length} members` : (isOnline(other?.id) ? "Online" : "Offline");
}

function renderMessages() {
  if (!state.activeConversation) {
    $("messages").className = "messages empty-state";
    $("messages").textContent = "No conversation selected.";
    return;
  }
  $("messages").className = "messages";
  $("messages").innerHTML = state.messages.map((message) => {
    const own = message.senderId === state.user.id;
    const ticks = own ? tickLabel(message) : "";
    return `
      <article class="message ${own ? "own" : ""}">
        ${renderMedia(message.media)}
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
        <footer>
          <time>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          ${own ? `<span class="ticks ${ticks === "blue" ? "blue" : ""}">${ticks === "single" ? "✓" : "✓✓"}</span>` : ""}
          <button data-delete="${message.id}" type="button" title="Delete for me">Delete</button>
        </footer>
      </article>`;
  }).join("");
  $("messages").scrollTop = $("messages").scrollHeight;
}

function renderMedia(media) {
  if (!media) return "";
  if (media.kind === "image") return `<img class="message-image" src="${media.url}" alt="${escapeHtml(media.originalName)}">`;
  if (media.kind === "voice") return `<audio controls src="${media.url}"></audio>`;
  return `<a class="document-link" href="${media.url}" target="_blank" rel="noopener">${escapeHtml(media.originalName)}</a>`;
}

function tickLabel(message) {
  const others = state.activeConversation.participants.filter((id) => id !== state.user.id);
  if (others.every((id) => message.readBy?.includes(id))) return "blue";
  if (others.some((id) => message.deliveredTo?.includes(id))) return "double";
  return "single";
}

function notifyNewMessage(message) {
  if (document.visibilityState === "visible" || message.senderId === state.user.id || Notification.permission !== "granted") return;
  new Notification("New business chat message", { body: message.text || message.media?.originalName || "New media" });
}

async function searchUsers() {
  const q = $("searchInput").value.trim();
  if (q.length < 2) {
    $("searchResults").innerHTML = "";
    return;
  }
  const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  $("searchResults").innerHTML = users.map((user) => `
    <button class="search-result" data-user="${user.id}" type="button">
      <span class="avatar">${user.displayName.slice(0, 1).toUpperCase()}</span>
      <span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.userId)} · ${escapeHtml(user.mobile)}</small></span>
    </button>
  `).join("");
}

async function sendMediaFile(file) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed.");
  state.socket.emit("message:send", { conversationId: state.activeConversation.id, media: data.media });
}

async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    $("voiceBtn").classList.remove("recording");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.audioChunks = [];
  state.recorder = new MediaRecorder(stream);
  state.recorder.ondataavailable = (event) => state.audioChunks.push(event.data);
  state.recorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(state.audioChunks, { type: "audio/webm" });
    await sendMediaFile(new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" }));
  };
  state.recorder.start();
  $("voiceBtn").classList.add("recording");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("signupTab").addEventListener("click", () => setAuthMode("signup"));
$("logoutBtn").addEventListener("click", showAuth);
$("backBtn").addEventListener("click", () => $("chatView").classList.remove("conversation-open"));
$("searchInput").addEventListener("input", () => searchUsers().catch((error) => $("authError").textContent = error.message));
$("attachBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async (event) => {
  if (!state.activeConversation || !event.target.files[0]) return;
  await sendMediaFile(event.target.files[0]);
  event.target.value = "";
});
$("voiceBtn").addEventListener("click", () => {
  if (!state.activeConversation) return;
  toggleRecording().catch((error) => alert(error.message));
});
$("messageInput").addEventListener("input", () => {
  if (state.activeConversation) state.socket.emit("typing", { conversationId: state.activeConversation.id, typing: true });
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const { token, user } = await api("/api/login", { method: "POST", body: JSON.stringify(body) });
    state.token = token;
    state.user = user;
    localStorage.setItem("chatToken", token);
    showChat();
    connectSocket();
    await loadConversations();
    if ("Notification" in window) Notification.requestPermission();
  } catch (error) {
    $("authError").textContent = error.message;
  }
});

$("signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const { token, user } = await api("/api/signup", { method: "POST", body: JSON.stringify(body) });
    state.token = token;
    state.user = user;
    localStorage.setItem("chatToken", token);
    showChat();
    connectSocket();
    await loadConversations();
  } catch (error) {
    $("authError").textContent = error.message;
  }
});

$("conversationList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  state.activeConversation = state.conversations.find((item) => item.id === button.dataset.id);
  state.socket.emit("conversation:join", { conversationId: state.activeConversation.id });
  renderHeader();
  renderConversations();
  await loadMessages(state.activeConversation.id);
  $("chatView").classList.add("conversation-open");
});

$("searchResults").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user]");
  if (!button) return;
  const { conversation } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ userId: button.dataset.user }) });
  await loadConversations();
  state.activeConversation = state.conversations.find((item) => item.id === conversation.id) || conversation;
  state.socket.emit("conversation:join", { conversationId: conversation.id });
  renderHeader();
  await loadMessages(conversation.id);
  $("searchResults").innerHTML = "";
  $("searchInput").value = "";
  $("chatView").classList.add("conversation-open");
});

$("messages").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  await api(`/api/messages/${button.dataset.delete}/delete-for-me`, { method: "POST" });
  state.messages = state.messages.filter((message) => message.id !== button.dataset.delete);
  renderMessages();
});

$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.activeConversation) return;
  const text = $("messageInput").value;
  if (!text.trim()) return;
  state.socket.emit("message:send", { conversationId: state.activeConversation.id, text });
  $("messageInput").value = "";
});

bootstrap();
