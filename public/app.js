const state = {
  token: localStorage.getItem("chatToken"),
  user: null,
  socket: null,
  conversations: [],
  activeConversation: null,
  messages: [],
  presence: [],
  recorder: null,
  audioChunks: [],
  installPrompt: null,
  selectionMode: false,
  selectedMessageIds: new Set(),
  pendingShare: null,
  shareRecipients: new Map(),
  hiddenConversations: [],
  unlockedHiddenCode: ""
};

const $ = (id) => document.getElementById(id);
const EMOJI_OPTIONS = [
  "\u{1F600}", "\u{1F602}", "\u{1F60A}", "\u{1F60D}", "\u{1F618}", "\u{1F60E}",
  "\u{1F973}", "\u{1F622}", "\u{1F621}", "\u{1F64F}", "\u{1F44D}", "\u{1F44E}",
  "\u{1F44F}", "\u{1F525}", "\u2764\uFE0F", "\u{1F494}", "\u2705", "\u{1F389}",
  "\u{1F4AF}", "\u2728", "\u{1F634}", "\u{1F914}", "\u{1F62E}", "\u{1F62D}",
  "\u{1F607}", "\u{1F609}", "\u{1F60B}", "\u{1F91D}", "\u{1F64C}", "\u{1F44C}"
];
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
  $("profileName").value = state.user.displayName;
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
  state.socket.on("message:deleted", ({ messageId, conversationId, deletedFor }) => {
    if (conversationId !== state.activeConversation?.id || !deletedFor?.includes(state.user.id)) return;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    state.selectedMessageIds.delete(messageId);
    renderMessages();
    updateBulkActions();
  });
  state.socket.on("typing", ({ conversationId, userId, typing }) => {
    if (conversationId !== state.activeConversation?.id || userId === state.user.id) return;
    $("typingLine").textContent = typing ? "Typing..." : "";
  });
  state.socket.on("account:disabled", ({ reason } = {}) => {
    alert(reason || "Your account is not active.");
    showAuth();
  });
}

async function bootstrap() {
  registerPwa();
  showPendingShareError();
  if (!state.token) {
    showPendingShareLoginHint();
    return;
  }
  try {
    const { user } = await api("/api/me");
    state.user = user;
    showChat();
    connectSocket();
    await loadConversations();
    await loadPendingShare();
  } catch {
    showAuth();
  }
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }
}

function setInstallButtonsVisible(visible) {
  document.querySelectorAll(".install-control").forEach((button) => {
    button.classList.toggle("hidden", !visible);
  });
}

async function loadConversations() {
  const { conversations } = await api("/api/conversations");
  state.conversations = conversations;
  renderConversations();
}

function getPendingShareId() {
  return new URLSearchParams(location.search).get("share");
}

function showPendingShareLoginHint() {
  if (getPendingShareId()) {
    $("authError").textContent = "Shared content ready hai. Send karne ke liye login karein.";
  }
}

function showPendingShareError() {
  const shareError = new URLSearchParams(location.search).get("shareError");
  if (shareError) {
    $("authError").textContent = shareError;
    history.replaceState({}, "", location.pathname);
  }
}

async function loadPendingShare() {
  const shareId = getPendingShareId();
  if (!shareId) return;
  try {
    const { sharedItem } = await api(`/api/shared/${encodeURIComponent(shareId)}`);
    state.pendingShare = sharedItem;
    history.replaceState({}, "", location.pathname);
    showShareModal();
  } catch (error) {
    $("authError").textContent = error.message;
  }
}

async function loadMessages(conversationId) {
  const { messages } = await api(`/api/conversations/${conversationId}/messages`);
  state.messages = messages;
  renderMessages();
}

function getOtherMember(conversation) {
  return conversation.members?.find((member) => member.id !== state.user.id) || conversation.members?.[0];
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
  $("selectMessagesBtn").disabled = !conversation;
  $("clearChatBtn").disabled = !conversation;
  $("hideChatBtn").classList.add("hidden");
  if (!conversation) return;
  const other = getOtherMember(conversation);
  const title = conversation.group?.name || other?.displayName || "Chat";
  $("chatTitle").textContent = title;
  $("chatAvatar").textContent = title.slice(0, 1).toUpperCase();
  $("chatStatus").textContent = conversation.group ? `${conversation.members.length} members` : (isOnline(other?.id) ? "Online" : "Offline");
  if (!conversation.groupId && other?.id) {
    $("hideChatBtn").classList.remove("hidden");
    $("hideChatBtn").textContent = conversation.hidden ? "Unhide" : "Hide";
  }
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
    const selected = state.selectedMessageIds.has(message.id);
    const canDeleteEveryone = own && Date.now() - new Date(message.createdAt).getTime() <= 5 * 60 * 1000;
    return `
      <article class="message ${own ? "own" : ""} ${selected ? "selected" : ""}" data-message="${message.id}">
        ${state.selectionMode ? `<label class="message-select"><input type="checkbox" data-select-message="${message.id}" ${selected ? "checked" : ""}> Select</label>` : ""}
        ${renderMedia(message.media)}
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
        <footer>
          <time>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          ${own ? `<span class="ticks ${ticks === "blue" ? "blue" : ""}">${ticks === "single" ? "✓" : "✓✓"}</span>` : ""}
          <button data-delete="${message.id}" type="button" title="Delete for me">Delete</button>
          ${canDeleteEveryone ? `<button data-delete-everyone="${message.id}" type="button" title="Delete for everyone">Everyone</button>` : ""}
        </footer>
      </article>`;
  }).join("");
  $("messages").scrollTop = $("messages").scrollHeight;
  updateBulkActions();
}

function updateBulkActions() {
  $("bulkActions").classList.toggle("hidden", !state.selectionMode);
  $("selectedCount").textContent = `${state.selectedMessageIds.size} selected`;
  $("selectMessagesBtn").textContent = state.selectionMode ? "Selecting" : "Select";
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  renderMessages();
}

function renderMedia(media) {
  if (!media) return "";
  const meta = media.size ? `<small>${escapeHtml(formatFileSize(media.size))}</small>` : "";
  if (media.kind === "image") {
    return `
      <div class="media-card image-card">
        <img class="message-image" src="${media.url}" alt="${escapeHtml(media.originalName)}">
        <a href="${media.url}" download="${escapeHtml(media.originalName)}">${escapeHtml(media.originalName || "Image")}</a>
        ${meta}
      </div>
    `;
  }
  if (media.kind === "audio" || media.kind === "voice") {
    return `
      <div class="media-card">
        <audio controls preload="metadata" src="${media.url}"></audio>
        <a href="${media.url}" download="${escapeHtml(media.originalName)}">${escapeHtml(media.originalName)}</a>
        ${meta}
      </div>
    `;
  }
  if (media.kind === "video") {
    return `
      <div class="media-card">
        <video class="message-video" controls preload="metadata" src="${media.url}"></video>
        <a href="${media.url}" download="${escapeHtml(media.originalName)}">${escapeHtml(media.originalName)}</a>
        ${meta}
      </div>
    `;
  }
  return `<a class="document-link" href="${media.url}" target="_blank" rel="noopener">${escapeHtml(media.originalName)}</a>`;
}

function showShareModal() {
  if (!state.pendingShare) return;
  state.shareRecipients.clear();
  $("shareMessage").textContent = "";
  $("shareSearchInput").value = "";
  $("sharePreview").innerHTML = renderSharePreview();
  $("shareModal").classList.remove("hidden");
  renderShareRecipients();
}

function renderSharePreview() {
  const item = state.pendingShare;
  const text = item.text ? `<p>${escapeHtml(item.text)}</p>` : "";
  const files = (item.media || []).map((media) => `
    <div class="share-file">
      <strong>${escapeHtml(media.originalName || "Shared file")}</strong>
      <span>${escapeHtml(media.kind || "file")}${media.size ? ` · ${formatFileSize(media.size)}` : ""}</span>
    </div>
  `).join("");
  return `${text}${files || (!text ? "<p>No preview available.</p>" : "")}`;
}

function renderShareRecipients(extraUsers = []) {
  const rows = [];
  for (const conversation of state.conversations) {
    if (conversation.groupId) continue;
    const other = getOtherMember(conversation);
    if (!other) continue;
    rows.push({
      key: `user:${other.id}`,
      label: other.displayName,
      sub: other.userId || other.mobile,
      value: { conversationId: conversation.id, userId: other.id }
    });
  }
  for (const user of extraUsers) {
    if (user.id === state.user.id) continue;
    if (rows.some((row) => row.key === `user:${user.id}`)) continue;
    rows.push({
      key: `user:${user.id}`,
      label: user.displayName,
      sub: user.userId || user.mobile,
      value: { userId: user.id }
    });
  }
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.key, row])).values());
  $("shareRecipients").innerHTML = uniqueRows.map((row) => `
    <label class="share-recipient">
      <input type="checkbox" data-share-key="${escapeHtml(row.key)}" ${state.shareRecipients.has(row.key) ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(row.label)}</strong>
        <small>${escapeHtml(row.sub || "")}</small>
      </span>
    </label>
  `).join("") || "<p>Search a user to send.</p>";
  $("shareRecipients").querySelectorAll("[data-share-key]").forEach((input) => {
    const row = uniqueRows.find((item) => item.key === input.dataset.shareKey);
    input.addEventListener("change", () => {
      if (input.checked) state.shareRecipients.set(row.key, row.value);
      else state.shareRecipients.delete(row.key);
    });
  });
}

async function sendPendingShare() {
  if (!state.pendingShare) return;
  const recipients = Array.from(state.shareRecipients.values());
  if (!recipients.length) {
    $("shareMessage").textContent = "Select at least one user.";
    return;
  }
  $("sendShareBtn").disabled = true;
  try {
    for (const recipient of recipients) {
      let conversationId = recipient.conversationId;
      if (!conversationId) {
        const { conversation } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ userId: recipient.userId }) });
        conversationId = conversation.id;
      }
      if (state.pendingShare.text) {
        state.socket.emit("message:send", { conversationId, text: state.pendingShare.text });
      }
      for (const media of state.pendingShare.media || []) {
        state.socket.emit("message:send", { conversationId, media });
      }
    }
    await api(`/api/shared/${encodeURIComponent(state.pendingShare.id)}`, { method: "DELETE" });
    state.pendingShare = null;
    $("shareModal").classList.add("hidden");
    await loadConversations();
  } catch (error) {
    $("shareMessage").textContent = error.message;
  } finally {
    $("sendShareBtn").disabled = false;
  }
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
    state.hiddenConversations = [];
    state.unlockedHiddenCode = "";
    return;
  }
  if (await tryUnlockHiddenChats(q)) return;
  const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  $("searchResults").innerHTML = users.map((user) => `
    <button class="search-result" data-user="${user.id}" type="button">
      <span class="avatar">${user.displayName.slice(0, 1).toUpperCase()}</span>
      <span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.userId)} · ${escapeHtml(user.mobile)}${user.hidden ? " · hidden" : ""}</small></span>
    </button>
  `).join("");
}

async function tryUnlockHiddenChats(code) {
  if (!state.user?.hasHiddenChatSecret) return false;
  try {
    const { conversations } = await api(`/api/conversations/hidden?code=${encodeURIComponent(code)}`);
    state.hiddenConversations = conversations;
    state.unlockedHiddenCode = code;
    $("searchResults").innerHTML = renderHiddenVault(conversations);
    return true;
  } catch {
    state.hiddenConversations = [];
    state.unlockedHiddenCode = "";
    return false;
  }
}

function renderHiddenVault(conversations) {
  return `
      <div class="hidden-vault-title">
        <strong>Hidden chats unlocked</strong>
        <small>${conversations.length} hidden chat${conversations.length === 1 ? "" : "s"}</small>
      </div>
      <div class="hidden-code-change">
        <input id="oldHiddenCodeInput" type="password" autocomplete="current-password" placeholder="Old secret code">
        <input id="newHiddenCodeInput" type="password" autocomplete="new-password" placeholder="New secret code">
        <button class="text-button" data-change-hidden-code type="button">Change code</button>
        <small id="hiddenCodeMessage"></small>
      </div>
      ${conversations.map((conversation) => {
        const other = getOtherMember(conversation);
        const title = other?.displayName || "Hidden chat";
        const last = conversation.lastMessage?.media ? `[${conversation.lastMessage.media.kind}]` : conversation.lastMessage?.text || "No messages yet";
        return `
          <button class="search-result hidden-result" data-hidden-conversation="${conversation.id}" type="button">
            <span class="avatar">${title.slice(0, 1).toUpperCase()}</span>
            <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(last)}</small></span>
          </button>`;
      }).join("") || `<p class="hidden-vault-empty">No hidden chats yet.</p>`}
    `;
}

function requestHiddenChatSecret() {
  const generated = `lock-${Math.floor(1000 + Math.random() * 9000)}`;
  const secret = prompt("Create secret code for hidden chats. Search bar me ye code dalne par hidden chats dikhenge.", generated);
  if (secret === null) return null;
  const trimmed = secret.trim();
  if (trimmed.length < 4) {
    alert("Secret code kam se kam 4 characters ka hona chahiye.");
    return null;
  }
  return trimmed;
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

function formatFileSize(bytes = 0) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function renderEmojiPicker() {
  $("emojiPicker").innerHTML = EMOJI_OPTIONS.map((emoji) => `
    <button type="button" data-emoji="${emoji}" title="${emoji}">${emoji}</button>
  `).join("");
}

function setUploadStatus(text = "") {
  $("uploadStatus").textContent = text;
  $("uploadStatus").classList.toggle("hidden", !text);
}

function insertEmoji(emoji) {
  const input = $("messageInput");
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
  const nextPosition = start + emoji.length;
  input.focus();
  input.setSelectionRange(nextPosition, nextPosition);
  if (state.activeConversation) state.socket.emit("typing", { conversationId: state.activeConversation.id, typing: true });
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("signupTab").addEventListener("click", () => setAuthMode("signup"));
$("logoutBtn").addEventListener("click", showAuth);
$("profileBtn").addEventListener("click", () => {
  $("profileName").value = state.user.displayName;
  $("profileMessage").textContent = "";
  $("profileMessage").classList.remove("success-text");
  $("profileModal").classList.remove("hidden");
});
$("closeProfileBtn").addEventListener("click", () => $("profileModal").classList.add("hidden"));
document.querySelectorAll(".install-control").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    setInstallButtonsVisible(false);
  });
});
$("backBtn").addEventListener("click", () => $("chatView").classList.remove("conversation-open"));
$("selectMessagesBtn").addEventListener("click", () => {
  if (!state.activeConversation) return;
  state.selectionMode = !state.selectionMode;
  if (!state.selectionMode) state.selectedMessageIds.clear();
  renderMessages();
});
$("cancelSelectBtn").addEventListener("click", exitSelectionMode);
$("bulkDeleteBtn").addEventListener("click", async () => {
  if (!state.selectedMessageIds.size) return;
  await api("/api/messages/bulk-delete-for-me", { method: "POST", body: JSON.stringify({ ids: [...state.selectedMessageIds] }) });
  state.messages = state.messages.filter((message) => !state.selectedMessageIds.has(message.id));
  exitSelectionMode();
  await loadConversations();
});
$("clearChatBtn").addEventListener("click", async () => {
  if (!state.activeConversation || !confirm("Clear this chat from your screen")) return;
  await api(`/api/conversations/${state.activeConversation.id}/clear-for-me`, { method: "POST" });
  state.messages = [];
  renderMessages();
  await loadConversations();
});
$("hideChatBtn").addEventListener("click", async () => {
  if (!state.activeConversation || state.activeConversation.groupId) return;
  const action = state.activeConversation.hidden ? "unhide-user" : "hide-user";
  const body = {};
  if (action === "hide-user" && !state.user.hasHiddenChatSecret) {
    const secretCode = requestHiddenChatSecret();
    if (!secretCode) return;
    body.secretCode = secretCode;
    alert(`Secret code saved: ${secretCode}\nSearch bar me ye code dalne se hidden chats unlock honge.`);
  }
  const { user } = await api(`/api/conversations/${state.activeConversation.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
  if (user) state.user = user;
  state.activeConversation.hidden = !state.activeConversation.hidden;
  renderHeader();
  await loadConversations();
  if (state.activeConversation.hidden) {
    state.activeConversation = null;
    state.messages = [];
    renderHeader();
    renderMessages();
    $("chatView").classList.remove("conversation-open");
  }
});
$("searchInput").addEventListener("input", () => searchUsers().catch((error) => $("authError").textContent = error.message));
$("attachBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async (event) => {
  if (!state.activeConversation || !event.target.files.length) return;
  const files = Array.from(event.target.files);
  $("attachBtn").disabled = true;
  $("messageForm").classList.add("uploading");
  try {
    for (const [index, file] of files.entries()) {
      setUploadStatus(`Uploading ${index + 1}/${files.length}: ${file.name}`);
      await sendMediaFile(file);
    }
    setUploadStatus("Media sent.");
    setTimeout(() => setUploadStatus(""), 1600);
  } catch (error) {
    setUploadStatus("");
    alert(error.message);
  } finally {
    $("attachBtn").disabled = false;
    $("messageForm").classList.remove("uploading");
    event.target.value = "";
  }
});
$("emojiBtn").addEventListener("click", () => {
  $("emojiPicker").classList.toggle("hidden");
});
$("emojiPicker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-emoji]");
  if (!button) return;
  insertEmoji(button.dataset.emoji);
  $("emojiPicker").classList.add("hidden");
});
$("shareSearchInput").addEventListener("input", async () => {
  const q = $("shareSearchInput").value.trim();
  if (q.length < 2) {
    renderShareRecipients();
    return;
  }
  try {
    const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderShareRecipients(users);
  } catch (error) {
    $("shareMessage").textContent = error.message;
  }
});
$("sendShareBtn").addEventListener("click", () => sendPendingShare());
$("closeShareBtn").addEventListener("click", () => {
  $("shareModal").classList.add("hidden");
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
    await loadPendingShare();
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
    await loadPendingShare();
  } catch (error) {
    $("authError").textContent = error.message;
  }
});

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const body = {
    displayName: form.get("displayName"),
    oldPassword: form.get("oldPassword"),
    newPassword: form.get("newPassword")
  };
  if (!body.newPassword) {
    delete body.oldPassword;
    delete body.newPassword;
  }
  try {
    const { user } = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
    state.user = user;
    showChat();
    event.target.oldPassword.value = "";
    event.target.newPassword.value = "";
    $("profileMessage").textContent = "Profile updated.";
    $("profileMessage").classList.add("success-text");
  } catch (error) {
    $("profileMessage").textContent = error.message;
    $("profileMessage").classList.remove("success-text");
  }
});

$("conversationList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  state.activeConversation = state.conversations.find((item) => item.id === button.dataset.id);
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  state.socket.emit("conversation:join", { conversationId: state.activeConversation.id });
  renderHeader();
  renderConversations();
  await loadMessages(state.activeConversation.id);
  $("chatView").classList.add("conversation-open");
});

$("searchResults").addEventListener("click", async (event) => {
  const changeCodeButton = event.target.closest("[data-change-hidden-code]");
  if (changeCodeButton) {
    const oldInput = $("oldHiddenCodeInput");
    const newInput = $("newHiddenCodeInput");
    const message = $("hiddenCodeMessage");
    const currentSecret = oldInput.value.trim();
    const newSecret = newInput.value.trim();
    message.classList.remove("success-text");
    if (!currentSecret) {
      message.textContent = "Old secret code dalna zaroori hai.";
      return;
    }
    if (newSecret.length < 4) {
      message.textContent = "Secret code kam se kam 4 characters ka hona chahiye.";
      return;
    }
    changeCodeButton.disabled = true;
    try {
      const { user } = await api("/api/me/hidden-secret", {
        method: "PATCH",
        body: JSON.stringify({ currentSecret, newSecret })
      });
      state.user = user;
      state.unlockedHiddenCode = newSecret;
      oldInput.value = "";
      newInput.value = "";
      message.textContent = "Secret code updated.";
      message.classList.add("success-text");
    } catch (error) {
      message.textContent = error.message;
    } finally {
      changeCodeButton.disabled = false;
    }
    return;
  }
  const hiddenButton = event.target.closest("[data-hidden-conversation]");
  if (hiddenButton) {
    state.activeConversation = state.hiddenConversations.find((item) => item.id === hiddenButton.dataset.hiddenConversation);
    if (!state.activeConversation) return;
    state.selectionMode = false;
    state.selectedMessageIds.clear();
    state.socket.emit("conversation:join", { conversationId: state.activeConversation.id });
    renderHeader();
    await loadMessages(state.activeConversation.id);
    $("searchResults").innerHTML = "";
    $("searchInput").value = "";
    $("chatView").classList.add("conversation-open");
    return;
  }
  const button = event.target.closest("[data-user]");
  if (!button) return;
  const { conversation } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ userId: button.dataset.user }) });
  await loadConversations();
  state.activeConversation = state.conversations.find((item) => item.id === conversation.id) || conversation;
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  state.socket.emit("conversation:join", { conversationId: conversation.id });
  renderHeader();
  await loadMessages(conversation.id);
  $("searchResults").innerHTML = "";
  $("searchInput").value = "";
  $("chatView").classList.add("conversation-open");
});

$("messages").addEventListener("click", async (event) => {
  const checkbox = event.target.closest("[data-select-message]");
  if (checkbox) {
    if (checkbox.checked) state.selectedMessageIds.add(checkbox.dataset.selectMessage);
    else state.selectedMessageIds.delete(checkbox.dataset.selectMessage);
    renderMessages();
    return;
  }
  const article = event.target.closest("[data-message]");
  if (state.selectionMode && article && !event.target.closest("button")) {
    const id = article.dataset.message;
    if (state.selectedMessageIds.has(id)) state.selectedMessageIds.delete(id);
    else state.selectedMessageIds.add(id);
    renderMessages();
    return;
  }
  const deleteEveryoneButton = event.target.closest("[data-delete-everyone]");
  if (deleteEveryoneButton) {
    if (!confirm("Delete this message for everyone?")) return;
    await api(`/api/messages/${deleteEveryoneButton.dataset.deleteEveryone}/delete-everyone`, { method: "POST" });
    state.messages = state.messages.filter((message) => message.id !== deleteEveryoneButton.dataset.deleteEveryone);
    state.selectedMessageIds.delete(deleteEveryoneButton.dataset.deleteEveryone);
    renderMessages();
    await loadConversations();
    return;
  }
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

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  setInstallButtonsVisible(true);
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  setInstallButtonsVisible(false);
});

renderEmojiPicker();
bootstrap();
