const state = {
  token: localStorage.getItem("chatToken"),
  privacyToken: sessionStorage.getItem("privacyToken"),
  user: null,
  socket: null,
  conversations: [],
  conversationView: "active",
  activeConversation: null,
  messages: [],
  starredMessages: [],
  statuses: [],
  messageSearch: { open: false, query: "", date: "", matches: [], index: 0 },
  editingMessageId: null,
  statusPreviewUrl: null,
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
  lockedConversations: [],
  lockedChatCode: "",
  calculatorExpression: "",
  calculatorJustEvaluated: false,
  privacyAutoLockTimer: null,
  privacyAwayStartedAt: Number(localStorage.getItem("privacyAwayStartedAt") || 0),
  calculatorAdvancedMode: false,
  offlineOutbox: (() => {
    try {
      return JSON.parse(localStorage.getItem("offlineOutbox") || "[]");
    } catch {
      return [];
    }
  })(),
  replyToMessageId: null,
  reactionPickerMessageId: null,
  deleteOptionsMessageId: null,
  reactionLongPressTimer: null,
  suppressNextMessageClick: false,
  userActionLongPressTimer: null,
  updateNotify: null,
  updateBlocked: false,
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
const APP_VERSION_STORAGE_KEY = "calculatorInstalledVersion";
const EMOJI_OPTIONS = [
  "\u{1F600}", "\u{1F602}", "\u{1F60A}", "\u{1F60D}", "\u{1F618}", "\u{1F60E}",
  "\u{1F973}", "\u{1F622}", "\u{1F621}", "\u{1F64F}", "\u{1F44D}", "\u{1F44E}",
  "\u{1F44F}", "\u{1F525}", "\u2764\uFE0F", "\u{1F494}", "\u2705", "\u{1F389}",
  "\u{1F4AF}", "\u2728", "\u{1F634}", "\u{1F914}", "\u{1F62E}", "\u{1F62D}",
  "\u{1F607}", "\u{1F609}", "\u{1F60B}", "\u{1F91D}", "\u{1F64C}", "\u{1F44C}"
];
const DEFAULT_REACTION_EMOJIS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}"];
const api = async (url, options = {}) => {
  try {
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
    if (!response.ok) {
      const error = new Error(data.error || "Request failed.");
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    error.offline = true;
    throw error;
  }
};

function cacheKey(name) {
  return state.token ? `${name}:${state.token.slice(0, 24)}` : name;
}

function readJson(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function cacheCurrentUser() {
  if (!state.user) return;
  writeJson(cacheKey("cachedUser"), state.user);
}

function loadCachedUser() {
  return readJson(cacheKey("cachedUser"));
}

function cacheConversations() {
  writeJson(cacheKey("cachedConversations"), state.conversations);
}

function loadCachedConversations() {
  return readJson(cacheKey("cachedConversations"), []);
}

function cacheMessages(conversationId, messages = state.messages) {
  if (!conversationId) return;
  writeJson(cacheKey(`cachedMessages:${conversationId}`), messages);
}

function loadCachedMessages(conversationId) {
  return readJson(cacheKey(`cachedMessages:${conversationId}`), []);
}

function cacheOfflineUnlockCode(code) {
  if (state.user?.id && /^\d{6}$/.test(code)) {
    localStorage.setItem(cacheKey(`offlinePrivacyCode:${state.user.id}`), code);
  }
}

function getOfflineUnlockCode() {
  return state.user?.id ? localStorage.getItem(cacheKey(`offlinePrivacyCode:${state.user.id}`)) : null;
}

function setAppReady() {
  document.body.classList.remove("app-booting");
  ensureTopbarControlsVisible();
  normalizeUiText();
  setTimeout(ensureTopbarControlsVisible, 250);
  setTimeout(ensureTopbarControlsVisible, 1200);
}

function ensureTopbarControlsVisible() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar && !document.querySelector(".sidebar-fixed-actions")) {
    sidebar.insertAdjacentHTML("afterbegin", `
      <div class="sidebar-fixed-actions">
        <button id="panicHideBtn" class="icon-button" type="button" title="Hide">H</button>
        <button id="topbarMenuBtn" class="icon-button" type="button" title="More options">&#8942;</button>
        <div id="topbarActionMenu" class="topbar-action-menu hidden" role="menu" aria-label="More options">
          <button id="profileBtn" type="button" role="menuitem"><span>&#9881;</span> Profile</button>
          <button id="sidebarInstallBtn" type="button" role="menuitem"><span>&#8595;</span> Install app</button>
          <button id="shareAppBtn" type="button" role="menuitem"><span>&#8593;</span> Share app</button>
          <button id="logoutBtn" type="button" role="menuitem"><span>&#8856;</span> Logout</button>
        </div>
      </div>
    `);
  }
  ["panicHideBtn", "topbarMenuBtn", "profileBtn", "sidebarInstallBtn", "shareAppBtn", "logoutBtn"].forEach((id) => {
    const button = $(id);
    if (!button) return;
    button.classList.remove("hidden");
    button.hidden = false;
    button.style.removeProperty("display");
    button.style.removeProperty("visibility");
    button.style.removeProperty("opacity");
  });
}

function normalizeUiText() {
  const replacements = new Map([
    ["â€¹", "<"],
    ["ï¼‹", "+"],
    ["âž¤", ">"],
    ["Ã—", "x"],
    ["â—‰", "●"],
    ["â–£", "▣"],
    ["â˜º", ":)"],
    ["Â·", "·"],
    ["âœ“", "✓"],
    ["âœ“âœ“", "✓✓"],
    ["â†”", "↔"]
  ]);
  document.querySelectorAll("button, small, span").forEach((node) => {
    if (!node.childElementCount) {
      let text = node.textContent;
      replacements.forEach((value, key) => {
        text = text.split(key).join(value);
      });
      node.textContent = text;
    }
  });
}

function setAuthMode(mode) {
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("loginForm").classList.toggle("hidden", mode !== "login");
  $("signupForm").classList.toggle("hidden", mode !== "signup");
  $("authError").textContent = "";
}

function showChat() {
  if (state.updateBlocked) return;
  $("updateRequiredView").classList.add("hidden");
  $("calculatorPrivacyView").classList.add("hidden");
  $("calculatorPrivacyView").classList.remove("unlocking");
  $("authView").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  setAppReady();
  $("meName").textContent = state.user.displayName;
  $("meHandle").textContent = `${state.user.userId} · ${state.user.mobile}`;
  ensureTopbarControlsVisible();
  $("profileName").value = state.user.displayName;
  $("profileUserId").value = state.user.userId || "";
  $("profileStatusInput").value = state.user.statusText || "";
  renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
  syncPrivacySettings();
  syncMessageAutoDeleteSettings();
  clearPrivacyAwayLock();
  requestNotificationPermission();
}

function showAuth() {
  if (state.updateBlocked) return;
  $("updateRequiredView").classList.add("hidden");
  endCall(false);
  localStorage.removeItem("chatToken");
  sessionStorage.removeItem("privacyToken");
  localStorage.removeItem("offlineOutbox");
  state.token = null;
  state.privacyToken = null;
  state.user = null;
  state.offlineOutbox = [];
  state.socket?.disconnect();
  clearTimeout(state.privacyAutoLockTimer);
  clearPrivacyAwayLock();
  $("calculatorPrivacyView").classList.add("hidden");
  $("authView").classList.remove("hidden");
  $("chatView").classList.add("hidden");
  setAppReady();
}

function connectSocket() {
  if (!state.token || (privacyEnabled() && !state.privacyToken) || typeof io !== "function") return;
  state.socket?.disconnect();
  state.socket = io({ auth: { token: state.token, privacyToken: state.privacyToken } });
  state.socket.on("connect", () => {
    flushOfflineOutbox();
  });
  state.socket.on("app:update", async ({ updateNotify } = {}) => {
    await checkRequiredUpdate(updateNotify);
  });
  state.socket.on("presence", (presence) => {
    state.presence = presence;
    renderConversations();
    renderHeader();
  });
  state.socket.on("message:new", (message) => {
    if (message.conversationId === state.activeConversation?.id) {
      loadMessages(state.activeConversation.id, false);
    }
    loadConversations();
    notifyNewMessage(message);
  });
  state.socket.on("message:status", ({ messageId, readBy, readDetails, deliveredTo, deliveredDetails }) => {
    const message = state.messages.find((item) => item.id === messageId);
    if (message) {
      message.readBy = readBy || message.readBy;
      message.readDetails = readDetails || message.readDetails;
      message.deliveredTo = deliveredTo || message.deliveredTo;
      message.deliveredDetails = deliveredDetails || message.deliveredDetails;
    }
    renderMessages();
  });
  state.socket.on("message:edited", ({ message }) => {
    const index = state.messages.findIndex((item) => item.id === message?.id);
    if (index >= 0) state.messages[index] = message;
    renderMessages({ preserveScroll: true });
    loadConversations();
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
  state.socket.on("group:updated", ({ group }) => {
    if (state.activeConversation?.groupId === group?.id) {
      state.activeConversation.group = group;
      renderHeader();
    }
    loadConversations();
  });
  state.socket.on("group:removed", ({ conversationId }) => {
    if (state.activeConversation?.id === conversationId) state.activeConversation = null;
    loadConversations();
    renderHeader();
    renderMessages();
  });
  state.socket.on("status:new", () => {
    if (state.conversationView === "status") loadStatuses();
  });
  state.socket.on("status:deleted", ({ statusId }) => {
    state.statuses = state.statuses.filter((status) => status.id !== statusId);
    if (!$("statusViewerModal").classList.contains("hidden")) $("statusViewerModal").classList.add("hidden");
    if (state.conversationView === "status") renderConversations();
  });
  state.socket.on("app:restore", () => {
    alert("Backup restore hua hai. App sync ke liye refresh hoga.");
    location.reload();
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
  const canContinue = await checkRequiredUpdate();
  if (!canContinue) return;
  if (!state.token) {
    const cachedUser = loadCachedUser();
    // Only force calculator lock for users who have enabled privacy mode.
    if (cachedUser && cachedUser.privacyMode?.enabled && cachedUser.privacyMode.hasCode) {
      state.user = cachedUser;
      state.conversations = loadCachedConversations();
      showCalculatorPrivacy();
      return;
    }
    showPendingShareLoginHint();
    setAppReady();
    return;
  }
  try {
    const { user } = await api("/api/me");
    state.user = user;
    cacheCurrentUser();
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
    ensureTopbarControlsVisible();
  } catch (error) {
    const cachedUser = loadCachedUser();
    if (!cachedUser || error.status === 401 || error.status === 403) {
      showAuth();
      return;
    }
    state.user = cachedUser;
    state.conversations = loadCachedConversations();
    if (privacyEnabled()) {
      showCalculatorPrivacy();
      return;
    }
    showChat();
    renderConversations();
    renderHeader();
    renderMessages();
  }
}

async function checkRequiredUpdate(updateNotify = null) {
  try {
    const config = updateNotify ? { updateNotify } : await api("/api/app-config");
    const notify = config.updateNotify || {};
    state.updateNotify = notify;
    const serverVersion = Number(notify.version || 1);
    const updatedVersion = Number(new URLSearchParams(location.search).get("updated") || 0);
    let installedVersion = Number(localStorage.getItem(APP_VERSION_STORAGE_KEY) || 0);
    if (updatedVersion >= serverVersion) {
      installedVersion = updatedVersion;
      localStorage.setItem(APP_VERSION_STORAGE_KEY, String(updatedVersion));
      history.replaceState(null, "", location.pathname);
    }
    if (!notify.enabled || installedVersion >= serverVersion) {
      state.updateBlocked = false;
      $("updateRequiredView").classList.add("hidden");
      if (serverVersion > installedVersion) {
        localStorage.setItem(APP_VERSION_STORAGE_KEY, String(serverVersion));
      }
      return true;
    }
    showRequiredUpdate(notify);
    return false;
  } catch {
    return true;
  }
}

function buildUpdateUrl(version = state.updateNotify?.version || 1) {
  return `${location.origin}/?updated=${encodeURIComponent(version)}&t=${Date.now()}`;
}

function showRequiredUpdate(updateNotify) {
  state.updateBlocked = true;
  endCall(false);
  state.socket?.disconnect();
  $("calculatorPrivacyView").classList.add("hidden");
  $("authView").classList.add("hidden");
  $("chatView").classList.add("hidden");
  $("profileModal").classList.add("hidden");
  $("shareModal").classList.add("hidden");
  $("callModal").classList.add("hidden");
  $("videoPreviewModal").classList.add("hidden");
  $("updateRequiredMessage").textContent = updateNotify.message || "Please update the app to continue.";
  $("updateAppLink").href = buildUpdateUrl(updateNotify.version || 1);
  $("updateHelpText").textContent = "One tap update. The app will restart automatically, or open the update link.";
  $("updateRequiredView").classList.remove("hidden");
  setAppReady();
}

async function performRequiredUpdate() {
  const button = $("updateNowBtn");
  button.disabled = true;
  button.textContent = "Updating...";
  const updateUrl = buildUpdateUrl(state.updateNotify?.version || 1);
  $("updateAppLink").href = updateUrl;
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(async (registration) => {
        await registration.update().catch(() => {});
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
        return registration.unregister();
      }));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    location.replace(updateUrl);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Update app";
    $("updateHelpText").textContent = "Update failed. Open the update link, or close and reopen the app.";
  }
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js")
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {});
    });
  }
}

function setInstallButtonsVisible(visible) {
  document.querySelectorAll(".install-control").forEach((button) => {
    button.classList.toggle("hidden", !visible);
  });
}

async function installApp() {
  if (!state.installPrompt) {
    alert("Browser menu se Install app ya Add to Home screen option use karein.");
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  setInstallButtonsVisible(false);
  ensureTopbarControlsVisible();
}

async function shareApp() {
  const appUrl = new URL("/", location.origin).href;
  const shareData = {
    title: "Calculator",
    text: "Is app ko open karke Install App ya Add to Home screen se download kar sakte hain.",
    url: appUrl
  };
  if (navigator.share) {
    await navigator.share(shareData);
    return;
  }
  const copiedText = `${shareData.text}\n${appUrl}`;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(copiedText);
    alert("App link copied. Ab ise kisi bhi user ko bhej sakte hain.");
    return;
  }
  prompt("App link copy karein", appUrl);
}

function closeTopbarMenu() {
  $("topbarActionMenu")?.classList.add("hidden");
}

function toggleTopbarMenu() {
  $("topbarActionMenu")?.classList.toggle("hidden");
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
  ensureTopbarControlsVisible();
}

function syncMessageAutoDeleteSettings() {
  if (!$("messageAutoDeleteToggle") || !state.user) return;
  const settings = state.user.messageAutoDelete || {};
  $("messageAutoDeleteToggle").checked = Boolean(settings.enabled);
  $("messageAutoDeleteTtl").value = String(settings.ttlHours || 24);
  $("messageAutoDeleteTtl").disabled = !$("messageAutoDeleteToggle").checked;
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

async function refreshPrivacyTokenFromCachedPin() {
  const code = getOfflineUnlockCode();
  if (!privacyEnabled() || state.privacyToken || !code) return false;
  try {
    const data = await api("/api/privacy/unlock", { method: "POST", body: JSON.stringify({ code }) });
    if (!data.ok || !data.privacyToken) return false;
    state.privacyToken = data.privacyToken;
    sessionStorage.setItem("privacyToken", data.privacyToken);
    state.user = data.user;
    cacheCurrentUser();
    return true;
  } catch {
    return false;
  }
}

function showCalculatorPrivacy() {
  if (state.updateBlocked) return;
  endCall(false);
  clearTimeout(state.privacyAutoLockTimer);
  clearPrivacyAwayLock();
  state.socket?.disconnect();
  state.calculatorExpression = "";
  state.calculatorJustEvaluated = false;
  updateCalculatorHistory("");
  updateCalculatorDisplay("0");
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
  if (navigator.onLine) connectSocket();
  await loadConversations().catch(() => {});
  await loadPendingShare().catch(() => {});
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

function updateCalculatorDisplay(value = state.calculatorExpression || "0") {
  $("calculatorDisplay").textContent = value;
}

function updateCalculatorHistory(text = "") {
  $("calculatorHistory").textContent = text;
}

function formatCalculatorValue(value) {
  if (!Number.isFinite(value)) return "Error";
  const normalized = Number(value.toPrecision(12));
  return normalized === 0 ? "0" : String(normalized).slice(0, 16);
}

function evaluateCalculator(expression) {
  const trimmed = String(expression || "").trim().replace(/\s+/g, "");
  if (!trimmed) return "0";
  if (!/^[\d+\-*/.]+$/.test(trimmed)) return "Error";
  const rawTokens = trimmed.match(/\d*\.?\d+|[+\-*/]/g);
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

    for (const token of tokens) {
      if (/^-?\d*\.?\d+$/.test(token)) {
        values.push(Number(token));
        continue;
      }
      while (operators.length && precedence[operators.at(-1)] >= precedence[token]) applyOperator();
      operators.push(token);
    }
    while (operators.length) applyOperator();
    if (values.length !== 1) throw new Error("Invalid expression");
    return formatCalculatorValue(values[0]);
  } catch {
    return "Error";
  }
}

function updateCalculatorOutput(displayValue, historyValue = "") {
  updateCalculatorDisplay(displayValue);
  updateCalculatorHistory(historyValue);
}

async function tryPrivacyUnlock(code) {
  if (!navigator.onLine && getOfflineUnlockCode() === code) {
    await openUnlockedChat();
    return true;
  }
  try {
    const data = await api("/api/privacy/unlock", { method: "POST", body: JSON.stringify({ code }) });
    if (!data.ok || !data.privacyToken) return false;
    state.privacyToken = data.privacyToken;
    sessionStorage.setItem("privacyToken", data.privacyToken);
    state.user = data.user;
    cacheCurrentUser();
    cacheOfflineUnlockCode(code);
    await openUnlockedChat();
    return true;
  } catch {
    return false;
  }
}

function appendCalculatorValue(value) {
  if (!/^[\d.+\-*/]$/.test(value)) return;
  if (state.calculatorJustEvaluated && /[\d.]/.test(value)) {
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
  updateCalculatorDisplay();
}

async function handleCalculatorEquals() {
  const expression = state.calculatorExpression.trim();
  const unlockMatch = expression.match(/^(\d{6})$/);
  if (unlockMatch && await tryPrivacyUnlock(unlockMatch[1])) return;
  const result = evaluateCalculator(expression || "0");
  updateCalculatorOutput(result, expression ? `${expression} =` : "");
  state.calculatorExpression = result === "Error" ? "" : result;
  state.calculatorJustEvaluated = true;
}

async function promptForLockPin(action) {
  if (!state.user) return null;
  if (!state.user.hasLockedChatPin) {
    const newPin = prompt("Set a lock PIN for locked chats (at least 4 characters):");
    if (!newPin?.trim() || newPin.trim().length < 4) {
      alert("Lock PIN must be at least 4 characters.");
      return null;
    }
    try {
      await api("/api/lock-pin", {
        method: "POST",
        body: JSON.stringify({ currentPin: "", newPin: newPin.trim() })
      });
      state.user.hasLockedChatPin = true;
      cacheCurrentUser();
      return newPin.trim();
    } catch (error) {
      alert(error.message);
      return null;
    }
  }
  const promptText = action === "view"
    ? "Enter your lock PIN to view locked chats:"
    : `Enter your lock PIN to ${action} this chat:`;
  const code = prompt(promptText);
  if (!code?.trim() || code.trim().length < 4) {
    alert("Lock PIN must be at least 4 characters.");
    return null;
  }
  return code.trim();
}

async function loadLockedConversations() {
  let code = state.lockedChatCode;
  if (!code) {
    code = await promptForLockPin("view");
    if (!code) {
      state.conversationView = "active";
      await loadConversations();
      return;
    }
  }
  try {
    const { conversations } = await api(`/api/conversations/locked?code=${encodeURIComponent(code)}`);
    state.conversations = conversations;
    state.lockedChatCode = code;
    renderConversations();
  } catch (error) {
    if (error.status === 403) alert("Invalid lock PIN.");
    else throw error;
    state.conversationView = "active";
    await loadConversations();
  }
}

async function loadConversations() {
  try {
    if (state.conversationView === "locked") {
      await loadLockedConversations();
      return;
    }
    const archived = state.conversationView === "archived" ? "?archived=1" : "";
    const { conversations } = await api(`/api/conversations${archived}`);
    state.conversations = conversations;
    cacheConversations();
    renderConversations();
  } catch (error) {
    if (!error.offline && error.status !== 503) throw error;
    state.conversations = loadCachedConversations();
    renderConversations();
  }
}

async function toggleConversationLock() {
  if (!state.activeConversation) return;
  const action = state.activeConversation.locked ? "unlock" : "lock";
  const code = await promptForLockPin(action);
  if (!code) return;
  const url = `/api/conversations/${encodeURIComponent(state.activeConversation.id)}/${action}`;
  const result = await api(url, { method: "POST", body: JSON.stringify({ code }) });
  state.activeConversation = result.conversation;
  if (state.conversationView === "locked") {
    await loadLockedConversations();
  } else {
    await loadConversations();
  }
  renderHeader();
  if (state.activeConversation) {
    await loadMessages(state.activeConversation.id);
  }
}

async function loadStarredMessages() {
  const { messages } = await api("/api/messages/starred");
  state.starredMessages = messages;
  renderConversations();
}

async function loadStatuses() {
  const { statuses } = await api("/api/statuses");
  state.statuses = statuses;
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

async function loadMessages(conversationId, preserveScroll = false) {
  try {
    const { messages } = await api(`/api/conversations/${conversationId}/messages`);
    state.messages = messages;
    cacheMessages(conversationId);
  } catch (error) {
    if (!error.offline && error.status !== 503) throw error;
    state.messages = loadCachedMessages(conversationId);
  }
  renderMessages({ preserveScroll });
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

function statusLine(user) {
  return user?.statusText ? `Status: ${user.statusText}` : "";
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
  $("activeChatsBtn")?.classList.toggle("active", state.conversationView === "active");
  $("lockedChatsBtn")?.classList.toggle("active", state.conversationView === "locked");
  $("archivedChatsBtn")?.classList.toggle("active", state.conversationView === "archived");
  $("statusViewBtn")?.classList.toggle("active", state.conversationView === "status");
  $("starredViewBtn")?.classList.toggle("active", state.conversationView === "starred");
  $("statusComposer")?.classList.toggle("hidden", state.conversationView !== "status");
  if (state.conversationView === "starred") {
    $("conversationList").innerHTML = state.starredMessages.map((message) => {
      const conversation = state.conversations.find((item) => item.id === message.conversationId);
      const title = conversation?.group?.name || getOtherMember(conversation || {})?.displayName || "Chat";
      return `
        <button class="conversation" data-starred-message="${message.id}" data-conversation="${message.conversationId}" type="button">
          <span class="avatar">*</span>
          <span class="conversation-main">
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(messageSnippet(message))}</small>
          </span>
        </button>`;
    }).join("") || `<div class="empty-list">No starred messages.</div>`;
    return;
  }
  if (state.conversationView === "status") {
    $("conversationList").innerHTML = state.statuses.map((status) => `
      <button class="conversation status-item ${status.viewedByMe ? "" : "unread-status"}" data-status="${status.id}" type="button">
        <span class="avatar">${avatarMarkup(status.user, "S")}</span>
        <span class="conversation-main">
          <strong>${escapeHtml(status.user?.displayName || "Status")}</strong>
          <small>${escapeHtml(statusPreviewText(status))} · ${status.viewerCount || 0} views</small>
        </span>
      </button>
    `).join("") || `<div class="empty-list">No recent statuses.</div>`;
    normalizeUiText();
    return;
  }
  $("conversationList").innerHTML = state.conversations.map((conversation) => {
    const title = conversation.group?.name || getOtherMember(conversation)?.displayName || "Chat";
    const other = getOtherMember(conversation);
    const status = conversation.group ? `${conversation.members.length} members` : formatPresenceStatus(other?.id);
    const profileStatus = !conversation.group ? statusLine(other) : "";
    const last = conversation.locked ? "Locked chat" : (conversation.lastMessage?.media ? `[${conversation.lastMessage.media.kind}]` : conversation.lastMessage?.text || "No messages yet");
    return `
      <button class="conversation ${state.activeConversation?.id === conversation.id ? "active" : ""}" data-id="${conversation.id}" type="button">
        <span class="avatar">${avatarMarkup(other, title)}</span>
        <span class="conversation-main">
          <strong>${conversation.pinned ? "Pinned " : ""}${escapeHtml(title)}</strong>
          <small>${escapeHtml(conversation.locked ? `${profileStatus ? `${profileStatus} · ` : ""}Locked chat` : profileStatus || last)}</small>
        </span>
        ${conversation.unreadCount ? `<span class="unread-badge">${conversation.unreadCount}</span>` : ""}
        <span class="status-dot ${status === "Online" ? "online" : ""}" title="${status}"></span>
      </button>`;
  }).join("") || `<div class="empty-list">No conversations found.</div>`;
  normalizeUiText();
}

function renderHeader() {
  const conversation = state.activeConversation;
  $("selectMessagesBtn").disabled = !conversation;
  $("clearChatBtn").disabled = !conversation;
  $("messageSearchBtn").disabled = !conversation;
  $("pinChatBtn").disabled = !conversation;
  $("archiveChatBtn").disabled = !conversation;
  $("groupInfoBtn").classList.add("hidden");
  $("lockChatBtn")?.classList.toggle("hidden", !conversation || conversation.groupId);
  closeUserActionMenu();
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
  $("pinChatBtn").textContent = conversation.pinned ? "Unpin" : "Pin";
  $("archiveChatBtn").textContent = conversation.archived ? "Unarchive" : "Archive";
  $("groupInfoBtn").classList.toggle("hidden", !conversation.groupId);
  if (!conversation.groupId && other?.statusText) {
    $("chatStatus").textContent = `${other.statusText} · ${formatPresenceStatus(other.id)}`;
  }
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
    $("lockChatBtn").classList.remove("hidden");
    $("lockChatBtn").textContent = conversation.locked ? "Unlock" : "Lock";
    syncUserActionMenuLabels();
  }
}

function syncUserActionMenuLabels() {
  const conversation = state.activeConversation;
  $("menuHideChatBtn").textContent = conversation?.hidden ? "Unhide user" : "Hide user";
  $("menuBlockUserBtn").textContent = conversation?.blockedByMe ? "Unblock user" : "Block user";
}

function canShowUserActionMenu() {
  return Boolean(state.activeConversation && !state.activeConversation.groupId && getOtherMember(state.activeConversation)?.id);
}

function openUserActionMenu(anchor = $("chatIdentity")) {
  if (!canShowUserActionMenu()) return;
  syncUserActionMenuLabels();
  const menu = $("userActionMenu");
  const headerRect = anchor.closest(".chat-header").getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(12, anchorRect.left - headerRect.left)}px`;
  menu.style.top = `${Math.min(headerRect.height - 4, anchorRect.bottom - headerRect.top + 8)}px`;
  menu.classList.remove("hidden");
}

function closeUserActionMenu() {
  $("userActionMenu")?.classList.add("hidden");
}

function startUserActionLongPress(event) {
  if (!canShowUserActionMenu()) return;
  clearTimeout(state.userActionLongPressTimer);
  state.userActionLongPressTimer = setTimeout(() => {
    event.preventDefault();
    openUserActionMenu(event.currentTarget);
  }, 520);
}

function cancelUserActionLongPress() {
  clearTimeout(state.userActionLongPressTimer);
}

function renderMessages({ preserveScroll = false } = {}) {
  if (!state.activeConversation) {
    clearReplyComposer();
    $("messages").className = "messages empty-state";
    $("messages").textContent = "No conversation selected.";
    return;
  }
  $("messages").className = "messages";
  const messagesEl = $("messages");
  const previousScrollHeight = messagesEl.scrollHeight;
  const previousScrollTop = messagesEl.scrollTop;
  const wasScrolledToBottom = previousScrollHeight - previousScrollTop - messagesEl.clientHeight <= 80;
  updateMessageSearchMatches();
  $("messages").innerHTML = state.messages.map((message) => {
    const own = message.senderId === state.user.id;
    const ticks = own ? tickLabel(message) : "";
    const selected = state.selectedMessageIds.has(message.id);
    const searchHit = state.messageSearch.matches.includes(message.id);
    const currentHit = searchHit && state.messageSearch.matches[state.messageSearch.index] === message.id;
    const starred = (state.user.starredMessageIds || []).includes(message.id);
    return `
      <article class="message ${own ? "own" : ""} ${selected ? "selected" : ""} ${searchHit ? "search-hit" : ""} ${currentHit ? "current-hit" : ""}" data-message="${message.id}">
        ${state.selectionMode ? `<label class="message-select"><input type="checkbox" data-select-message="${message.id}" ${selected ? "checked" : ""}> Select</label>` : ""}
        ${renderReplyPreview(message.replyTo)}
        ${renderMedia(message.media)}
        ${message.text ? `<p>${renderMessageText(message.text, state.messageSearch.query)}</p>` : ""}
        ${renderReactions(message)}
        <footer>
          <time>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          ${message.editedAt ? `<span class="edited-label">edited</span>` : ""}
          ${starred ? `<span class="star-label">saved</span>` : ""}
          ${own ? `<span class="ticks ${ticks === "blue" ? "blue" : ""}">${ticks === "single" ? "&check;" : "&check;&check;"}</span>` : ""}
        </footer>
        ${state.reactionPickerMessageId === message.id ? renderReactionPicker(message) : ""}
      </article>`;
  }).join("");
  if (!preserveScroll || wasScrolledToBottom) {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  } else {
    messagesEl.scrollTop = Math.max(0, previousScrollTop + messagesEl.scrollHeight - previousScrollHeight);
  }
  scrollToCurrentSearchHit();
  renderReplyComposer();
  renderEditComposer();
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

function canEditMessage(message) {
  return message.senderId === state.user.id
    && !message.media
    && Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
}

function canDeleteMessageForEveryone(message) {
  return message.senderId === state.user.id
    && Date.now() - new Date(message.createdAt).getTime() <= 5 * 60 * 1000;
}

function renderReactionPicker(message) {
  const showDeleteOptions = state.deleteOptionsMessageId === message.id;
  return `
    <div class="reaction-picker message-action-popover" role="menu" aria-label="Message actions">
      ${renderReactionButtons(message)}
      <button class="reaction-add" data-add-reaction="${message.id}" type="button" title="Add emoji">+</button>
      <span class="message-action-divider"></span>
      <button class="message-action-button" data-action-reply="${message.id}" type="button">Reply</button>
      <button class="message-action-button" data-star="${message.id}" type="button">${(state.user.starredMessageIds || []).includes(message.id) ? "Unsave" : "Save"}</button>
      ${canEditMessage(message) ? `<button class="message-action-button" data-edit="${message.id}" type="button">Edit</button>` : ""}
      ${message.senderId === state.user.id ? `<button class="message-action-button" data-details="${message.id}" type="button">Details</button>` : ""}
      <button class="message-action-button" data-share-message="${message.id}" type="button">Forward</button>
      <button class="message-action-button" data-share-outside="${message.id}" type="button">Share outside</button>
      <button class="message-action-button danger ${showDeleteOptions ? "active" : ""}" data-delete-options="${message.id}" type="button">Delete</button>
      ${showDeleteOptions ? `
        <span class="message-action-divider delete-divider"></span>
        <button class="message-action-button danger" data-delete-for-me="${message.id}" type="button">Delete for me</button>
        ${canDeleteMessageForEveryone(message) ? `<button class="message-action-button danger" data-delete-everyone="${message.id}" type="button">Delete everyone</button>` : ""}
      ` : ""}
    </div>
  `;
}

function statusPreviewText(status) {
  if (status.text) return status.text;
  if (status.media?.kind === "video") return "Video status";
  if (status.media?.kind === "image") return "Photo status";
  return "Status";
}

function renderStatusMedia(status) {
  const media = status.media;
  if (!media) return "";
  if (media.kind === "image") {
    return `<img class="status-viewer-media" src="${media.url}" alt="${escapeHtml(media.originalName || "Status image")}">`;
  }
  if (media.kind === "video") {
    return `<video class="status-viewer-media" controls playsinline preload="metadata" data-status-clip="${media.clipTo || 60}" src="${media.url}#t=0,${media.clipTo || 60}"></video>`;
  }
  return "";
}

function openStatusViewer(status) {
  $("statusViewerTitle").textContent = status.user?.displayName || "Status";
  const viewers = Array.isArray(status.viewers) ? status.viewers : [];
  const viewerHtml = status.canDelete
    ? `<div class="status-viewers">
        <strong>Viewed by ${status.viewerCount || 0}</strong>
        ${viewers.map((view) => `<small>${escapeHtml(view.user?.displayName || view.user?.userId || "User")} · ${new Date(view.at).toLocaleString()}</small>`).join("") || "<small>No viewers yet.</small>"}
      </div>
      <button class="text-button danger" data-delete-status="${status.id}" type="button">Delete status</button>`
    : "";
  $("statusViewerBody").innerHTML = `
    ${renderStatusMedia(status)}
    ${status.text ? `<p>${escapeHtml(status.text)}</p>` : ""}
    ${viewerHtml}
  ` || "<p>Status unavailable.</p>";
  const created = status.createdAt ? new Date(status.createdAt).toLocaleString() : "";
  $("statusViewerMeta").textContent = `${status.viewerCount || 0} views${created ? ` · ${created}` : ""}`;
  $("statusViewerModal").classList.remove("hidden");
  enforceStatusVideoClip($("statusViewerBody").querySelector("video[data-status-clip]"));
}

function enforceStatusVideoClip(video) {
  if (!video) return;
  const clipTo = Number(video.dataset.statusClip || 60);
  if (!Number.isFinite(clipTo) || clipTo <= 0) return;
  video.addEventListener("timeupdate", () => {
    if (video.currentTime >= clipTo) {
      video.pause();
      video.currentTime = 0;
    }
  });
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

function renderEditComposer() {
  const message = state.messages.find((item) => item.id === state.editingMessageId);
  $("editComposer")?.classList.toggle("hidden", !message);
}

function cancelEditComposer() {
  state.editingMessageId = null;
  $("messageInput").value = "";
  renderEditComposer();
}

function searchableMessageText(message) {
  return [message.text, message.media?.originalName, message.media?.kind, message.media?.caption]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function updateMessageSearchMatches() {
  const query = state.messageSearch.query.trim().toLowerCase();
  const date = state.messageSearch.date;
  state.messageSearch.matches = state.messages
    .filter((message) => !query || searchableMessageText(message).includes(query))
    .filter((message) => !date || message.createdAt?.slice(0, 10) === date)
    .map((message) => message.id);
  if (state.messageSearch.index >= state.messageSearch.matches.length) state.messageSearch.index = 0;
  $("messageSearchCount").textContent = state.messageSearch.matches.length
    ? `${state.messageSearch.index + 1}/${state.messageSearch.matches.length}`
    : "0/0";
}

function scrollToCurrentSearchHit() {
  const id = state.messageSearch.matches[state.messageSearch.index];
  if (!id) return;
  const element = $ ("messages").querySelector(`[data-message="${CSS.escape(id)}"]`);
  element?.scrollIntoView({ block: "center" });
}

function setMessageSearchOpen(open) {
  state.messageSearch.open = open;
  if (!open) {
    state.messageSearch.query = "";
    state.messageSearch.date = "";
    $("messageSearchInput").value = "";
    $("messageSearchDate").value = "";
  }
  $("messageSearchBar").classList.toggle("hidden", !open);
  if (open) $("messageSearchInput").focus();
  renderMessages({ preserveScroll: true });
}

function memberLabel(userId) {
  const user = state.activeConversation?.members?.find((item) => item.id === userId);
  return user?.displayName || user?.userId || "User";
}

function detailRows(items = []) {
  if (!items.length) return "<p>No users yet.</p>";
  return items.map((item) => `<p><strong>${escapeHtml(memberLabel(item.userId || item))}</strong><small>${escapeHtml(item.at ? new Date(item.at).toLocaleString() : "")}</small></p>`).join("");
}

function showMessageDetails(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) return;
  $("detailsBody").innerHTML = `
    <h3>Delivered to</h3>
    ${detailRows(message.deliveredDetails || (message.deliveredTo || []).map((userId) => ({ userId })))}
    <h3>Read by</h3>
    ${detailRows((message.readDetails || []).filter((item) => item.userId !== state.user.id))}
  `;
  $("detailsModal").classList.remove("hidden");
}

function currentUserCanManageGroup() {
  const group = state.activeConversation?.group;
  return Boolean(group && (group.ownerId === state.user.id || (group.adminIds || []).includes(state.user.id)));
}

function renderGroupMembersList() {
  const canManage = currentUserCanManageGroup();
  const group = state.activeConversation?.group;
  $("groupMembersList").innerHTML = (state.activeConversation?.members || []).map((member) => `
    <div class="group-member-row">
      <span>${escapeHtml(member.displayName || member.userId || "User")}${group?.ownerId === member.id ? " · owner" : (group?.adminIds || []).includes(member.id) ? " · admin" : ""}</span>
      ${canManage && group?.ownerId !== member.id ? `<button data-remove-group-member="${member.id}" type="button">Remove</button>` : ""}
    </div>
  `).join("");
}

function openReactionPicker(messageId, { toggle = true } = {}) {
  if (!messageId || state.selectionMode) return;
  state.reactionPickerMessageId = toggle && state.reactionPickerMessageId === messageId ? null : messageId;
  state.deleteOptionsMessageId = null;
  renderMessages({ preserveScroll: true });
}

function clearReactionLongPress() {
  if (!state.reactionLongPressTimer) return;
  clearTimeout(state.reactionLongPressTimer);
  state.reactionLongPressTimer = null;
}

function startReactionLongPress(event) {
  const article = event.target.closest("[data-message]");
  if (!article || event.target.closest("button, a, input, label, select")) return;
  clearReactionLongPress();
  state.reactionLongPressTimer = setTimeout(() => {
    state.reactionLongPressTimer = null;
    state.suppressNextMessageClick = true;
    event.preventDefault();
    openReactionPicker(article.dataset.message, { toggle: false });
    setTimeout(() => {
      state.suppressNextMessageClick = false;
    }, 900);
  }, 550);
}

function pendingShareFromMessage(message) {
  return {
    id: null,
    text: message.text || "",
    media: message.media ? [{ ...message.media }] : []
  };
}

function openMessageShare(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) return;
  state.pendingShare = pendingShareFromMessage(message);
  state.reactionPickerMessageId = null;
  renderMessages({ preserveScroll: true });
  showShareModal();
}

async function shareMessageOutside(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) return;
  const mediaUrl = message.media?.url ? new URL(message.media.url, location.origin).href : "";
  const text = [message.text, message.media?.originalName, mediaUrl].filter(Boolean).join("\n");
  state.reactionPickerMessageId = null;
  renderMessages({ preserveScroll: true });
  if (navigator.share) {
    await navigator.share({ title: "Shared message", text: text || "Message", url: mediaUrl || undefined });
    return;
  }
  await navigator.clipboard.writeText(text || "Message");
  alert("Share content copied.");
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
    if (state.pendingShare.id) {
      await api(`/api/shared/${encodeURIComponent(state.pendingShare.id)}`, { method: "DELETE" });
    }
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
  if (message.pending) return "single";
  const others = state.activeConversation.participants.filter((id) => id !== state.user.id);
  if (others.every((id) => message.readBy?.includes(id))) return "blue";
  if (others.some((id) => message.deliveredTo?.includes(id))) return "double";
  return "single";
}

function saveOfflineOutbox() {
  localStorage.setItem("offlineOutbox", JSON.stringify(state.offlineOutbox));
}

function updateCachedConversationPreview(conversationId, message) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  conversation.lastMessage = message;
  cacheConversations();
  renderConversations();
}

function addLocalOutgoingMessage({ conversationId, text, replyToId }) {
  const replyTo = state.messages.find((message) => message.id === replyToId);
  const message = {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    conversationId,
    senderId: state.user.id,
    text: text.trim(),
    media: null,
    createdAt: new Date().toISOString(),
    deliveredTo: [],
    readBy: [state.user.id],
    replyTo: replyTo ? {
      id: replyTo.id,
      senderId: replyTo.senderId,
      senderName: senderName(replyTo.senderId),
      text: replyTo.text || "",
      mediaName: replyTo.media?.originalName || ""
    } : null,
    reactions: {},
    deletedFor: [],
    pending: true
  };
  state.messages.push(message);
  cacheMessages(conversationId);
  updateCachedConversationPreview(conversationId, message);
  renderMessages();
  return message;
}

function sendTextMessage(conversationId, text, replyToId = null) {
  const payload = { conversationId, text: text.trim(), replyToId };
  if (!payload.text) return;
  if (state.socket?.connected) {
    state.socket.emit("message:send", payload);
    return;
  }
  state.offlineOutbox.push({ ...payload, queuedAt: new Date().toISOString() });
  saveOfflineOutbox();
  addLocalOutgoingMessage(payload);
}

async function flushOfflineOutbox() {
  if (!state.offlineOutbox.length || !state.socket?.connected) return;
  if (privacyEnabled() && !state.privacyToken && !(await refreshPrivacyTokenFromCachedPin())) return;
  const queued = [...state.offlineOutbox];
  state.offlineOutbox = [];
  saveOfflineOutbox();
  queued.forEach((payload) => state.socket.emit("message:send", payload));
  if (state.activeConversation) {
    await loadMessages(state.activeConversation.id).catch(() => {});
  }
  await loadConversations().catch(() => {});
}

function notifyNewMessage(message) {
  if (message.senderId === state.user.id) return;
  try {
    navigator.vibrate?.(80);
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    gain.gain.value = 0.04;
    oscillator.frequency.value = 680;
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
  } catch {}
  if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") return;
  const notification = new Notification("New Calculator alert", {
    body: message.text || message.media?.originalName || "New message",
    tag: message.conversationId
  });
  notification.onclick = () => {
    window.focus();
    openConversationById(message.conversationId);
    notification.close();
  };
}

function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

async function openConversationById(conversationId, messageId = null) {
  let conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    state.conversationView = "active";
    await loadConversations();
    conversation = state.conversations.find((item) => item.id === conversationId);
  }
  if (!conversation) {
    state.conversationView = "archived";
    await loadConversations();
    conversation = state.conversations.find((item) => item.id === conversationId);
  }
  if (!conversation) return;
  state.activeConversation = conversation;
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  clearReplyComposer();
  if (state.socket?.connected) state.socket.emit("conversation:join", { conversationId });
  renderHeader();
  renderConversations();
  await loadMessages(conversationId);
  $("chatView").classList.add("conversation-open");
  if (messageId) {
    const element = $("messages").querySelector(`[data-message="${CSS.escape(messageId)}"]`);
    element?.scrollIntoView({ block: "center" });
    element?.classList.add("current-hit");
  }
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
  try {
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
  } catch (error) {
    console.warn("Call recording could not start:", error);
  }
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
    if (peerConnection.connectionState === "connected") startCallRecording();
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

function renderMessageText(value = "", highlight = "") {
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
      html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${highlightSearchText(trimmedUrl, highlight)}</a>`;
    }
    html += highlightSearchText(trailingText, highlight);
    lastIndex = match.index + rawUrl.length;
  }

  return html + highlightSearchText(text.slice(lastIndex), highlight);
}

function highlightSearchText(value = "", query = "") {
  const text = String(value);
  if (!query) return escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedQuery) return escapeHtml(text);
  return escapeHtml(text).replace(new RegExp(`(${escapedQuery})`, "ig"), "<mark>$1</mark>");
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
  if (state.activeConversation && state.socket?.connected) state.socket.emit("typing", { conversationId: state.activeConversation.id, typing: true });
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("signupTab").addEventListener("click", () => setAuthMode("signup"));
$("logoutBtn").addEventListener("click", () => {
  closeTopbarMenu();
  showAuth();
});
$("calculatorPrivacyView").addEventListener("pointerdown", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const value = button.dataset.calcValue;
  const action = button.dataset.calcAction;
  const fn = button.dataset.calcFn;
  if (!value && !action && !fn) return;
  event.preventDefault();

  if (value) appendCalculatorValue(value);
  if (action === "clear") {
    state.calculatorExpression = "";
    state.calculatorJustEvaluated = false;
    updateCalculatorHistory("");
    updateCalculatorDisplay("0");
    return;
  }
  if (action === "delete") {
    state.calculatorExpression = state.calculatorExpression.slice(0, -1);
    updateCalculatorDisplay();
    return;
  }
  if (action === "toggle-sign") {
    const value = state.calculatorExpression.trim();
    if (!value || value === "0") return;
    if (value.startsWith("-")) {
      state.calculatorExpression = value.slice(1);
    } else {
      state.calculatorExpression = `-${value}`;
    }
    updateCalculatorDisplay();
    return;
  }
  if (action === "percent") {
    const value = Number(state.calculatorExpression) || 0;
    state.calculatorExpression = String(value / 100);
    updateCalculatorDisplay();
    return;
  }
  if (action === "equals") {
    await handleCalculatorEquals();
    return;
  }
  if (fn) {
    const value = Number(state.calculatorExpression) || 0;
    let result = value;
    switch (fn) {
      case "sin": result = Math.sin(value); break;
      case "cos": result = Math.cos(value); break;
      case "tan": result = Math.tan(value); break;
      case "log": result = value > 0 ? Math.log10(value) : NaN; break;
      case "sqrt": result = value >= 0 ? Math.sqrt(value) : NaN; break;
      case "square": result = value * value; break;
      case "exp": result = Math.exp(value); break;
      case "pi": result = Math.PI; break;
      default: return;
    }
    state.calculatorExpression = Number.isFinite(result) ? String(Number(result.toPrecision(12))) : "Error";
    updateCalculatorDisplay();
  }
});
$("calculatorModeToggle").addEventListener("click", () => {
  state.calculatorAdvancedMode = !state.calculatorAdvancedMode;
  $("calculatorModeToggle").setAttribute("aria-pressed", String(state.calculatorAdvancedMode));
  $("calculatorModeToggle").textContent = state.calculatorAdvancedMode ? "Basic" : "Advanced";
  $("calculatorAdvancedRow").classList.toggle("hidden", !state.calculatorAdvancedMode);
  document.body.classList.toggle("calculator-advanced", state.calculatorAdvancedMode);
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
    event.preventDefault();
    appendCalculatorValue(event.key);
    return;
  }
  if (event.key === "Enter" || event.key === "=") {
    event.preventDefault();
    handleCalculatorEquals();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    state.calculatorExpression = state.calculatorExpression.slice(0, -1);
    updateCalculatorDisplay();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    state.calculatorExpression = "";
    updateCalculatorHistory("");
    updateCalculatorDisplay();
  }
});
$("profileBtn").addEventListener("click", () => {
  closeTopbarMenu();
  $("profileName").value = state.user.displayName;
  $("profileUserId").value = state.user.userId || "";
  $("profileStatusInput").value = state.user.statusText || "";
  $("profileAvatarInput").value = "";
  renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
  $("privacyCodeInput").value = "";
  syncPrivacySettings();
  syncMessageAutoDeleteSettings();
  $("profileMessage").textContent = "";
  $("profileMessage").classList.remove("success-text");
  $("profileModal").classList.remove("hidden");
});
$("closeProfileBtn").addEventListener("click", () => $("profileModal").classList.add("hidden"));
$("lockChatBtn").addEventListener("click", async () => {
  try {
    await toggleConversationLock();
  } catch (error) {
    alert(error.message);
  }
});
$("messageAutoDeleteToggle").addEventListener("change", () => {
  $("messageAutoDeleteTtl").disabled = !$("messageAutoDeleteToggle").checked;
});
$("chatIdentity").addEventListener("pointerdown", startUserActionLongPress);
$("chatIdentity").addEventListener("pointerup", cancelUserActionLongPress);
$("chatIdentity").addEventListener("pointerleave", cancelUserActionLongPress);
$("chatIdentity").addEventListener("pointercancel", cancelUserActionLongPress);
$("chatIdentity").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openUserActionMenu(event.currentTarget);
});
$("chatIdentity").addEventListener("dblclick", (event) => {
  event.preventDefault();
  openUserActionMenu(event.currentTarget);
});
$("menuHideChatBtn").addEventListener("click", () => {
  closeUserActionMenu();
  $("hideChatBtn").click();
});
$("menuBlockUserBtn").addEventListener("click", () => {
  closeUserActionMenu();
  $("blockUserBtn").click();
});
$("menuDeleteUserBtn").addEventListener("click", () => {
  closeUserActionMenu();
  $("deleteUserBtn").click();
});
document.addEventListener("click", (event) => {
  if (event.target.closest("#userActionMenu") || event.target.closest("#chatIdentity")) return;
  closeUserActionMenu();
});
$("profileAvatarInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
    return;
  }
  $("profileAvatarPreview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Profile preview">`;
});
document.querySelectorAll(".install-control").forEach((button) => {
  button.addEventListener("click", () => {
    installApp().catch((error) => alert(error.message));
  });
});
$("updateNowBtn").addEventListener("click", () => {
  performRequiredUpdate();
});
$("sidebarInstallBtn").addEventListener("click", () => {
  closeTopbarMenu();
  installApp().catch((error) => alert(error.message));
});
$("shareAppBtn").addEventListener("click", () => {
  closeTopbarMenu();
  shareApp().catch((error) => {
    if (error.name !== "AbortError") alert(error.message);
  });
});
$("topbarMenuBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleTopbarMenu();
});
document.addEventListener("click", (event) => {
  if (event.target.closest(".sidebar-fixed-actions")) return;
  closeTopbarMenu();
});
$("backBtn").addEventListener("click", () => $("chatView").classList.remove("conversation-open"));
$("activeChatsBtn").addEventListener("click", async () => {
  state.conversationView = "active";
  await loadConversations();
});
$("lockedChatsBtn").addEventListener("click", async () => {
  state.conversationView = "locked";
  await loadConversations();
});
$("archivedChatsBtn").addEventListener("click", async () => {
  state.conversationView = "archived";
  await loadConversations();
});
$("statusViewBtn").addEventListener("click", async () => {
  state.conversationView = "status";
  await loadStatuses();
});
$("starredViewBtn").addEventListener("click", async () => {
  state.conversationView = "starred";
  await loadStarredMessages();
});
$("messageSearchBtn").addEventListener("click", () => setMessageSearchOpen(!state.messageSearch.open));
$("messageSearchInput").addEventListener("input", () => {
  state.messageSearch.query = $("messageSearchInput").value;
  state.messageSearch.index = 0;
  renderMessages({ preserveScroll: true });
});
$("messageSearchDate").addEventListener("change", () => {
  state.messageSearch.date = $("messageSearchDate").value;
  state.messageSearch.index = 0;
  renderMessages({ preserveScroll: true });
});
$("messageSearchPrev").addEventListener("click", () => {
  if (!state.messageSearch.matches.length) return;
  state.messageSearch.index = (state.messageSearch.index - 1 + state.messageSearch.matches.length) % state.messageSearch.matches.length;
  renderMessages({ preserveScroll: true });
});
$("messageSearchNext").addEventListener("click", () => {
  if (!state.messageSearch.matches.length) return;
  state.messageSearch.index = (state.messageSearch.index + 1) % state.messageSearch.matches.length;
  renderMessages({ preserveScroll: true });
});
$("messageSearchClose").addEventListener("click", () => setMessageSearchOpen(false));
$("closeDetailsBtn").addEventListener("click", () => $("detailsModal").classList.add("hidden"));
$("closeStatusViewerBtn").addEventListener("click", () => $("statusViewerModal").classList.add("hidden"));
$("statusViewerBody").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-status]");
  if (!button) return;
  if (!confirm("Delete this status?")) return;
  button.disabled = true;
  try {
    await api(`/api/statuses/${button.dataset.deleteStatus}`, { method: "DELETE" });
    state.statuses = state.statuses.filter((status) => status.id !== button.dataset.deleteStatus);
    $("statusViewerModal").classList.add("hidden");
    renderConversations();
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
});
$("groupInfoBtn").addEventListener("click", () => {
  const group = state.activeConversation?.group;
  if (!group) return;
  $("groupNameInput").value = group.name || "";
  $("groupDescriptionInput").value = group.description || "";
  $("groupMessage").textContent = "";
  renderGroupMembersList();
  $("groupModal").classList.remove("hidden");
});
$("closeGroupBtn").addEventListener("click", () => $("groupModal").classList.add("hidden"));
$("pinChatBtn").addEventListener("click", async () => {
  if (!state.activeConversation) return;
  const { conversation } = await api(`/api/conversations/${state.activeConversation.id}/preferences`, {
    method: "PATCH",
    body: JSON.stringify({ pinned: !state.activeConversation.pinned })
  });
  state.activeConversation = conversation;
  await loadConversations();
  renderHeader();
});
$("archiveChatBtn").addEventListener("click", async () => {
  if (!state.activeConversation) return;
  const archived = !state.activeConversation.archived;
  await api(`/api/conversations/${state.activeConversation.id}/preferences`, {
    method: "PATCH",
    body: JSON.stringify({ archived })
  });
  state.activeConversation.archived = archived;
  await loadConversations();
  renderHeader();
});
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

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    const fallbackTimer = setTimeout(() => {
      cleanup();
      resolve(0);
    }, 5000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      clearTimeout(fallbackTimer);
      cleanup();
      resolve(Number(video.duration || 0));
    };
    video.onerror = () => {
      clearTimeout(fallbackTimer);
      cleanup();
      resolve(0);
    };
    video.src = url;
    video.load();
  });
}

async function validateStatusFile(file) {
  if (!file) return null;
  const name = String(file.name || "").toLowerCase();
  const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(name);
  const isVideo = file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpeg|mpg)$/.test(name);
  if (isImage) return { kind: "image" };
  if (isVideo) {
    const duration = await getVideoDuration(file);
    return {
      kind: "video",
      duration: duration > 0 ? Math.min(duration, 60) : 60,
      originalDuration: duration > 0 ? duration : null,
      clipTo: 60
    };
  }
  throw new Error("Status me sirf image ya video upload kar sakte hain.");
}

function setStatusUploadProgress(percent = 0, text = "") {
  $("statusUploadProgress").value = Math.max(0, Math.min(100, Number(percent) || 0));
  $("statusUploadText").textContent = text || `${Math.round($("statusUploadProgress").value)}% uploaded`;
  $("statusUploadProgressWrap").classList.toggle("hidden", !text && percent <= 0);
}

function clearStatusFilePreview() {
  if (state.statusPreviewUrl) URL.revokeObjectURL(state.statusPreviewUrl);
  state.statusPreviewUrl = null;
  $("statusFilePreview").innerHTML = "";
  $("statusFilePreview").classList.add("hidden");
  setStatusUploadProgress(0, "");
}

function renderStatusFilePreview(file, meta = {}) {
  if (state.statusPreviewUrl) URL.revokeObjectURL(state.statusPreviewUrl);
  state.statusPreviewUrl = URL.createObjectURL(file);
  const mediaHtml = meta.kind === "video"
    ? `<video src="${state.statusPreviewUrl}" muted playsinline preload="metadata"></video>`
    : `<img src="${state.statusPreviewUrl}" alt="${escapeHtml(file.name)}">`;
  const duration = meta.duration ? ` · ${Math.round(meta.duration)}s` : "";
  $("statusFilePreview").innerHTML = `
    ${mediaHtml}
    <div>
      <strong>${escapeHtml(file.name)}</strong>
      <small>${escapeHtml(formatFileSize(file.size))}${duration}</small>
    </div>
    <button id="clearStatusFileBtn" type="button" title="Remove media">x</button>
  `;
  $("statusFilePreview").classList.remove("hidden");
}

function uploadStatusFile(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/upload");
    if (state.token) request.setRequestHeader("Authorization", `Bearer ${state.token}`);
    if (state.privacyToken) request.setRequestHeader("X-Privacy-Token", state.privacyToken);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let data = {};
      try {
        data = JSON.parse(request.responseText || "{}");
      } catch {
        reject(new Error("Upload response invalid hai."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || "Upload failed."));
        return;
      }
      resolve(data.media);
    };
    request.onerror = () => reject(new Error("Upload failed. Network check karein."));
    request.send(formData);
  });
}

$("statusImageBtn").addEventListener("click", () => $("statusImageInput").click());
$("statusImageInput").addEventListener("change", async () => {
  clearStatusFilePreview();
  const file = $("statusImageInput").files?.[0];
  if (!file) return;
  try {
    const meta = await validateStatusFile(file);
    renderStatusFilePreview(file, meta);
  } catch (error) {
    $("statusImageInput").value = "";
    alert(error.message);
  }
});
$("statusFilePreview").addEventListener("click", (event) => {
  if (!event.target.closest("#clearStatusFileBtn")) return;
  $("statusImageInput").value = "";
  clearStatusFilePreview();
});
$("postStatusBtn").addEventListener("click", async () => {
  const button = $("postStatusBtn");
  button.disabled = true;
  try {
    let media = null;
    const file = $("statusImageInput").files?.[0];
    if (file) {
      const statusFileMeta = await validateStatusFile(file);
      setStatusUploadProgress(0, "Uploading 0%");
      const uploadedMedia = await uploadStatusFile(file, (percent) => setStatusUploadProgress(percent, `Uploading ${percent}%`));
      media = { ...uploadedMedia, ...statusFileMeta };
      setStatusUploadProgress(100, "Upload complete");
    }
    await api("/api/statuses", {
      method: "POST",
      body: JSON.stringify({ text: $("statusTextInput").value, media })
    });
    $("statusTextInput").value = "";
    $("statusImageInput").value = "";
    clearStatusFilePreview();
    await loadStatuses();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});
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
  if (state.activeConversation && state.socket?.connected) state.socket.emit("typing", { conversationId: state.activeConversation.id, typing: true });
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(event.target));
    const { token, user } = await api("/api/login", { method: "POST", body: JSON.stringify(body) });
    state.token = token;
    state.user = user;
    localStorage.setItem("chatToken", token);
    cacheCurrentUser();
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
    cacheCurrentUser();
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
    statusText: form.get("statusText"),
    oldPassword: form.get("oldPassword"),
    newPassword: form.get("newPassword"),
    messageAutoDelete: {
      enabled: $("messageAutoDeleteToggle").checked,
      ttlHours: Number(form.get("messageAutoDeleteTtl") || 24)
    }
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
    cacheCurrentUser();
    if (/^\d{6}$/.test(privacyBody.code)) cacheOfflineUnlockCode(privacyBody.code);
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
  const starred = event.target.closest("[data-starred-message]");
  if (starred) {
    await openConversationById(starred.dataset.conversation, starred.dataset.starredMessage);
    return;
  }
  const statusButton = event.target.closest("[data-status]");
  if (statusButton) {
    const status = state.statuses.find((item) => item.id === statusButton.dataset.status);
    if (!status) return;
    const result = await api(`/api/statuses/${status.id}/view`, { method: "POST" });
    status.viewerCount = result.viewerCount || status.viewerCount || 0;
    status.viewedByMe = true;
    if (result.status) Object.assign(status, result.status);
    openStatusViewer(status);
    await loadStatuses();
    return;
  }
  const button = event.target.closest("[data-id]");
  if (!button) return;
  await openConversationById(button.dataset.id);
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
    if (state.socket?.connected) state.socket.emit("conversation:join", { conversationId: state.activeConversation.id });
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
  if (state.socket?.connected) state.socket.emit("conversation:join", { conversationId: conversation.id });
  renderHeader();
  await loadMessages(conversation.id);
  $("searchResults").innerHTML = "";
  $("searchInput").value = "";
  $("chatView").classList.add("conversation-open");
});

$("messages").addEventListener("click", async (event) => {
  if (state.suppressNextMessageClick && !event.target.closest(".reaction-picker")) {
    event.preventDefault();
    state.suppressNextMessageClick = false;
    return;
  }
  const replyButton = event.target.closest("[data-reply]");
  if (replyButton) {
    state.replyToMessageId = replyButton.dataset.reply;
    renderReplyComposer();
    $("messageInput").focus();
    return;
  }
  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    const message = state.messages.find((item) => item.id === editButton.dataset.edit);
    if (!message) return;
    state.editingMessageId = message.id;
    $("messageInput").value = message.text || "";
    $("messageInput").focus();
    renderEditComposer();
    return;
  }
  const detailsButton = event.target.closest("[data-details]");
  if (detailsButton) {
    showMessageDetails(detailsButton.dataset.details);
    return;
  }
  const starButton = event.target.closest("[data-star]");
  if (starButton) {
    const id = starButton.dataset.star;
    const starred = !(state.user.starredMessageIds || []).includes(id);
    await api(`/api/messages/${id}/star`, { method: "POST", body: JSON.stringify({ starred }) });
    state.user.starredMessageIds = starred
      ? [...new Set([...(state.user.starredMessageIds || []), id])]
      : (state.user.starredMessageIds || []).filter((item) => item !== id);
    cacheCurrentUser();
    renderMessages({ preserveScroll: true });
    return;
  }
  const actionReplyButton = event.target.closest("[data-action-reply]");
  if (actionReplyButton) {
    state.replyToMessageId = actionReplyButton.dataset.actionReply;
    state.reactionPickerMessageId = null;
    renderMessages({ preserveScroll: true });
    $("messageInput").focus();
    return;
  }
  const shareMessageButton = event.target.closest("[data-share-message]");
  if (shareMessageButton) {
    openMessageShare(shareMessageButton.dataset.shareMessage);
    return;
  }
  const shareOutsideButton = event.target.closest("[data-share-outside]");
  if (shareOutsideButton) {
    try {
      await shareMessageOutside(shareOutsideButton.dataset.shareOutside);
    } catch (error) {
      if (error.name !== "AbortError") alert(error.message);
    }
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
    state.deleteOptionsMessageId = null;
    renderMessages({ preserveScroll: true });
    return;
  }
  const deleteOptionsButton = event.target.closest("[data-delete-options]");
  if (deleteOptionsButton) {
    state.reactionPickerMessageId = deleteOptionsButton.dataset.deleteOptions;
    state.deleteOptionsMessageId = state.deleteOptionsMessageId === deleteOptionsButton.dataset.deleteOptions
      ? null
      : deleteOptionsButton.dataset.deleteOptions;
    renderMessages({ preserveScroll: true });
    return;
  }
  const deleteEveryoneButton = event.target.closest("[data-delete-everyone]");
  if (deleteEveryoneButton) {
    if (!confirm("Delete this message for everyone?")) return;
    await api(`/api/messages/${deleteEveryoneButton.dataset.deleteEveryone}/delete-everyone`, { method: "POST" });
    state.messages = state.messages.filter((message) => message.id !== deleteEveryoneButton.dataset.deleteEveryone);
    state.selectedMessageIds.delete(deleteEveryoneButton.dataset.deleteEveryone);
    state.reactionPickerMessageId = null;
    state.deleteOptionsMessageId = null;
    renderMessages();
    await loadConversations();
    return;
  }
  const button = event.target.closest("[data-delete-for-me]");
  if (!button) return;
  await api(`/api/messages/${button.dataset.deleteForMe}/delete-for-me`, { method: "POST" });
  state.messages = state.messages.filter((message) => message.id !== button.dataset.deleteForMe);
  state.reactionPickerMessageId = null;
  state.deleteOptionsMessageId = null;
  renderMessages();
});

$("messages").addEventListener("pointerdown", startReactionLongPress);
$("messages").addEventListener("pointerup", clearReactionLongPress);
$("messages").addEventListener("pointerleave", clearReactionLongPress);
$("messages").addEventListener("pointercancel", clearReactionLongPress);
$("messages").addEventListener("contextmenu", (event) => {
  const article = event.target.closest("[data-message]");
  if (!article || event.target.closest("button, a, input, label")) return;
  event.preventDefault();
  clearReactionLongPress();
  openReactionPicker(article.dataset.message, { toggle: false });
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
  if (state.editingMessageId) {
    api(`/api/messages/${state.editingMessageId}`, { method: "PATCH", body: JSON.stringify({ text }) })
      .then(({ message }) => {
        const index = state.messages.findIndex((item) => item.id === message.id);
        if (index >= 0) state.messages[index] = message;
        cancelEditComposer();
        renderMessages({ preserveScroll: true });
        loadConversations();
      })
      .catch((error) => alert(error.message));
    return;
  }
  sendTextMessage(state.activeConversation.id, text, state.replyToMessageId);
  $("messageInput").value = "";
  clearReplyComposer();
});

$("cancelReplyBtn").addEventListener("click", clearReplyComposer);
$("cancelEditBtn").addEventListener("click", cancelEditComposer);

$("groupMembersList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-group-member]");
  if (!button || !state.activeConversation?.groupId) return;
  await api(`/api/groups/${state.activeConversation.groupId}/members/${button.dataset.removeGroupMember}`, { method: "DELETE" });
  await loadConversations();
  state.activeConversation = state.conversations.find((item) => item.id === state.activeConversation.id);
  renderGroupMembersList();
  renderHeader();
});

$("groupMemberInput").addEventListener("change", async () => {
  const query = $("groupMemberInput").value.trim();
  if (!query || !state.activeConversation?.groupId) return;
  const { users } = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
  const user = users[0];
  if (!user) {
    $("groupMessage").textContent = "User not found.";
    return;
  }
  await api(`/api/groups/${state.activeConversation.groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ memberId: user.id })
  });
  $("groupMemberInput").value = "";
  await loadConversations();
  state.activeConversation = state.conversations.find((item) => item.id === state.activeConversation.id);
  renderGroupMembersList();
  renderHeader();
});

$("groupFormUser").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.activeConversation?.groupId) return;
  const { group } = await api(`/api/groups/${state.activeConversation.groupId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: $("groupNameInput").value,
      description: $("groupDescriptionInput").value
    })
  });
  state.activeConversation.group = group;
  $("groupMessage").textContent = "Group saved.";
  await loadConversations();
  renderHeader();
});

$("leaveGroupBtn").addEventListener("click", async () => {
  if (!state.activeConversation?.groupId || !confirm("Leave this group?")) return;
  await api(`/api/groups/${state.activeConversation.groupId}/leave`, { method: "POST" });
  $("groupModal").classList.add("hidden");
  state.activeConversation = null;
  await loadConversations();
  renderHeader();
  renderMessages();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  setInstallButtonsVisible(true);
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  setInstallButtonsVisible(false);
  ensureTopbarControlsVisible();
});

window.addEventListener("online", async () => {
  if (!state.token || !state.user) return;
  if (privacyEnabled() && !state.privacyToken) await refreshPrivacyTokenFromCachedPin();
  connectSocket();
  await flushOfflineOutbox();
  await loadConversations().catch(() => {});
});

renderEmojiPicker();
if ($("cameraSelect")) $("cameraSelect").value = state.cameraFacingMode;
bootstrap();
