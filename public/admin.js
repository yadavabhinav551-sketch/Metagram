const adminState = {
  token: localStorage.getItem("adminToken"),
  users: [],
  conversations: [],
  groups: [],
  settings: { secretCodeLoginEnabled: false, updateNotify: { enabled: false, version: 1, message: "" } },
  activeConversationId: null,
  socket: null,
  installPrompt: null,
  revealedHiddenCodes: new Set(),
  revealedPrivacyCodes: new Set()
};

const $ = (id) => document.getElementById(id);
const adminApi = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(adminState.token ? { Authorization: `Bearer ${adminState.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
};

function showAdminApp() {
  $("adminLogin").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
  $("exportLink").setAttribute("href", `/api/admin/export?token=${encodeURIComponent(adminState.token)}`);
}

function registerAdminPwa() {
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

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
}

function showInstallHelp() {
  alert("Chrome menu open karo, phir Install app ya Add to Home screen par tap karo. Admin app direct admin section se open hoga.");
}

async function loadOverview() {
  const data = await adminApi("/api/admin/overview");
  adminState.users = data.users;
  adminState.conversations = data.conversations;
  adminState.groups = data.groups;
  adminState.settings = data.settings || { secretCodeLoginEnabled: false, updateNotify: { enabled: false, version: 1, message: "" } };
  renderUsers();
  renderConversations();
  renderGroupMembers();
  renderSettings();
}

function renderSettings() {
  $("secretCodeLoginToggle").checked = Boolean(adminState.settings.secretCodeLoginEnabled);
  const updateNotify = adminState.settings.updateNotify || {};
  $("updateNotifyToggle").checked = Boolean(updateNotify.enabled);
  $("updateNotifyMessage").value = updateNotify.message || "Please update the app to continue.";
  const updatedAt = updateNotify.updatedAt ? new Date(updateNotify.updatedAt).toLocaleString() : "not sent yet";
  $("updateNotifyStatus").textContent = `Version ${updateNotify.version || 1} · ${updatedAt}`;
}

function formatLastSeen(value) {
  if (!value) return "Offline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Offline";
  const now = new Date();
  const today = now.toDateString() === date.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (today) return `last seen today at ${time}`;
  if (yesterday.toDateString() === date.toDateString()) return `last seen yesterday at ${time}`;
  return `last seen ${date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })} at ${time}`;
}

function userPresenceLabel(user) {
  return user.online ? "Online now" : formatLastSeen(user.lastSeenAt);
}

function avatarMarkup(user) {
  const label = user?.displayName || user?.userId || "User";
  if (user?.avatarUrl) return `<span class="avatar admin-avatar"><img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(label)}"></span>`;
  return `<span class="avatar admin-avatar">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`;
}

function renderUsers() {
  $("adminUsers").innerHTML = adminState.users.map((user) => `
    <div class="admin-item">
      ${avatarMarkup(user)}
      <strong>${escapeHtml(user.displayName)}</strong>
      ${user.statusText ? `<small class="admin-status-line">Status: ${escapeHtml(user.statusText)}</small>` : ""}
      <small>${escapeHtml(user.userId)} · ${escapeHtml(user.mobile)}</small>
      <small>${user.deleted ? "Deleted" : user.blocked ? "Blocked" : user.suspended ? "Suspended" : "Active"}</small>
      <small class="presence-line ${user.online ? "online" : ""}">${escapeHtml(userPresenceLabel(user))}</small>
      ${renderHiddenChatAudit(user)}
      ${renderPrivacyCodeAudit(user)}
      <div class="admin-actions">
        <button data-user-action="id" data-id="${user.id}" type="button">Change ID</button>
        <button data-user-action="password" data-id="${user.id}" type="button">Password</button>
        <button data-user-action="privacy-code" data-id="${user.id}" type="button">Calculator Code</button>
        <button data-user-action="blocked" data-id="${user.id}" type="button">${user.blocked ? "Unblock" : "Block"}</button>
        <button class="danger" data-user-action="deleted" data-id="${user.id}" type="button">${user.deleted ? "Restore" : "Delete"}</button>
        ${user.deleted ? `<button class="danger" data-user-action="remove" data-id="${user.id}" type="button">Remove</button>` : ""}
      </div>
    </div>
  `).join("");
}

function renderHiddenChatAudit(user) {
  if (!user.hiddenChatSecret && !user.hiddenChatCount) return "";
  const hiddenUsers = (user.hiddenChatUsers || []).map((item) => item.displayName || item.userId).join(", ");
  const isRevealed = adminState.revealedHiddenCodes.has(user.id);
  const code = user.hiddenChatSecret || "Not set";
  return `
    <div class="hidden-audit">
      <div class="hidden-code-row">
        <small><strong>Hidden code:</strong> ${escapeHtml(isRevealed ? code : "******")}</small>
        ${user.hiddenChatSecret ? `<button data-user-action="hidden-code-toggle" data-id="${user.id}" type="button">${isRevealed ? "Hide" : "Show"}</button>` : ""}
      </div>
      <small><strong>Hidden chats:</strong> ${user.hiddenChatCount || 0}${hiddenUsers ? ` · ${escapeHtml(hiddenUsers)}` : ""}</small>
    </div>
  `;
}

function renderPrivacyCodeAudit(user) {
  const isRevealed = adminState.revealedPrivacyCodes.has(user.id);
  const hasKnownCode = Boolean(user.privacyUnlockCode);
  const hasCode = Boolean(user.hasPrivacyUnlockCode);
  const status = hasKnownCode
    ? (isRevealed ? user.privacyUnlockCode : "******")
    : hasCode ? "Set (reset to view)" : "Not set";
  return `
    <div class="hidden-audit">
      <div class="hidden-code-row">
        <small><strong>Calculator lock:</strong> ${escapeHtml(status)}</small>
        ${hasKnownCode ? `<button data-user-action="privacy-code-toggle" data-id="${user.id}" type="button">${isRevealed ? "Hide" : "Show"}</button>` : ""}
      </div>
      <small><strong>Status:</strong> ${user.privacyMode?.enabled && hasCode ? "Enabled" : hasCode ? "Code set, disabled" : "No code"}</small>
    </div>
  `;
}

function renderConversations() {
  $("adminConversations").innerHTML = adminState.conversations.map((conversation) => {
    const title = conversation.group?.name || conversation.members.filter(Boolean).map((user) => user.displayName).join(" ↔ ");
    return `
      <button class="admin-item" data-conversation="${conversation.id}" type="button">
        <strong>${escapeHtml(title || "Conversation")}</strong>
        <small>${conversation.messageCount} messages</small>
      </button>`;
  }).join("");
}

function renderGroupMembers() {
  $("groupMembers").innerHTML = adminState.users
    .filter((user) => !user.deleted)
    .map((user) => `<option value="${user.id}">${escapeHtml(user.displayName)} (${escapeHtml(user.userId)})</option>`)
    .join("");
}

async function loadTranscript(conversationId) {
  adminState.activeConversationId = conversationId;
  const conversation = adminState.conversations.find((item) => item.id === conversationId);
  const title = conversation.group?.name || conversation.members.filter(Boolean).map((user) => user.displayName).join(" ↔ ");
  $("transcriptTitle").textContent = title || "Transcript";
  $("clearTranscriptBtn").disabled = false;
  const { messages } = await adminApi(`/api/admin/conversations/${conversationId}/messages`);
  $("adminMessages").innerHTML = messages.map((message) => {
    const sender = adminState.users.find((user) => user.id === message.senderId);
    return `
      <article class="admin-message">
        <strong>${escapeHtml(sender?.displayName || "Unknown")}</strong>
        <small>${new Date(message.createdAt).toLocaleString()} · hidden for ${message.deletedFor?.length || 0} users</small>
        ${renderAdminFlags(message)}
        ${renderAdminReply(message.replyTo)}
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
        ${renderAdminMedia(message.media)}
        ${renderAdminReactions(message)}
      </article>`;
  }).join("") || "No messages.";
}

async function clearActiveTranscript() {
  const conversationId = adminState.activeConversationId;
  if (!conversationId) return;
  const conversation = adminState.conversations.find((item) => item.id === conversationId);
  const title = conversation?.group?.name || conversation?.members?.filter(Boolean).map((user) => user.displayName).join(" ↔ ") || "this chat";
  if (!confirm(`Clear all messages from ${title}? This will remove them for every user.`)) return;
  $("clearTranscriptBtn").disabled = true;
  try {
    await adminApi(`/api/admin/conversations/${conversationId}/messages`, { method: "DELETE" });
    await loadOverview();
    await loadTranscript(conversationId);
  } catch (error) {
    alert(error.message);
  } finally {
    $("clearTranscriptBtn").disabled = false;
  }
}

function renderAdminReply(replyTo) {
  if (!replyTo) return "";
  return `
    <div class="admin-reply">
      <strong>Reply to ${escapeHtml(replyTo.senderName || "User")}</strong>
      <span>${escapeHtml(replyTo.text || replyTo.mediaName || "Message")}</span>
    </div>
  `;
}

function renderAdminFlags(message) {
  if (!message.adminOnly) return "";
  return `<span class="admin-message-flag">Admin only call recording</span>`;
}

function renderAdminReactions(message) {
  const reactions = Object.entries(message.reactions || {});
  if (!reactions.length) return "";
  return `
    <div class="admin-reactions">
      ${reactions.map(([userId, emoji]) => {
        const user = adminState.users.find((item) => item.id === userId);
        return `<span>${escapeHtml(emoji)} ${escapeHtml(user?.displayName || user?.userId || "User")}</span>`;
      }).join("")}
    </div>
  `;
}

function renderAdminMedia(media) {
  if (!media) return "";
  const fileLink = `<a class="admin-media-link" href="${media.url}" target="_blank" rel="noopener" download="${escapeHtml(media.originalName || "media")}">${escapeHtml(media.originalName || "Download media")}</a>`;
  if (media.kind === "image") return `<div class="admin-media"><img src="${media.url}" alt="${escapeHtml(media.originalName)}">${fileLink}</div>`;
  if (media.kind === "audio" || media.kind === "voice") return `<div class="admin-media"><audio controls preload="metadata" src="${media.url}"></audio>${fileLink}</div>`;
  if (media.kind === "video") return `<div class="admin-media"><video controls preload="metadata" src="${media.url}"></video>${fileLink}</div>`;
  return `<a href="${media.url}" target="_blank" rel="noopener">${escapeHtml(media.originalName)}</a>`;
}

async function updateUser(id, patch) {
  await adminApi(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  await loadOverview();
}

function connectAdminSocket() {
  adminState.socket?.disconnect();
  adminState.socket = io({ auth: { token: adminState.token } });
  adminState.socket.on("connect", () => adminState.socket.emit("admin:join"));
  adminState.socket.on("admin:message", async () => {
    await loadOverview();
    if (adminState.activeConversationId) await loadTranscript(adminState.activeConversationId);
  });
  adminState.socket.on("admin:conversation-cleared", async ({ conversationId }) => {
    await loadOverview();
    if (adminState.activeConversationId === conversationId) await loadTranscript(conversationId);
  });
  adminState.socket.on("presence", (presence = []) => {
    const presenceById = new Map(presence.map((item) => [item.id, item]));
    adminState.users = adminState.users.map((user) => ({ ...user, ...(presenceById.get(user.id) || {}) }));
    renderUsers();
  });
}

$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const { token } = await adminApi("/api/admin/login", { method: "POST", body: JSON.stringify(body) });
    adminState.token = token;
    localStorage.setItem("adminToken", token);
    showAdminApp();
    connectAdminSocket();
    await loadOverview();
  } catch (error) {
    $("adminError").textContent = error.message;
  }
});

$("adminUsers").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-action]");
  if (!button) return;
  const user = adminState.users.find((item) => item.id === button.dataset.id);
  if (!user) return;
  const action = button.dataset.userAction;
  if (action === "id") {
    const userId = prompt("New User ID", user.userId);
    if (userId) await updateUser(user.id, { userId });
  }
  if (action === "password") {
    const password = prompt("New password");
    if (password) await updateUser(user.id, { password });
  }
  if (action === "privacy-code") {
    const privacyCode = prompt("New 6-digit calculator lock code", user.privacyUnlockCode || "");
    if (privacyCode === null) return;
    if (!/^\d{6}$/.test(privacyCode.trim())) {
      alert("Calculator lock code exactly 6 digits ka hona chahiye.");
      return;
    }
    await updateUser(user.id, { privacyCode: privacyCode.trim() });
    adminState.revealedPrivacyCodes.add(user.id);
    renderUsers();
  }
  if (action === "hidden-code-toggle") {
    if (adminState.revealedHiddenCodes.has(user.id)) adminState.revealedHiddenCodes.delete(user.id);
    else adminState.revealedHiddenCodes.add(user.id);
    renderUsers();
  }
  if (action === "privacy-code-toggle") {
    if (adminState.revealedPrivacyCodes.has(user.id)) adminState.revealedPrivacyCodes.delete(user.id);
    else adminState.revealedPrivacyCodes.add(user.id);
    renderUsers();
  }
  if (action === "blocked") await updateUser(user.id, { blocked: !user.blocked });
  if (action === "deleted") await updateUser(user.id, { deleted: !user.deleted });
  if (action === "remove") {
    if (!confirm(`Permanently remove ${user.displayName} from the users section? This cannot be undone.`)) return;
    await adminApi(`/api/admin/users/${user.id}/permanent`, { method: "DELETE" });
    await loadOverview();
  }
});

$("adminConversations").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-conversation]");
  if (button) await loadTranscript(button.dataset.conversation);
});

$("clearTranscriptBtn").addEventListener("click", clearActiveTranscript);

$("adminLogoutBtn").addEventListener("click", () => {
  adminState.socket?.disconnect();
  adminState.token = null;
  localStorage.removeItem("adminToken");
  $("adminApp").classList.add("hidden");
  $("adminLogin").classList.remove("hidden");
  $("adminLoginForm").reset();
  $("adminError").textContent = "";
});

$("credentialsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target));
  await adminApi("/api/admin/credentials", { method: "POST", body: JSON.stringify(body) });
  event.target.reset();
  alert("Admin credentials updated.");
});

$("secretCodeLoginToggle").addEventListener("change", async (event) => {
  const enabled = event.target.checked;
  $("settingsMessage").textContent = "Saving...";
  try {
    const { settings } = await adminApi("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ secretCodeLoginEnabled: enabled })
    });
    adminState.settings = settings;
    renderSettings();
    $("settingsMessage").textContent = enabled ? "Secret code login enabled." : "Secret code login disabled.";
  } catch (error) {
    event.target.checked = !enabled;
    $("settingsMessage").textContent = error.message;
  }
});

async function saveUpdateNotify({ bumpVersion = false } = {}) {
  const enabled = $("updateNotifyToggle").checked;
  const message = $("updateNotifyMessage").value.trim() || "Please update the app to continue.";
  $("settingsMessage").textContent = "Saving...";
  try {
    const { settings } = await adminApi("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        updateNotify: {
          enabled,
          message,
          bumpVersion
        }
      })
    });
    adminState.settings = settings;
    renderSettings();
    $("settingsMessage").textContent = enabled
      ? (bumpVersion ? "Update notify sent to users." : "Update notify saved.")
      : "Update notify disabled.";
  } catch (error) {
    $("settingsMessage").textContent = error.message;
  }
}

$("saveUpdateNotifyBtn").addEventListener("click", () => {
  saveUpdateNotify().catch((error) => {
    $("settingsMessage").textContent = error.message;
  });
});

$("sendUpdateNotifyBtn").addEventListener("click", () => {
  $("updateNotifyToggle").checked = true;
  saveUpdateNotify({ bumpVersion: true }).catch((error) => {
    $("settingsMessage").textContent = error.message;
  });
});

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const memberIds = Array.from($("groupMembers").selectedOptions).map((option) => option.value);
  const name = new FormData(event.target).get("name");
  await adminApi("/api/admin/groups", { method: "POST", body: JSON.stringify({ name, memberIds }) });
  event.target.reset();
  await loadOverview();
});

document.querySelectorAll(".install-control").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!adminState.installPrompt) {
      showInstallHelp();
      return;
    }
    adminState.installPrompt.prompt();
    await adminState.installPrompt.userChoice;
    adminState.installPrompt = null;
    setInstallButtonsVisible(true);
  });
});

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

if (adminState.token) {
  showAdminApp();
  connectAdminSocket();
  loadOverview().catch(() => {
    localStorage.removeItem("adminToken");
    location.reload();
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  adminState.installPrompt = event;
  setInstallButtonsVisible(true);
});

window.addEventListener("appinstalled", () => {
  adminState.installPrompt = null;
  setInstallButtonsVisible(false);
});

registerAdminPwa();
setInstallButtonsVisible(true);
