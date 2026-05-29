const adminState = {
  token: localStorage.getItem("adminToken"),
  users: [],
  conversations: [],
  groups: [],
  socket: null,
  installPrompt: null,
  revealedHiddenCodes: new Set()
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
    button.classList.toggle("hidden", isStandaloneApp() || !visible);
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
  renderUsers();
  renderConversations();
  renderGroupMembers();
}

function renderUsers() {
  $("adminUsers").innerHTML = adminState.users.map((user) => `
    <div class="admin-item">
      <strong>${escapeHtml(user.displayName)}</strong>
      <small>${escapeHtml(user.userId)} · ${escapeHtml(user.mobile)}</small>
      <small>${user.deleted ? "Deleted" : user.blocked ? "Blocked" : user.suspended ? "Suspended" : "Active"}</small>
      ${renderHiddenChatAudit(user)}
      <div class="admin-actions">
        <button data-user-action="id" data-id="${user.id}" type="button">Change ID</button>
        <button data-user-action="password" data-id="${user.id}" type="button">Password</button>
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
  const conversation = adminState.conversations.find((item) => item.id === conversationId);
  const title = conversation.group?.name || conversation.members.filter(Boolean).map((user) => user.displayName).join(" ↔ ");
  $("transcriptTitle").textContent = title || "Transcript";
  const { messages } = await adminApi(`/api/admin/conversations/${conversationId}/messages`);
  $("adminMessages").innerHTML = messages.map((message) => {
    const sender = adminState.users.find((user) => user.id === message.senderId);
    return `
      <article class="admin-message">
        <strong>${escapeHtml(sender?.displayName || "Unknown")}</strong>
        <small>${new Date(message.createdAt).toLocaleString()} · hidden for ${message.deletedFor?.length || 0} users</small>
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
        ${renderAdminMedia(message.media)}
      </article>`;
  }).join("") || "No messages.";
}

function renderAdminMedia(media) {
  if (!media) return "";
  if (media.kind === "image") return `<img src="${media.url}" alt="${escapeHtml(media.originalName)}">`;
  if (media.kind === "audio" || media.kind === "voice") return `<audio controls preload="metadata" src="${media.url}"></audio>`;
  if (media.kind === "video") return `<video controls preload="metadata" src="${media.url}"></video>`;
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
  adminState.socket.on("admin:message", () => loadOverview());
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
  if (action === "hidden-code-toggle") {
    if (adminState.revealedHiddenCodes.has(user.id)) adminState.revealedHiddenCodes.delete(user.id);
    else adminState.revealedHiddenCodes.add(user.id);
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

$("credentialsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target));
  await adminApi("/api/admin/credentials", { method: "POST", body: JSON.stringify(body) });
  event.target.reset();
  alert("Admin credentials updated.");
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
