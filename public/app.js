const state = {
  token: localStorage.getItem("chatToken"),
  privacyToken: sessionStorage.getItem("privacyToken"),
  user: null,
  socket: null,
  conversations: [],
  activeConversation: null,
  messages: [],
  presence: [],
  recorder: null,
  audioChunks: [],
  videoRecorder: null,
  videoChunks: [],
  videoTimer: null,
  videoStream: null,
  cameraFacingMode: localStorage.getItem("cameraFacingMode") || "user",
  installPrompt: null,
  selectionMode: false,
  selectedMessageIds: new Set(),
  pendingShare: null,
  shareRecipients: new Map(),
  hiddenConversations: [],
  unlockedHiddenCode: "",
  calculatorExpression: "",
  calculatorJustEvaluated: false,
  privacyAutoLockTimer: null,
  privacyAwayStartedAt: Number(localStorage.getItem("privacyAwayStartedAt") || 0),
  replyToMessageId: null,
  reactionPickerMessageId: null,
  reactionLongPressTimer: null,
  call: {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    recorder: null,
    recorderStream: null,
    recorderChunks: [],
    recorderCanvas: null,
    recorderAnimation: null,
    conversationId: null,
    peerId: null,
    type: "voice",
    shouldRecord: false,
    incoming: false,
    active: false
  }
};

const $ = (id) => document.getElementById(id);
const EMOJI_OPTIONS = [
  "\u{1F600}", "\u{1F602}", "\u{1F60A}", "\u{1F60D}", "\u{1F618}", "\u{1F60E}",
  "\u{1F973}", "\u{1F622}", "\u{1F621}", "\u{1F64F}", "\u{1F44D}", "\u{1F44E}",
  "\u{1F44F}", "\u{1F525}", "\u2764\uFE0F", "\u{1F494}", "\u2705", "\u{1F389}",
  "\u{1F4AF}", "\u2728", "\u{1F634}", "\u{1F914}", "\u{1F62E}", "\u{1F62D}",
  "\u{1F607}", "\u{1F609}", "\u{1F60B}", "\u{1F91D}", "\u{1F64C}", "\u{1F44C}"
];
const DEFAULT_REACTION_EMOJIS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}"];
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(state.privacyToken ? { "X-Privacy-Token": state.privacyToken } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
};

function setAppReady() {
  document.body.classList.remove("app-booting");
}

function setAuthMode(mode) {
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("loginForm").classList.toggle("hidden", mode !== "login");
  $("signupForm").classList.toggle("hidden", mode !== "signup");
  $("authError").textContent = "";
}

function showChat() {
  $("calculatorPrivacyView").classList.add("hidden");
  $("calculatorPrivacyView").classList.remove("unlocking");
  $("authView").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  setAppReady();
  $("meName").textContent = state.user.displayName;
  $("meHandle").textContent = `${state.user.userId} · ${state.user.mobile}`;
  $("profileName").value = state.user.displayName;
  $("profileUserId").value = state.user.userId || "";
  renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
  syncPrivacySettings();
  clearPrivacyAwayLock();
}

function showAuth() {
  endCall(false);
  localStorage.removeItem("chatToken");
  sessionStorage.removeItem("privacyToken");
  state.token = null;
  state.privacyToken = null;
  state.user = null;
  state.socket?.disconnect();
  clearTimeout(state.privacyAutoLockTimer);
  clearPrivacyAwayLock();
  $("calculatorPrivacyView").classList.add("hidden");
  $("authView").classList.remove("hidden");
  $("chatView").classList.add("hidden");
  setAppReady();
}

function connectSocket() {
  state.socket?.disconnect();
  state.socket = io({ auth: { token: state.token, privacyToken: state.privacyToken } });
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
  state.socket.on("message:reaction", ({ messageId, reactions }) => {
    const message = state.messages.find((item) => item.id === messageId);
    if (message) {
      message.reactions = reactions;
      renderMessages();
    }
    loadConversations();
  });
  state.socket.on("message:deleted", ({ messageId, conversationId, deletedFor }) => {
    if (conversationId !== state.activeConversation?.id || !deletedFor?.includes(state.user.id)) return;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    state.selectedMessageIds.delete(messageId);
    renderMessages();
    updateBulkActions();
  });
  state.socket.on("conversation:cleared", ({ conversationId }) => {
    if (conversationId === state.activeConversation?.id) {
      state.messages = [];
      state.selectedMessageIds.clear();
      renderMessages();
      updateBulkActions();
    }
    loadConversations();
  });
  state.socket.on("typing", ({ conversationId, userId, typing }) => {
    if (conversationId !== state.activeConversation?.id || userId === state.user.id) return;
    $("typingLine").textContent = typing ? "Typing..." : "";
  });
  state.socket.on("account:disabled", ({ reason } = {}) => {
    alert(reason || "Your account is not active.");
    showAuth();
  });
  state.socket.on("call:incoming", ({ conversationId, fromUserId, fromName, callType = "voice" }) => {
    showIncomingCall({ conversationId, fromUserId, fromName, callType });
  });
  state.socket.on("call:accepted", async ({ conversationId, fromUserId }) => {
    if (state.call.conversationId !== conversationId || state.call.peerId !== fromUserId) return;
    $("callStatus").textContent = "Connected. Starting audio...";
    try {
      const offer = await state.call.peerConnection.createOffer();
      await state.call.peerConnection.setLocalDescription(offer);
      sendCallSignal({ type: "offer", sdp: offer });
    } catch (error) {
      endCall(false);
      alert(error.message);
    }
  });
  state.socket.on("call:rejected", ({ conversationId }) => {
    if (state.call.conversationId !== conversationId) return;
    endCall(false);
    alert("Call declined.");
  });
  state.socket.on("call:ended", ({ conversationId }) => {
    if (state.call.conversationId !== conversationId) return;
    endCall(false);
  });
  state.socket.on("call:signal", ({ conversationId, fromUserId, signal }) => {
    handleCallSignal({ conversationId, fromUserId, signal }).catch((error) => {
      endCall(true);
      alert(error.message);
    });
  });
}

async function bootstrap() {
  registerPwa();
  showPendingShareError();
  if (!state.token) {
    showPendingShareLoginHint();
    setAppReady();
    return;
  }
  try {
    const { user } = await api("/api/me");
    state.user = user;
    if (privacyEnabled() && privacyAwayExpired()) {
      lockToCalculator();
      return;
    }
    if (privacyEnabled() && !(await verifyPrivacySession())) {
      showCalculatorPrivacy();
      return;
    }
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

function privacyEnabled() {
  return Boolean(state.user?.privacyMode?.enabled && state.user.privacyMode.hasCode);
}

function syncPrivacySettings() {
  if (!$("privacyModeToggle") || !state.user) return;
  const settings = state.user.privacyMode || {};
  $("privacyModeToggle").checked = Boolean(settings.enabled);
  $("privacyAutoLock").value = String(settings.autoLockMinutes || 0);
  $("privacyPanicShortcut").value = settings.panicShortcut || "button";
  $("panicHideBtn").classList.toggle("hidden", !privacyEnabled());
}

async function verifyPrivacySession() {
  if (!privacyEnabled()) return true;
  if (!state.privacyToken) return false;
  try {
    await api("/api/privacy/session", { headers: { "X-Privacy-Token": state.privacyToken } });
    return true;
  } catch {
    sessionStorage.removeItem("privacyToken");
    state.privacyToken = null;
    return false;
  }
}

function showCalculatorPrivacy() {
  endCall(false);
  clearTimeout(state.privacyAutoLockTimer);
  clearPrivacyAwayLock();
  state.socket?.disconnect();
  state.calculatorExpression = "";
  state.calculatorJustEvaluated = false;
  $("calculatorHistory").textContent = "";
  $("calculatorDisplay").textContent = "0";
  $("profileModal").classList.add("hidden");
  $("shareModal").classList.add("hidden");
  $("callModal").classList.add("hidden");
  $("videoPreviewModal").classList.add("hidden");
  $("authView").classList.add("hidden");
  $("chatView").classList.add("hidden");
  $("calculatorPrivacyView").classList.remove("hidden", "unlocking");
  setAppReady();
}

async function openUnlockedChat() {
  $("calculatorPrivacyView").classList.add("unlocking");
  await new Promise((resolve) => setTimeout(resolve, 160));
  showChat();
  connectSocket();
  await loadConversations();
  await loadPendingShare();
}

function lockToCalculator() {
  if (!privacyEnabled()) return;
  sessionStorage.removeItem("privacyToken");
  state.privacyToken = null;
  showCalculatorPrivacy();
}

function privacyAutoLockMs() {
  const minutes = Number(state.user?.privacyMode?.autoLockMinutes || 0);
  return privacyEnabled() && minutes > 0 ? minutes * 60 * 1000 : 0;
}

function clearPrivacyAwayLock() {
  clearTimeout(state.privacyAutoLockTimer);
  state.privacyAwayStartedAt = 0;
  localStorage.removeItem("privacyAwayStartedAt");
}

function startPrivacyAwayLock() {
  clearTimeout(state.privacyAutoLockTimer);
  const timeoutMs = privacyAutoLockMs();
  if (!timeoutMs || $("chatView").classList.contains("hidden")) return;
  if (!state.privacyAwayStartedAt) {
    state.privacyAwayStartedAt = Date.now();
    localStorage.setItem("privacyAwayStartedAt", String(state.privacyAwayStartedAt));
  }
  const elapsed = Date.now() - state.privacyAwayStartedAt;
  const remaining = Math.max(0, timeoutMs - elapsed);
  state.privacyAutoLockTimer = setTimeout(lockToCalculator, remaining);
}

function privacyAwayExpired() {
  const timeoutMs = privacyAutoLockMs();
  const startedAt = Number(localStorage.getItem("privacyAwayStartedAt") || state.privacyAwayStartedAt || 0);
  return Boolean(timeoutMs && startedAt && Date.now() - startedAt >= timeoutMs);
}

function handlePrivacyReturn() {
  if (!privacyEnabled()) return;
  if (privacyAwayExpired()) {
    lockToCalculator();
    return;
  }
  clearPrivacyAwayLock();
}

function handlePrivacyVisibilityChange() {
  if (document.visibilityState === "hidden") startPrivacyAwayLock();
  else handlePrivacyReturn();
}

function formatCalculatorValue(value) {
  if (!Number.isFinite(value)) return "Error";
  return String(Number(value.toPrecision(12))).slice(0, 16);
}

function evaluateCalculator(expression) {
  if (!/^[\d+\-*/. ]+$/.test(expression)) return "Error";
  const rawTokens = expression.match(/\d*\.?\d+|[+\-*/]/g);
  if (!rawTokens?.length) return "0";
  try {
    const tokens = [];
    for (let index = 0; index < rawTokens.length; index += 1) {
      const token = rawTokens[index];
      if (token === "-" && (index === 0 || /[+\-*/]/.test(rawTokens[index - 1]))) {
        const next = rawTokens[index + 1];
        if (!/^\d*\.?\d+$/.test(next || "")) throw new Error("Invalid expression");
        tokens.push(String(-Number(next)));
        index += 1;
      } else {
        tokens.push(token);
      }
    }
    const values = [];
    const operators = [];
    const precedence = { "+": 1, "-": 1, "*": 2, "/": 2 };
    const applyOperator = () => {
      const operator = operators.pop();
      const right = values.pop();
      const left = values.pop();
      if (!operator || left === undefined || right === undefined) throw new Error("Invalid expression");
      if (operator === "+") values.push(left + right);
      if (operator === "-") values.push(left - right);
      if (operator === "*") values.push(left * right);
      if (operator === "/") values.push(left / right);
    };

    tokens.forEach((token) => {
      if (/^-?\d*\.?\d+$/.test(token)) {
        values.push(Number(token));
        return;
      }
      while (operators.length && precedence[operators.at(-1)] >= precedence[token]) applyOperator();
      operators.push(token);
    });
    while (operators.length) applyOperator();
    if (values.length !== 1) throw new Error("Invalid expression");
    const value = values[0];
    return formatCalculatorValue(value);
  } catch {
    return "Error";
  }
}

async function tryPrivacyUnlock(code) {
  try {
    const data = await api("/api/privacy/unlock", { method: "POST", body: JSON.stringify({ code }) });
    if (!data.ok || !data.privacyToken) return false;
    state.privacyToken = data.privacyToken;
    sessionStorage.setItem("privacyToken", data.privacyToken);
    state.user = data.user;
    await openUnlockedChat();
    return true;
  } catch {
    return false;
  }
}

function appendCalculatorValue(value) {
  if (state.calculatorJustEvaluated && /\d|\./.test(value)) {
    state.calculatorExpression = "";
  }
  state.calculatorJustEvaluated = false;
  const last = state.calculatorExpression.slice(-1);
  if ("+-*/".includes(value) && (!state.calculatorExpression || "+-*/".includes(last))) {
    if (value !== "-" || last === "-") return;
  }
  if (value === ".") {
    const part = state.calculatorExpression.split(/[+\-*/]/).pop();
    if (part.includes(".")) return;
  }
  state.calculatorExpression = (state.calculatorExpression + value).slice(0, 32);
  $("calculatorDisplay").textContent = state.calculatorExpression || "0";
}

async function handleCalculatorEquals() {
  const expression = state.calculatorExpression.trim();
  const unlockMatch = expression.match(/^(\d{6})$/);
  if (unlockMatch && await tryPrivacyUnlock(unlockMatch[1])) return;
  const result = evaluateCalculator(expression || "0");
  $("calculatorHistory").textContent = expression ? `${expression} =` : "";
  $("calculatorDisplay").textContent = result;
  state.calculatorExpression = result === "Error" ? "" : result;
  state.calculatorJustEvaluated = true;
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

function avatarMarkup(user, fallback = "User") {
  const label = user?.displayName || user?.userId || fallback || "User";
  if (user?.avatarUrl) return `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(label)}">`;
  return escapeHtml(label.slice(0, 1).toUpperCase());
}

function renderAvatarInto(element, user, fallback = "User") {
  if (!element) return;
  element.innerHTML = avatarMarkup(user, fallback);
}

function isOnline(userId) {
  return state.presence.find((item) => item.id === userId)?.online;
}

function presenceFor(userId) {
  return state.presence.find((item) => item.id === userId);
}

function formatPresenceStatus(userId) {
  const presence = presenceFor(userId);
  if (presence?.online) return "Online";
  return formatLastSeen(presence?.lastSeenAt);
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

function renderConversations() {
  $("conversationList").innerHTML = state.conversations.map((conversation) => {
    const title = conversation.group?.name || getOtherMember(conversation)?.displayName || "Chat";
    const other = getOtherMember(conversation);
    const status = conversation.group ? `${conversation.members.length} members` : formatPresenceStatus(other?.id);
    const last = conversation.lastMessage?.media ? `[${conversation.lastMessage.media.kind}]` : conversation.lastMessage?.text || "No messages yet";
    return `
      <button class="conversation ${state.activeConversation?.id === conversation.id ? "active" : ""}" data-id="${conversation.id}" type="button">
        <span class="avatar">${avatarMarkup(other, title)}</span>
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
  $("callBtn").classList.add("hidden");
  $("videoCallBtn").classList.add("hidden");
  $("hideChatBtn").classList.add("hidden");
  $("blockUserBtn").classList.add("hidden");
  $("deleteUserBtn").classList.add("hidden");
  if (!conversation) return;
  const other = getOtherMember(conversation);
  const title = conversation.group?.name || other?.displayName || "Chat";
  $("chatTitle").textContent = title;
  renderAvatarInto($("chatAvatar"), other, title);
  $("chatStatus").textContent = conversation.group ? `${conversation.members.length} members` : formatPresenceStatus(other?.id);
  if (!conversation.groupId && other?.id) {
    $("callBtn").classList.remove("hidden");
    $("videoCallBtn").classList.remove("hidden");
    $("callBtn").classList.toggle("active-call", state.call.active && state.call.conversationId === conversation.id);
    $("videoCallBtn").classList.toggle("active-call", state.call.active && state.call.conversationId === conversation.id);
    $("hideChatBtn").classList.remove("hidden");
    $("hideChatBtn").textContent = conversation.hidden ? "Unhide" : "Hide";
    $("blockUserBtn").classList.remove("hidden");
    $("deleteUserBtn").classList.remove("hidden");
    $("blockUserBtn").textContent = conversation.blockedByMe ? "Unblock" : "Block";
  }
}

function renderMessages({ preserveScroll = false } = {}) {
  if (!state.activeConversation) {
    clearReplyComposer();
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
        ${renderReplyPreview(message.replyTo)}
        ${renderMedia(message.media)}
        ${message.text ? `<p>${renderMessageText(message.text)}</p>` : ""}
        ${renderReactions(message)}
        <footer>
          <time>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          ${own ? `<span class="ticks ${ticks === "blue" ? "blue" : ""}">${ticks === "single" ? "✓" : "✓✓"}</span>` : ""}
          <button data-reply="${message.id}" type="button" title="Reply">Reply</button>
          <button data-delete="${message.id}" type="button" title="Delete for me">Delete</button>
          ${canDeleteEveryone ? `<button data-delete-everyone="${message.id}" type="button" title="Delete for everyone">Everyone</button>` : ""}
        </footer>
        ${state.reactionPickerMessageId === message.id ? renderReactionPicker(message) : ""}
      </article>`;
  }).join("");
  if (!preserveScroll) $("messages").scrollTop = $("messages").scrollHeight;
  renderReplyComposer();
  updateBulkActions();
}

function updateBulkActions() {
  $("bulkActions").classList.toggle("hidden", !state.selectionMode);
  $("selectedCount").textContent = `${state.selectedMessageIds.size} selected`;
  $("selectMessagesBtn").textContent = state.selectionMode ? "Selecting" : "Select";
  const selectedMessages = state.messages.filter((message) => state.selectedMessageIds.has(message.id));
  const canBulkDeleteEveryone = selectedMessages.length > 1 && selectedMessages.every((message) => (
    message.senderId === state.user.id
    && Date.now() - new Date(message.createdAt).getTime() <= 5 * 60 * 1000
  ));
  $("bulkDeleteEveryoneBtn").classList.toggle("hidden", !canBulkDeleteEveryone);
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  renderMessages();
}

function renderReplyPreview(replyTo) {
  if (!replyTo) return "";
  return `
    <div class="reply-preview">
      <strong>${escapeHtml(replyTo.senderName || "User")}</strong>
      <span>${escapeHtml(replyTo.text || replyTo.mediaName || "Message")}</span>
    </div>
  `;
}

function renderReactions(message) {
  const reactions = Object.entries(message.reactions || {});
  if (!reactions.length) return "";
  const grouped = reactions.reduce((items, [, emoji]) => {
    items.set(emoji, (items.get(emoji) || 0) + 1);
    return items;
  }, new Map());
  return `<div class="message-reactions">${[...grouped.entries()].map(([emoji, count]) => `<span>${escapeHtml(emoji)}${count > 1 ? ` ${count}` : ""}</span>`).join("")}</div>`;
}

function renderReactionButtons(message) {
  const options = ["👍", "❤️", "😂", "😮"];
  const current = message.reactions?.[state.user.id];
  options.splice(0, options.length, ...new Set([...DEFAULT_REACTION_EMOJIS, ...(state.user?.reactionEmojis || [])]));
  return `<span class="reaction-actions">${options.map((emoji) => `<button class="${current === emoji ? "active" : ""}" data-react="${message.id}" data-emoji="${emoji}" type="button" title="React ${emoji}">${emoji}</button>`).join("")}</span>`;
}

function renderReactionPicker(message) {
  return `
    <div class="reaction-picker" role="menu" aria-label="Message reactions">
      ${renderReactionButtons(message)}
      <button class="reaction-add" data-add-reaction="${message.id}" type="button" title="Add emoji">+</button>
    </div>
  `;
}

function messageSnippet(message) {
  if (!message) return "";
  if (message.text) return message.text;
  if (message.media?.originalName) return message.media.originalName;
  return "Message";
}

function senderName(senderId) {
  if (senderId === state.user.id) return "You";
  return state.activeConversation?.members?.find((member) => member.id === senderId)?.displayName || "User";
}

function renderReplyComposer() {
  const message = state.messages.find((item) => item.id === state.replyToMessageId);
  $("replyComposer").classList.toggle("hidden", !message);
  if (!message) {
    $("replyComposerText").textContent = "";
    return;
  }
  $("replyComposerText").innerHTML = `<strong>${escapeHtml(senderName(message.senderId))}</strong><span>${escapeHtml(messageSnippet(message))}</span>`;
}

function clearReplyComposer() {
  state.replyToMessageId = null;
  renderReplyComposer();
}

function openReactionPicker(messageId) {
  if (!messageId || state.selectionMode) return;
  state.reactionPickerMessageId = state.reactionPickerMessageId === messageId ? null : messageId;
  renderMessages({ preserveScroll: true });
}

function clearReactionLongPress() {
  if (!state.reactionLongPressTimer) return;
  clearTimeout(state.reactionLongPressTimer);
  state.reactionLongPressTimer = null;
}

function startReactionLongPress(event) {
  const article = event.target.closest("[data-message]");
  if (!article || event.target.closest("button, a, input, label")) return;
  clearReactionLongPress();
  state.reactionLongPressTimer = setTimeout(() => {
    state.reactionLongPressTimer = null;
    openReactionPicker(article.dataset.message);
  }, 550);
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
      <span class="avatar">${avatarMarkup(user, user.displayName)}</span>
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
            <span class="avatar">${avatarMarkup(other, title)}</span>
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
  if (state.activeConversation?.blockedByMe || state.activeConversation?.blockedMe) throw new Error("Unblock this user before sending media.");
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(state.privacyToken ? { "X-Privacy-Token": state.privacyToken } : {})
    },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed.");
  state.socket.emit("message:send", { conversationId: state.activeConversation.id, media: data.media, replyToId: state.replyToMessageId });
  clearReplyComposer();
}

async function uploadMediaToConversation(file, conversationId, text = "") {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(state.privacyToken ? { "X-Privacy-Token": state.privacyToken } : {})
    },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed.");
  state.socket.emit("message:send", { conversationId, media: data.media, text });
  return data.media;
}

async function uploadCallRecording(file, conversationId, callType = "voice") {
  const form = new FormData();
  form.append("file", file);
  form.append("conversationId", conversationId);
  form.append("callType", callType);
  const response = await fetch("/api/call-recordings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(state.privacyToken ? { "X-Privacy-Token": state.privacyToken } : {})
    },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Call recording upload failed.");
  return data.recording;
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

async function toggleVideoRecording() {
  if (state.videoRecorder?.state === "recording") {
    state.videoRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera recording is not supported in this browser.");
  if (!window.MediaRecorder) throw new Error("Video recording is not supported in this browser.");
  const facingMode = $("cameraSelect")?.value || state.cameraFacingMode || "user";
  state.cameraFacingMode = facingMode;
  localStorage.setItem("cameraFacingMode", facingMode);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode } });
  state.videoStream = stream;
  $("videoRecordPreview").srcObject = stream;
  $("videoPreviewModal").classList.remove("hidden");
  state.videoChunks = [];
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
  state.videoRecorder = new MediaRecorder(stream, { mimeType });
  state.videoRecorder.ondataavailable = (event) => {
    if (event.data.size) state.videoChunks.push(event.data);
  };
  state.videoRecorder.onstop = async () => {
    clearTimeout(state.videoTimer);
    state.videoTimer = null;
    $("videoRecordBtn").classList.remove("recording");
    $("videoPreviewModal").classList.add("hidden");
    $("videoRecordPreview").srcObject = null;
    stream.getTracks().forEach((track) => track.stop());
    state.videoStream = null;
    if (!state.videoChunks.length) return;
    const blob = new Blob(state.videoChunks, { type: "video/webm" });
    setUploadStatus("Uploading recorded video...");
    try {
      await sendMediaFile(new File([blob], `video-${Date.now()}.webm`, { type: "video/webm" }));
      setUploadStatus("Video sent.");
      setTimeout(() => setUploadStatus(""), 1600);
    } catch (error) {
      setUploadStatus("");
      alert(error.message);
    }
  };
  state.videoRecorder.start();
  $("videoRecordBtn").classList.add("recording");
  $("videoRecordStatus").textContent = "Recording... max 1 minute.";
  setUploadStatus("Recording video... max 1 minute.");
  state.videoTimer = setTimeout(() => {
    if (state.videoRecorder?.state === "recording") state.videoRecorder.stop();
  }, 60 * 1000);
}

function directPeer(conversation = state.activeConversation) {
  if (!conversation || conversation.groupId) return null;
  return getOtherMember(conversation);
}

function callMediaConstraints(type = state.call.type) {
  const wantsVideo = type === "video";
  return {
    audio: true,
    video: wantsVideo ? { facingMode: $("cameraSelect")?.value || state.cameraFacingMode || "user" } : false
  };
}

async function ensureCallMedia(type = state.call.type) {
  if (state.call.localStream) return state.call.localStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Calling is not supported in this browser.");
  state.call.localStream = await navigator.mediaDevices.getUserMedia(callMediaConstraints(type));
  $("localVideo").srcObject = state.call.localStream;
  return state.call.localStream;
}

async function switchCallCamera(targetFacingMode = null) {
  if (!state.call.active || state.call.type !== "video" || !state.call.peerConnection) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  const nextFacingMode = targetFacingMode || ((state.cameraFacingMode || "user") === "user" ? "environment" : "user");
  const previousFacingMode = state.cameraFacingMode || "user";
  const videoSender = state.call.peerConnection.getSenders().find((sender) => sender.track?.kind === "video");
  if (!videoSender) return;
  $("switchCallCameraBtn").disabled = true;
  const currentVideoTracks = state.call.localStream?.getVideoTracks() || [];
  try {
    await videoSender.replaceTrack(null);
    currentVideoTracks.forEach((track) => track.stop());
    const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacingMode }, audio: false });
    const [newVideoTrack] = newStream.getVideoTracks();
    if (!newVideoTrack) throw new Error("Camera not available.");
    await videoSender.replaceTrack(newVideoTrack);
    const audioTracks = state.call.localStream?.getAudioTracks() || [];
    state.call.localStream = new MediaStream([...audioTracks, newVideoTrack]);
    $("localVideo").srcObject = state.call.localStream;
    state.cameraFacingMode = nextFacingMode;
    $("cameraSelect").value = nextFacingMode;
    localStorage.setItem("cameraFacingMode", nextFacingMode);
  } catch (error) {
    console.warn("Could not switch camera:", error);
    state.cameraFacingMode = previousFacingMode;
    $("cameraSelect").value = previousFacingMode;
    localStorage.setItem("cameraFacingMode", previousFacingMode);
    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: previousFacingMode }, audio: false });
      const [fallbackVideoTrack] = fallbackStream.getVideoTracks();
      if (fallbackVideoTrack) {
        await videoSender.replaceTrack(fallbackVideoTrack);
        const audioTracks = state.call.localStream?.getAudioTracks() || [];
        state.call.localStream = new MediaStream([...audioTracks, fallbackVideoTrack]);
        $("localVideo").srcObject = state.call.localStream;
      }
    } catch (fallbackError) {
      console.warn("Could not restore previous camera:", fallbackError);
    }
  } finally {
    $("switchCallCameraBtn").disabled = false;
  }
}

function supportedRecordingMime(type) {
  const choices = type === "video"
    ? ["video/webm;codecs=vp8,opus", "video/webm"]
    : ["audio/webm;codecs=opus", "audio/webm"];
  return choices.find((item) => MediaRecorder.isTypeSupported(item)) || "";
}

function mixedCallAudioStream(localStream, remoteStream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const destination = context.createMediaStreamDestination();
  [localStream, remoteStream].forEach((stream) => {
    if (!stream?.getAudioTracks().length) return;
    const source = context.createMediaStreamSource(stream);
    source.connect(destination);
  });
  destination.stream.addEventListener("inactive", () => context.close().catch(() => {}), { once: true });
  return destination.stream;
}

function startCallRecording() {
  if (state.call.recorder || !state.call.localStream || !state.call.remoteStream) return;
  if (!state.call.shouldRecord) {
    return;
  }
  if (!window.MediaRecorder) {
    return;
  }
  const mixedAudio = mixedCallAudioStream(state.call.localStream, state.call.remoteStream);
  let recordStream = mixedAudio;
  let animationId = null;
  const recorderChunks = [];
  const recordingConversationId = state.call.conversationId;
  const recordingType = state.call.type;

  if (state.call.type === "video") {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d");
    const draw = () => {
      context.fillStyle = "#101817";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if ($("remoteVideo").readyState >= 2) context.drawImage($("remoteVideo"), 0, 0, canvas.width, canvas.height);
      if ($("localVideo").readyState >= 2) {
        const insetWidth = 260;
        const insetHeight = 146;
        context.fillStyle = "rgba(255,255,255,0.9)";
        context.fillRect(canvas.width - insetWidth - 24, canvas.height - insetHeight - 24, insetWidth, insetHeight);
        context.drawImage($("localVideo"), canvas.width - insetWidth - 20, canvas.height - insetHeight - 20, insetWidth - 8, insetHeight - 8);
      }
      animationId = requestAnimationFrame(draw);
      state.call.recorderAnimation = animationId;
    };
    draw();
    state.call.recorderCanvas = canvas;
    recordStream = new MediaStream([
      ...canvas.captureStream(24).getVideoTracks(),
      ...mixedAudio.getAudioTracks()
    ]);
  }

  const mimeType = supportedRecordingMime(state.call.type);
  state.call.recorderStream = recordStream;
  state.call.recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
  state.call.recorder.ondataavailable = (event) => {
    if (event.data.size) recorderChunks.push(event.data);
  };
  state.call.recorder.onstop = async () => {
    const chunks = recorderChunks;
    const conversationId = recordingConversationId;
    const type = recordingType;
    if (animationId) cancelAnimationFrame(animationId);
    recordStream.getTracks().forEach((track) => track.stop());
    if (!chunks.length || !conversationId) return;
    const isVideo = type === "video";
    const blob = new Blob(chunks, { type: isVideo ? "video/webm" : "audio/webm" });
    const file = new File([blob], `${type}-call-${Date.now()}.webm`, { type: blob.type });
    try {
      await uploadCallRecording(file, conversationId, type);
    } catch (error) {
      alert(`Call recording upload failed: ${error.message}`);
    }
  };
  state.call.recorder.start(1000);
}

function createPeerConnection() {
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) sendCallSignal({ type: "candidate", candidate: event.candidate });
  };
  peerConnection.ontrack = (event) => {
    state.call.remoteStream = event.streams[0];
    $("remoteAudio").srcObject = state.call.remoteStream;
    $("remoteVideo").srcObject = state.call.remoteStream;
    startCallRecording();
  };
  peerConnection.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) endCall(false);
  };
  state.call.peerConnection = peerConnection;
  return peerConnection;
}

async function prepareCall({ conversationId, peerId, incoming = false, type = "voice", shouldRecord = false }) {
  endCall(false);
  state.call.conversationId = conversationId;
  state.call.peerId = peerId;
  state.call.incoming = incoming;
  state.call.type = type;
  state.call.shouldRecord = shouldRecord;
  state.call.active = true;
  $("callTitle").textContent = type === "video" ? "Video call" : "Voice call";
  $("callModal").classList.remove("hidden");
  $("callVideoGrid").classList.toggle("hidden", type !== "video");
  $("switchCallCameraBtn").classList.toggle("hidden", type !== "video");
  $("incomingCallActions").classList.toggle("hidden", !incoming);
  $("endCallBtn").classList.toggle("hidden", incoming);
  $("callBtn").classList.add("active-call");
  $("videoCallBtn").classList.add("active-call");
  const stream = await ensureCallMedia(type);
  const peerConnection = createPeerConnection();
  stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
  renderHeader();
  return peerConnection;
}

async function startCall(type = "voice") {
  const peer = directPeer();
  if (!peer || !state.activeConversation) return;
  $("callTitle").textContent = `Calling ${peer.displayName || "User"}`;
  $("callStatus").textContent = "Ringing...";
  await prepareCall({ conversationId: state.activeConversation.id, peerId: peer.id, type, shouldRecord: true });
  state.socket.emit("call:invite", { conversationId: state.activeConversation.id, callType: type });
}

function showIncomingCall({ conversationId, fromUserId, fromName, callType = "voice" }) {
  if (state.call.active) {
    state.socket.emit("call:reject", { conversationId, targetUserId: fromUserId });
    return;
  }
  state.call.conversationId = conversationId;
  state.call.peerId = fromUserId;
  state.call.incoming = true;
  state.call.type = callType;
  state.call.active = true;
  $("callTitle").textContent = `${fromName || "User"} is calling`;
  $("callStatus").textContent = callType === "video" ? "Incoming video call" : "Incoming voice call";
  $("callVideoGrid").classList.toggle("hidden", callType !== "video");
  $("incomingCallActions").classList.remove("hidden");
  $("endCallBtn").classList.add("hidden");
  $("callModal").classList.remove("hidden");
}

async function acceptIncomingCall() {
  const { conversationId, peerId, type } = state.call;
  $("incomingCallActions").classList.add("hidden");
  $("endCallBtn").classList.remove("hidden");
  $("callStatus").textContent = "Connecting...";
  await prepareCall({ conversationId, peerId, incoming: false, type, shouldRecord: false });
  state.socket.emit("call:accept", { conversationId, targetUserId: peerId });
}

function sendCallSignal(signal) {
  if (!state.call.conversationId || !state.call.peerId) return;
  state.socket.emit("call:signal", {
    conversationId: state.call.conversationId,
    targetUserId: state.call.peerId,
    signal
  });
}

async function handleCallSignal({ conversationId, fromUserId, signal }) {
  if (state.call.conversationId !== conversationId || state.call.peerId !== fromUserId) return;
  let peerConnection = state.call.peerConnection;
  if (!peerConnection) {
    await prepareCall({ conversationId, peerId: fromUserId, incoming: false, type: state.call.type });
    peerConnection = state.call.peerConnection;
  }
  if (signal.type === "offer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendCallSignal({ type: "answer", sdp: answer });
    $("callStatus").textContent = "Connected.";
  }
  if (signal.type === "answer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    $("callStatus").textContent = "Connected.";
  }
  if (signal.type === "candidate" && signal.candidate) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
}

function endCall(notifyPeer = true) {
  const { conversationId, peerId } = state.call;
  if (notifyPeer && conversationId && peerId) {
    state.socket.emit("call:end", { conversationId, targetUserId: peerId });
  }
  if (state.call.recorder?.state === "recording") state.call.recorder.stop();
  state.call.peerConnection?.close();
  state.call.localStream?.getTracks().forEach((track) => track.stop());
  state.call.remoteStream?.getTracks().forEach((track) => track.stop());
  if (state.call.recorderAnimation) cancelAnimationFrame(state.call.recorderAnimation);
  state.call = {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    recorder: null,
    recorderStream: null,
    recorderChunks: [],
    recorderCanvas: null,
    recorderAnimation: null,
    conversationId: null,
    peerId: null,
    type: "voice",
    shouldRecord: false,
    incoming: false,
    active: false
  };
  $("remoteAudio").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("callVideoGrid").classList.add("hidden");
  $("switchCallCameraBtn").classList.add("hidden");
  $("callModal").classList.add("hidden");
  $("incomingCallActions").classList.add("hidden");
  $("endCallBtn").classList.remove("hidden");
  $("callBtn").classList.remove("active-call");
  $("videoCallBtn").classList.remove("active-call");
  renderHeader();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function renderMessageText(value = "") {
  const text = String(value);
  const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    const rawUrl = match[0];
    const trimmedUrl = rawUrl.replace(/[.,!?;:)\]}]+$/g, "");
    const trailingText = rawUrl.slice(trimmedUrl.length);

    html += escapeHtml(text.slice(lastIndex, match.index));
    if (trimmedUrl) {
      const href = trimmedUrl.startsWith("www.") ? `https://${trimmedUrl}` : trimmedUrl;
      html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmedUrl)}</a>`;
    }
    html += escapeHtml(trailingText);
    lastIndex = match.index + rawUrl.length;
  }

  return html + escapeHtml(text.slice(lastIndex));
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
$("calculatorPrivacyView").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const value = button.dataset.calcValue;
  const action = button.dataset.calcAction;
  if (value) appendCalculatorValue(value);
  if (action === "clear") {
    state.calculatorExpression = "";
    state.calculatorJustEvaluated = false;
    $("calculatorHistory").textContent = "";
    $("calculatorDisplay").textContent = "0";
  }
  if (action === "delete") {
    state.calculatorExpression = state.calculatorExpression.slice(0, -1);
    $("calculatorDisplay").textContent = state.calculatorExpression || "0";
  }
  if (action === "equals") handleCalculatorEquals();
});
$("panicHideBtn").addEventListener("click", lockToCalculator);
document.addEventListener("visibilitychange", handlePrivacyVisibilityChange);
window.addEventListener("blur", startPrivacyAwayLock);
window.addEventListener("focus", handlePrivacyReturn);
window.addEventListener("pagehide", startPrivacyAwayLock);
document.addEventListener("dblclick", () => {
  if (state.user?.privacyMode?.panicShortcut === "double-tap") lockToCalculator();
});
document.addEventListener("keydown", (event) => {
  if ($("calculatorPrivacyView").classList.contains("hidden")) return;
  if (/^\d$/.test(event.key) || ["+", "-", "*", "/", "."].includes(event.key)) {
    appendCalculatorValue(event.key);
  }
  if (event.key === "Enter" || event.key === "=") handleCalculatorEquals();
  if (event.key === "Backspace") {
    state.calculatorExpression = state.calculatorExpression.slice(0, -1);
    $("calculatorDisplay").textContent = state.calculatorExpression || "0";
  }
  if (event.key === "Escape") {
    state.calculatorExpression = "";
    $("calculatorHistory").textContent = "";
    $("calculatorDisplay").textContent = "0";
  }
});
$("profileBtn").addEventListener("click", () => {
  $("profileName").value = state.user.displayName;
  $("profileUserId").value = state.user.userId || "";
  $("profileAvatarInput").value = "";
  renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
  $("privacyCodeInput").value = "";
  syncPrivacySettings();
  $("profileMessage").textContent = "";
  $("profileMessage").classList.remove("success-text");
  $("profileModal").classList.remove("hidden");
});
$("closeProfileBtn").addEventListener("click", () => $("profileModal").classList.add("hidden"));
$("profileAvatarInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
    return;
  }
  $("profileAvatarPreview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Profile preview">`;
});
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
$("bulkDeleteEveryoneBtn").addEventListener("click", async () => {
  if (state.selectedMessageIds.size < 2) return;
  if (!confirm("Delete selected messages for everyone?")) return;
  const { deletedIds = [], count = 0 } = await api("/api/messages/bulk-delete-everyone", { method: "POST", body: JSON.stringify({ ids: [...state.selectedMessageIds] }) });
  if (!count) {
    alert("Selected messages delete from everyone ke liye available nahi hain.");
    updateBulkActions();
    return;
  }
  const deleted = new Set(deletedIds);
  state.messages = state.messages.filter((message) => !deleted.has(message.id));
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
$("blockUserBtn").addEventListener("click", async () => {
  if (!state.activeConversation || state.activeConversation.groupId) return;
  const blocked = state.activeConversation.blockedByMe;
  const action = blocked ? "unblock-user" : "block-user";
  if (!blocked && !confirm("Block this user? They will not be able to message you.")) return;
  const { user, conversation } = await api(`/api/conversations/${state.activeConversation.id}/${action}`, { method: "POST" });
  if (user) state.user = user;
  if (conversation) state.activeConversation = conversation;
  renderHeader();
  await loadConversations();
});
$("deleteUserBtn").addEventListener("click", async () => {
  if (!state.activeConversation || state.activeConversation.groupId) return;
  if (!confirm("Delete this user from your account? Admin panel se user delete nahi hoga.")) return;
  const conversationId = state.activeConversation.id;
  const { user } = await api(`/api/conversations/${conversationId}/delete-user`, { method: "POST" });
  if (user) state.user = user;
  state.activeConversation = null;
  state.messages = [];
  renderHeader();
  renderMessages();
  await loadConversations();
  $("chatView").classList.remove("conversation-open");
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
$("videoRecordBtn").addEventListener("click", () => {
  if (!state.activeConversation) return;
  toggleVideoRecording().catch((error) => {
    $("videoRecordBtn").classList.remove("recording");
    $("videoPreviewModal").classList.add("hidden");
    setUploadStatus("");
    alert(error.message);
  });
});
$("stopVideoRecordBtn").addEventListener("click", () => {
  if (state.videoRecorder?.state === "recording") state.videoRecorder.stop();
});
$("closeVideoPreviewBtn").addEventListener("click", () => {
  if (state.videoRecorder?.state === "recording") state.videoRecorder.stop();
});
$("cameraSelect").addEventListener("change", () => {
  state.cameraFacingMode = $("cameraSelect").value;
  localStorage.setItem("cameraFacingMode", state.cameraFacingMode);
  if (state.call.active && state.call.type === "video") {
    switchCallCamera(state.cameraFacingMode);
  }
});
$("switchCallCameraBtn").addEventListener("click", () => {
  switchCallCamera();
});
$("callBtn").addEventListener("click", () => {
  if (!directPeer()) return;
  startCall("voice").catch((error) => {
    endCall(false);
    alert(error.message);
  });
});
$("videoCallBtn").addEventListener("click", () => {
  if (!directPeer()) return;
  startCall("video").catch((error) => {
    endCall(false);
    alert(error.message);
  });
});
$("acceptCallBtn").addEventListener("click", () => {
  acceptIncomingCall().catch((error) => {
    endCall(true);
    alert(error.message);
  });
});
$("declineCallBtn").addEventListener("click", () => {
  const { conversationId, peerId } = state.call;
  if (conversationId && peerId) state.socket.emit("call:reject", { conversationId, targetUserId: peerId });
  endCall(false);
});
$("endCallBtn").addEventListener("click", () => endCall(true));
$("closeCallBtn").addEventListener("click", () => endCall(true));
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
    if (privacyEnabled()) {
      showCalculatorPrivacy();
      if ("Notification" in window) Notification.requestPermission();
      return;
    }
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
    userId: form.get("userId"),
    oldPassword: form.get("oldPassword"),
    newPassword: form.get("newPassword")
  };
  const privacyBody = {
    enabled: $("privacyModeToggle").checked,
    code: String(form.get("privacyCode") || "").trim(),
    autoLockMinutes: Number(form.get("privacyAutoLock") || 0),
    panicShortcut: form.get("privacyPanicShortcut") || "button"
  };
  if (!body.newPassword) {
    delete body.oldPassword;
    delete body.newPassword;
  }
  try {
    const profileResult = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
    state.user = profileResult.user;
    const avatarFile = $("profileAvatarInput").files?.[0];
    if (avatarFile) {
      const avatarBody = new FormData();
      avatarBody.append("avatar", avatarFile);
      const avatarResponse = await fetch("/api/me/avatar", {
        method: "POST",
        headers: {
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
          ...(state.privacyToken ? { "X-Privacy-Token": state.privacyToken } : {})
        },
        body: avatarBody
      });
      const avatarData = await avatarResponse.json().catch(() => ({}));
      if (!avatarResponse.ok) throw new Error(avatarData.error || "Profile photo upload failed.");
      state.user = avatarData.user;
    }
    const privacyResult = await api("/api/privacy/settings", { method: "PATCH", body: JSON.stringify(privacyBody) });
    state.user = privacyResult.user;
    if (privacyEnabled() && !state.privacyToken) {
      event.target.oldPassword.value = "";
      event.target.newPassword.value = "";
      $("privacyCodeInput").value = "";
      $("profileMessage").textContent = "";
      showCalculatorPrivacy();
      return;
    }
    showChat();
    event.target.oldPassword.value = "";
    event.target.newPassword.value = "";
    $("profileAvatarInput").value = "";
    $("privacyCodeInput").value = "";
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
  clearReplyComposer();
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
    clearReplyComposer();
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
  clearReplyComposer();
  state.socket.emit("conversation:join", { conversationId: conversation.id });
  renderHeader();
  await loadMessages(conversation.id);
  $("searchResults").innerHTML = "";
  $("searchInput").value = "";
  $("chatView").classList.add("conversation-open");
});

$("messages").addEventListener("click", async (event) => {
  const replyButton = event.target.closest("[data-reply]");
  if (replyButton) {
    state.replyToMessageId = replyButton.dataset.reply;
    renderReplyComposer();
    $("messageInput").focus();
    return;
  }
  const addReactionButton = event.target.closest("[data-add-reaction]");
  if (addReactionButton) {
    const emoji = prompt("Emoji add karein", "");
    if (!emoji?.trim()) return;
    const nextEmojis = [...new Set([...(state.user.reactionEmojis || []), emoji.trim()])].slice(0, 12);
    const { user } = await api("/api/me", { method: "PATCH", body: JSON.stringify({ reactionEmojis: nextEmojis }) });
    state.user = user;
    state.socket.emit("message:react", {
      messageId: addReactionButton.dataset.addReaction,
      emoji: emoji.trim()
    });
    state.reactionPickerMessageId = null;
    renderMessages({ preserveScroll: true });
    return;
  }
  const reactionButton = event.target.closest("[data-react]");
  if (reactionButton) {
    state.socket.emit("message:react", {
      messageId: reactionButton.dataset.react,
      emoji: reactionButton.dataset.emoji
    });
    state.reactionPickerMessageId = null;
    renderMessages({ preserveScroll: true });
    return;
  }
  const checkbox = event.target.closest("[data-select-message]");
  if (checkbox) {
    if (checkbox.checked) state.selectedMessageIds.add(checkbox.dataset.selectMessage);
    else state.selectedMessageIds.delete(checkbox.dataset.selectMessage);
    renderMessages();
    return;
  }
  const article = event.target.closest("[data-message]");
  if (state.selectionMode && article && !event.target.closest("button, a")) {
    const id = article.dataset.message;
    if (state.selectedMessageIds.has(id)) state.selectedMessageIds.delete(id);
    else state.selectedMessageIds.add(id);
    renderMessages();
    return;
  }
  if (article && state.reactionPickerMessageId && !event.target.closest("button, a, .reaction-picker")) {
    state.reactionPickerMessageId = null;
    renderMessages({ preserveScroll: true });
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

$("messages").addEventListener("mousedown", startReactionLongPress);
$("messages").addEventListener("touchstart", startReactionLongPress, { passive: true });
$("messages").addEventListener("mouseup", clearReactionLongPress);
$("messages").addEventListener("mouseleave", clearReactionLongPress);
$("messages").addEventListener("touchend", clearReactionLongPress);
$("messages").addEventListener("touchcancel", clearReactionLongPress);
$("messages").addEventListener("contextmenu", (event) => {
  const article = event.target.closest("[data-message]");
  if (!article || event.target.closest("button, a, input, label")) return;
  event.preventDefault();
  openReactionPicker(article.dataset.message);
});

$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.activeConversation) return;
  if (state.activeConversation.blockedByMe || state.activeConversation.blockedMe) {
    alert(state.activeConversation.blockedByMe ? "Unblock this user before sending a message." : "You cannot message this user.");
    return;
  }
  const text = $("messageInput").value;
  if (!text.trim()) return;
  state.socket.emit("message:send", { conversationId: state.activeConversation.id, text, replyToId: state.replyToMessageId });
  $("messageInput").value = "";
  clearReplyComposer();
});

$("cancelReplyBtn").addEventListener("click", clearReplyComposer);

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
if ($("cameraSelect")) $("cameraSelect").value = state.cameraFacingMode;
bootstrap();
