const state = {
  token: localStorage.getItem("chatToken"),
  privacyToken: sessionStorage.getItem("privacyToken"),
  googleClientId: "",
  googleInitialized: false,
  googleSetupToken: "",
  googleFlow: null,
  emailVerificationToken: "",
  emailVerificationExpiresAt: 0,
  user: null,
  socket: null,
  conversations: [],
  mainTab: "chats",
  conversationView: "active",
  activeConversation: null,
  contactDetailsConversationId: null,
  messages: [],
  messageExpirationTimer: null,
  starredMessages: [],
  statuses: [],
  statusSequenceIds: [],
  statusViewerIndex: -1,
  activeStatusId: null,
  callHistory: [],
  createGroupMembers: [],
  createGroupSearchResults: [],
  createGroupSearchTimer: null,
  messageSearch: { open: false, query: "", date: "", matches: [], index: 0 },
  editingMessageId: null,
  statusPreviewUrl: null,
  presence: [],
  recorder: null,
  audioChunks: [],
  audioStream: null,
  audioRecordingCancelled: false,
  audioRecordingRequestId: 0,
  videoRecorder: null,
  videoChunks: [],
  videoTimer: null,
  videoStream: null,
  videoAudioStream: null,
  videoCanvas: null,
  videoCanvasStream: null,
  videoCanvasAnimation: null,
  videoCameraFacingMode: "environment",
  videoRecordingCancelled: false,
  videoAudioPaused: false,
  recordingIndicatorTimer: null,
  recordingStartedAt: 0,
  cameraFacingMode: localStorage.getItem("cameraFacingMode") || "user",
  installPrompt: null,
  selectionMode: false,
  selectedMessageIds: new Set(),
  pendingShare: null,
  shareRecipients: new Map(),
  hiddenConversations: [],
  searchRequestId: 0,
  searchTimer: null,
  searchConversationMap: new Map(),
  newChatContacts: [],
  newChatSearchRequestId: 0,
  lockedChatCode: "",
  calculatorExpression: "",
  calculatorJustEvaluated: false,
  calculatorResetTimer: null,
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
  userActionConversation: null,
  userActionPressPoint: null,
  suppressNextConversationClick: false,
  userActionClickResetTimer: null,
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
    direction: "outgoing",
    historyId: null,
    historyState: null,
    connectedAt: null,
    ringTimeout: null,
    shouldRecord: false,
    incoming: false,
    active: false,
    viewMode: "default"
  }
};

const $ = (id) => document.getElementById(id);
let activeCustomSelect = null;
let customSelectMenu = null;
let appInputDialogResolver = null;
const APP_VERSION_STORAGE_KEY = "calculatorInstalledVersion";
const THEME_PREFERENCE_KEY = "metagramThemePreference";
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: light)");

function selectedOptionLabel(select) {
  const option = select.selectedOptions[0];
  return option?.label || option?.textContent?.trim() || "";
}

function refreshCustomSelect(select) {
  const control = select._customSelectControl;
  if (!control) return;
  const trigger = control.querySelector(".custom-select-trigger");
  trigger.textContent = "";
  const label = document.createElement("span");
  label.className = "custom-select-value";
  label.textContent = selectedOptionLabel(select);
  const chevron = document.createElement("span");
  chevron.className = "custom-select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  trigger.append(label, chevron);
  trigger.disabled = select.disabled || !select.options.length;
  control.classList.toggle("is-disabled", select.disabled);
}

function closeCustomSelect(restoreFocus = true) {
  if (!customSelectMenu) return;
  customSelectMenu.remove();
  customSelectMenu = null;
  if (activeCustomSelect?._customSelectControl) {
    const trigger = activeCustomSelect._customSelectControl.querySelector(".custom-select-trigger");
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  activeCustomSelect = null;
}

function placeCustomSelectMenu(select, trigger) {
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const edge = 12;
  const maxHeight = Math.min(320, window.innerHeight - edge * 2);
  const below = window.innerHeight - rect.bottom - edge - gap;
  const above = rect.top - edge - gap;
  const placeAbove = below < Math.min(220, maxHeight) && above > below;
  const availableHeight = Math.max(100, Math.min(maxHeight, placeAbove ? above : below));
  const width = Math.min(Math.max(rect.width, 190), window.innerWidth - edge * 2);
  const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
  const optionsHeight = customSelectMenu.scrollHeight;
  const height = Math.min(optionsHeight, availableHeight);
  const top = placeAbove
    ? Math.max(edge, rect.top - gap - height)
    : Math.min(window.innerHeight - edge - height, rect.bottom + gap);
  customSelectMenu.style.left = `${left}px`;
  customSelectMenu.style.top = `${top}px`;
  customSelectMenu.style.width = `${width}px`;
  customSelectMenu.style.maxHeight = `${availableHeight}px`;
  customSelectMenu.style.setProperty("--custom-select-max-height", `${availableHeight}px`);
  customSelectMenu.dataset.owner = select.id;
}

function openCustomSelect(select, focusSelected = false) {
  if (select.disabled || !select.options.length) return;
  if (activeCustomSelect === select) {
    closeCustomSelect();
    return;
  }
  closeCustomSelect(false);
  refreshCustomSelect(select);
  activeCustomSelect = select;
  customSelectMenu = document.createElement("div");
  customSelectMenu.className = "custom-select-menu";
  customSelectMenu.setAttribute("role", "listbox");
  customSelectMenu.setAttribute("aria-label", select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || "Choose an option");
  customSelectMenu.id = `${select.id || "select"}-options`;
  for (const [index, option] of Array.from(select.options).entries()) {
    const item = document.createElement("button");
    item.className = "custom-select-option";
    item.type = "button";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.selected));
    item.disabled = option.disabled;
    item.textContent = option.label || option.textContent.trim();
    item.dataset.optionIndex = String(index);
    item.addEventListener("click", () => {
      if (option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      refreshCustomSelect(select);
      closeCustomSelect();
    });
    customSelectMenu.append(item);
  }
  customSelectMenu.addEventListener("keydown", (event) => {
    const options = [...customSelectMenu.querySelectorAll(".custom-select-option:not(:disabled)")];
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(options.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      closeCustomSelect();
      return;
    } else if (event.key === "Tab") {
      closeCustomSelect(false);
      return;
    } else return;
    event.preventDefault();
    options[nextIndex]?.focus();
    options[nextIndex]?.scrollIntoView({ block: "nearest" });
  });
  document.body.append(customSelectMenu);
  const trigger = select._customSelectControl.querySelector(".custom-select-trigger");
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", customSelectMenu.id);
  placeCustomSelectMenu(select, trigger);
  if (focusSelected) {
    const selected = customSelectMenu.querySelector('[aria-selected="true"]:not(:disabled)')
      || customSelectMenu.querySelector(".custom-select-option:not(:disabled)");
    selected?.focus();
    selected?.scrollIntoView({ block: "nearest" });
  }
}

function enhanceNativeSelects() {
  document.querySelectorAll("select").forEach((select, index) => {
    if (select._customSelectControl) return;
    const control = document.createElement("div");
    control.className = "custom-select-control";
    if (select.classList.contains("hidden")) control.classList.add("hidden");
    control.dataset.selectId = select.id || `custom-select-${index}`;
    const trigger = document.createElement("button");
    trigger.className = "custom-select-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || "Choose an option");
    trigger.addEventListener("click", () => openCustomSelect(select));
    trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openCustomSelect(select, true);
      }
    });
    select.classList.add("native-select-source");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    select._customSelectControl = control;
    select.insertAdjacentElement("afterend", control);
    control.append(trigger);
    select.labels?.forEach((label) => {
      if (label.htmlFor === select.id) label.htmlFor = `${control.dataset.selectId}-trigger`;
    });
    trigger.id = `${control.dataset.selectId}-trigger`;
    select.addEventListener("change", () => refreshCustomSelect(select));
    new MutationObserver(() => {
      control.classList.toggle("hidden", select.classList.contains("hidden"));
      refreshCustomSelect(select);
    }).observe(select, { attributes: true, attributeFilter: ["class", "disabled"] });
    refreshCustomSelect(select);
  });
}

document.addEventListener("click", (event) => {
  if (!activeCustomSelect || event.target.closest(".custom-select-menu")
    || event.target.closest(".custom-select-control")) return;
  closeCustomSelect(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeCustomSelect) closeCustomSelect();
});
document.addEventListener("scroll", (event) => {
  if (activeCustomSelect && event.target !== customSelectMenu) closeCustomSelect(false);
}, true);
window.addEventListener("resize", () => {
  if (activeCustomSelect) closeCustomSelect(false);
});

function applyThemePreference(preference) {
  const resolvedTheme = preference === "system"
    ? (themeMediaQuery.matches ? "light" : "dark")
    : preference;
  document.documentElement.dataset.theme = resolvedTheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = resolvedTheme === "light" ? "#f0f2f5" : "#000000";
}

function getThemePreference() {
  try {
    return localStorage.getItem(THEME_PREFERENCE_KEY) || "light";
  } catch {
    return "light";
  }
}

function saveThemePreference(preference) {
  if (!["system", "light", "dark"].includes(preference)) return;
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, preference);
    applyThemePreference(preference);
    $("profileMessage").textContent = "Theme preference saved on this device.";
    $("profileMessage").classList.add("success-text");
  } catch (error) {
    applyThemePreference(preference);
    $("profileMessage").textContent = `Theme changed, but could not be saved on this device: ${error.message}`;
    $("profileMessage").classList.remove("success-text");
  }
}

const handleSystemThemeChange = () => {
  if (getThemePreference() === "system") {
    applyThemePreference("system");
  }
};
if (typeof themeMediaQuery.addEventListener === "function") {
  themeMediaQuery.addEventListener("change", handleSystemThemeChange);
} else {
  themeMediaQuery.addListener(handleSystemThemeChange);
}

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
        ...(state.emailVerificationToken ? { "X-Email-Verification": state.emailVerificationToken } : {}),
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
          <button id="profileBtn" type="button" role="menuitem"><span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.6-3.4 3.2-5.5 7-5.5s6.4 2.1 7 5.5"></path></svg></span> Profile</button>
          <button id="forgotHiddenSecretBtn" type="button" role="menuitem">Forgot hidden chat code?</button>
          <button id="sidebarInstallBtn" type="button" role="menuitem"><span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5"></path><path d="M5 17v3h14v-3"></path></svg></span> Install app</button>
          <button id="shareAppBtn" type="button" role="menuitem"><span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.3 10.8 7.4-4.5m-7.4 6.9 7.4 4.5"></path></svg></span> Share app</button>
          <button id="logoutBtn" type="button" role="menuitem"><span class="menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 5H5v14h5"></path><path d="M13 8l4 4-4 4m4-4H9"></path></svg></span> Logout</button>
        </div>
      </div>
    `);
  }
  ["panicHideBtn", "topbarMenuBtn", "profileBtn", "forgotHiddenSecretBtn", "sidebarInstallBtn", "shareAppBtn", "logoutBtn"].forEach((id) => {
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
  renderGoogleSignInButton(mode);
}

function renderGoogleSignInButton(mode = ($("signupTab")?.classList.contains("active") ? "signup" : "login")) {
  state.googleFlow = "auth";
  const button = $("googleSignInButton");
  const unavailable = $("googleSignInUnavailable");
  button.replaceChildren();
  if (!state.googleClientId) {
    unavailable.textContent = "Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID on the server.";
    unavailable.classList.remove("hidden");
    return;
  }
  if (!window.google?.accounts?.id) {
    unavailable.textContent = "Google sign-in could not load. Check your internet connection and try again.";
    unavailable.classList.remove("hidden");
    return;
  }
  unavailable.classList.add("hidden");
  if (!state.googleInitialized) {
    window.google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: handleGoogleCredential,
      auto_select: false
    });
    state.googleInitialized = true;
  }
  window.google.accounts.id.renderButton(button, {
    theme: "outline",
    size: "large",
    shape: "rectangular",
    text: mode === "signup" ? "signup_with" : "signin_with",
    width: Math.max(220, Math.min(360, Math.floor($("authView").clientWidth - 64)))
  });
}

function renderProfileGoogleVerifyButton() {
  const button = $("profileGoogleVerifyButton");
  if (!button) return;
  state.googleFlow = "email-verify";
  button.replaceChildren();
  if (!state.googleClientId) {
    $("profileEmailVerificationStatus").textContent = "Google email verification is not configured on this server.";
    return;
  }
  if (!window.google?.accounts?.id) {
    $("profileEmailVerificationStatus").textContent = "Google sign-in is loading. Try again in a moment.";
    return;
  }
  if (!state.googleInitialized) {
    window.google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: handleGoogleCredential,
      auto_select: false
    });
    state.googleInitialized = true;
  }
  window.google.accounts.id.renderButton(button, {
    theme: "outline",
    size: "large",
    shape: "rectangular",
    text: "continue_with",
    width: Math.max(220, Math.min(360, Math.floor($("profileModal").clientWidth - 64)))
  });
  const authorizedOriginHint = ` This site's origin (${window.location.origin}) must be authorized in Google Cloud.`;
  $("profileEmailVerificationStatus").textContent = state.user.email
    ? `Continue with the Google account linked to this email before saving changes.${authorizedOriginHint}`
    : `Verify the Google email you want to link to this account before saving changes.${authorizedOriginHint}`;
}

const googleIdentityScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
googleIdentityScript?.addEventListener("load", () => renderGoogleSignInButton());
googleIdentityScript?.addEventListener("load", () => {
  if (!$("profileModal").classList.contains("hidden")) renderProfileGoogleVerifyButton();
});
googleIdentityScript?.addEventListener("error", () => {
  $("googleSignInUnavailable").textContent = "Google sign-in could not load. Check your internet connection and try again.";
  $("googleSignInUnavailable").classList.remove("hidden");
  if (!$("profileModal").classList.contains("hidden")) {
    $("profileEmailVerificationStatus").textContent = "Google sign-in could not load. Check your internet connection and try again.";
  }
});

async function handleGoogleCredential(response) {
  const isProfileEmailVerification = Boolean(
    state.token && !$("profileModal").classList.contains("hidden")
  );
  if (isProfileEmailVerification) {
    state.googleFlow = null;
    $("profileEmailVerificationStatus").textContent = "Verifying your Google email...";
    let verificationMessage = "";
    try {
      const result = await api("/api/me/verify-email", {
        method: "POST",
        body: JSON.stringify({ credential: response.credential })
      });
      state.emailVerificationToken = result.emailVerificationToken;
      state.emailVerificationExpiresAt = Date.parse(result.expiresAt);
      state.user.email = result.email;
      $("profileEmail").value = result.email;
      verificationMessage = "Email verified. Save your changes within 10 minutes.";
      $("profileMessage").textContent = "";
      $("profileMessage").classList.remove("success-text");
    } catch (error) {
      state.emailVerificationToken = "";
      state.emailVerificationExpiresAt = 0;
      verificationMessage = error.message;
    }
    if (!$("profileModal").classList.contains("hidden")) {
      renderProfileGoogleVerifyButton();
      $("profileEmailVerificationStatus").textContent = verificationMessage;
    }
    return;
  }
  if (state.googleFlow !== "auth") return;
  $("authError").textContent = "";
  try {
    const result = await api("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential })
    });
    if (result.setupToken) {
      state.googleSetupToken = result.setupToken;
      $("googleOnboardingEmail").textContent = `Verified Google account: ${result.email}`;
      $("googleOnboardingForm").elements.displayName.value = result.displayName || "";
      $("googleOnboardingOverlay").classList.remove("hidden");
      return;
    }
    await establishSession(result);
  } catch (error) {
    $("authError").textContent = error.message;
  }
}

async function establishSession({ token, privacyToken, user }) {
  state.token = token;
  state.user = user;
  state.emailVerificationToken = "";
  state.emailVerificationExpiresAt = 0;
  state.googleFlow = null;
  if (privacyToken) {
    state.privacyToken = privacyToken;
    sessionStorage.setItem("privacyToken", privacyToken);
  }
  localStorage.setItem("chatToken", token);
  cacheCurrentUser();
  showChat();
  connectSocket();
  await loadConversations();
  await loadPendingShare();
  if ("Notification" in window) {
    await requestNotificationPermission();
    if (Notification.permission === "granted") await ensurePushSubscription();
  }
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
  $("profileMobile").value = state.user.mobile || "";
  $("profileEmail").value = state.user.email || "";
  $("profileStatusInput").value = state.user.statusText || "";
  renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
  syncPrivacySettings();
  syncMessageAutoDeleteSettings();
  clearPrivacyAwayLock();
  requestNotificationPermission();
  if ("Notification" in window && Notification.permission === "granted") {
    ensurePushSubscription().catch(() => {});
  }
}

async function showAuth() {
  if (state.updateBlocked) return;
  $("updateRequiredView").classList.add("hidden");
  endCall(false);
  state.socket?.disconnect();
  clearTimeout(state.privacyAutoLockTimer);
  clearPrivacyAwayLock();
  $("calculatorPrivacyView").classList.add("hidden");
  $("authView").classList.remove("hidden");
  $("chatView").classList.add("hidden");
  setAppReady();
}

async function logout() {
  localStorage.removeItem("chatToken");
  sessionStorage.removeItem("privacyToken");
  localStorage.removeItem("offlineOutbox");
  state.token = null;
  state.privacyToken = null;
  state.emailVerificationToken = "";
  state.emailVerificationExpiresAt = 0;
  state.googleFlow = null;
  state.user = null;
  state.offlineOutbox = [];
  await showAuth();
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
    if (message.senderId !== state.user.id) {
      state.socket.emit("message:delivered", { messageId: message.id });
    }
    if (message.conversationId === state.activeConversation?.id) {
      loadMessages(state.activeConversation.id, message.senderId !== state.user.id);
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
    renderMessages({ preserveScroll: true });
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
      renderMessages({ preserveScroll: true });
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
    if (state.mainTab === "updates") loadStatuses();
  });
  state.socket.on("status:updated", ({ status }) => {
    if (!status?.id) return;
    const index = state.statuses.findIndex((item) => item.id === status.id);
    if (index >= 0) state.statuses[index] = status;
    if (state.activeStatusId === status.id) openStatusViewer(status);
    if (state.mainTab === "updates") renderSectionPanel();
  });
  state.socket.on("status:deleted", ({ statusId }) => {
    state.statuses = state.statuses.filter((status) => status.id !== statusId);
    state.statusSequenceIds = state.statusSequenceIds.filter((id) => id !== statusId);
    if (state.activeStatusId === statusId) closeStatusViewer();
    if (state.mainTab === "updates") renderSectionPanel();
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
    clearTimeout(state.call.ringTimeout);
    state.call.ringTimeout = null;
    $("callStatus").textContent = "Connected. Starting audio...";
    state.call.connectedAt = Date.now();
    persistCallHistory(state.call, "connected");
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
    endCall(false, "declined");
    alert("Call declined.");
  });
  state.socket.on("call:ended", ({ conversationId, callStatus }) => {
    if (state.call.conversationId !== conversationId) return;
    endCall(false, state.call.direction === "outgoing" && callStatus === "missed" ? "no_answer" : null);
  });
  state.socket.on("call:signal", ({ conversationId, fromUserId, signal }) => {
    handleCallSignal({ conversationId, fromUserId, signal }).catch((error) => {
      endCall(true);
      alert(error.message);
    });
  });
}

async function bootstrap() {
  setAppReady();
  registerPwa();
  showPendingShareError();
  const canContinue = await checkRequiredUpdate();
  if (!canContinue) return;
  if (!state.token) {
    showCalculatorPrivacy();
    return;
  }
  state.audioStream?.getTracks().forEach((track) => track.stop());
  state.audioStream = null;
  state.recorder = null;
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
    const conversationId = new URLSearchParams(location.search).get("conversationId");
    if (conversationId) {
      await openConversationById(conversationId).catch(() => {});
    }
  } catch (error) {
    showAuth();
  }
}

async function checkRequiredUpdate(updateNotify = null) {
  try {
    const config = updateNotify ? { updateNotify } : await api("/api/app-config");
    if (config.googleClientId !== undefined) {
      state.googleClientId = config.googleClientId;
      renderGoogleSignInButton();
      if (!$("profileModal").classList.contains("hidden")) {
        renderProfileGoogleVerifyButton();
      }
    }
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

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensurePushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { publicKey } = await api("/api/push/vapid-public-key");
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    if (subscription) {
      await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) });
    }
  } catch (error) {
    console.warn("Push subscription failed:", error);
  }
}

async function unregisterPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe();
    }
  } catch (error) {
    console.warn("Push unsubscribe failed:", error);
  }
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js")
      .then((registration) => registration.update().catch(() => {}))
      .catch(() => {});
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
  await showAppInputDialog({
    title: "Copy app link",
    message: "Copy this link to share the app.",
    label: "App link",
    initialValue: appUrl,
    submitLabel: "Done",
    showCancel: false
  });
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

function syncNotificationSettings() {
  if (!$("notificationToggle") || !state.user) return;
  $("notificationToggle").checked = state.user.notificationEnabled !== false;
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
  clearCalculatorResetTimer();
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

function formatCalculatorDisplayValue(value) {
  return String(value).replace(/\*/g, "×").replace(/\//g, "÷");
}

function updateCalculatorDisplay(value = state.calculatorExpression || "0") {
  $("calculatorDisplay").textContent = formatCalculatorDisplayValue(value);
}

function updateCalculatorHistory(text = "") {
  $("calculatorHistory").textContent = text;
}

function clearCalculatorResetTimer() {
  if (state.calculatorResetTimer) {
    clearTimeout(state.calculatorResetTimer);
    state.calculatorResetTimer = null;
  }
}

function scheduleCalculatorResetTimer() {
  clearCalculatorResetTimer();
  // Only reset if calculator is still visible and not actively in use
  state.calculatorResetTimer = setTimeout(() => {
    if ($("calculatorPrivacyView").classList.contains("hidden")) return;
    state.calculatorExpression = "";
    state.calculatorJustEvaluated = false;
    updateCalculatorHistory("");
    updateCalculatorDisplay("0");
  }, 60 * 1000);
}

function formatCalculatorValue(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (!Number.isFinite(value)) return "Error";
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const normalized = Number(value.toPrecision(12));
  if (!Number.isFinite(normalized)) return "Error";
  let text = String(normalized);
  if (/e/i.test(text)) {
    const [mantissa, exponentText] = text.split(/e/i);
    const exponent = Number(exponentText || "0");
    const sign = mantissa.startsWith("-") ? "-" : "";
    const unsignedMantissa = sign ? mantissa.slice(1) : mantissa;
    const [integerPart, fractionPart = ""] = unsignedMantissa.split(".");
    const digits = integerPart + fractionPart;
    if (exponent >= 0) {
      const zerosNeeded = exponent - fractionPart.length;
      if (zerosNeeded >= 0) {
        text = sign + digits + "0".repeat(zerosNeeded);
      } else {
        const splitIndex = integerPart.length + exponent;
        text = sign + digits.slice(0, splitIndex) + "." + digits.slice(splitIndex);
      }
    } else {
      const zerosNeeded = Math.abs(exponent) - integerPart.length;
      if (zerosNeeded >= 0) {
        text = sign + "0." + "0".repeat(zerosNeeded) + digits;
      } else {
        const splitIndex = integerPart.length + exponent;
        text = sign + digits.slice(0, splitIndex) + "." + digits.slice(splitIndex);
      }
    }
  }
  if (text.includes(".")) {
    text = text.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  }
  if (text === "-0") text = "0";
  return text;
}

function getCalculatorPreview(expression) {
  const trimmed = String(expression || "").trim();
  const normalized = trimmed.replace(/\s+/g, "").replace(/[×÷]/g, (match) => match === "×" ? "*" : "/");
  const cleanedExpression = normalized.replace(/[+\-*/]+$/, "");
  if (!cleanedExpression || !/[+\-*/]/.test(cleanedExpression)) return "";
  if (!/^[\d+\-*/.]+$/.test(cleanedExpression)) return "";
  const result = evaluateCalculator(cleanedExpression);
  return result === "Error" ? "" : result;
}

function tokenizeCalculatorExpression(expression) {
  const rawTokens = expression.match(/\d*\.?\d+|[+\-*/]/g) || [];
  const tokens = [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    if (token === "-" && (index === 0 || /[+\-*/]/.test(rawTokens[index - 1]))) {
      const next = rawTokens[index + 1];
      if (!/^\d*\.?\d+$/.test(next || "")) throw new Error("Invalid expression");
      tokens.push(`-${next}`);
      index += 1;
    } else {
      tokens.push(token);
    }
  }
  return tokens;
}

function evaluateCalculator(expression) {
  const trimmed = String(expression || "").trim().replace(/\s+/g, "");
  const normalizedExpression = trimmed.replace(/[×÷]/g, (match) => match === "×" ? "*" : "/");
  const cleanedExpression = normalizedExpression.replace(/[+\-*/]+$/, "");
  if (!cleanedExpression) return "0";
  if (!/^[\d+\-*/.]+$/.test(cleanedExpression)) return "Error";

  let tokens;
  try {
    tokens = tokenizeCalculatorExpression(cleanedExpression);
  } catch {
    return "Error";
  }
  if (!tokens.length) return "0";

  const canUseBigInt = !cleanedExpression.includes(".") && !cleanedExpression.includes("/");
  if (canUseBigInt) {
    try {
      const values = [];
      const operators = [];
      const precedence = { "+": 1, "-": 1, "*": 2 };
      const applyOperator = () => {
        const operator = operators.pop();
        const right = values.pop();
        const left = values.pop();
        if (!operator || left === undefined || right === undefined) throw new Error("Invalid expression");
        if (operator === "+") values.push(left + right);
        if (operator === "-") values.push(left - right);
        if (operator === "*") values.push(left * right);
      };

      for (const token of tokens) {
        if (/^-?\d+$/.test(token)) {
          values.push(BigInt(token));
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

  try {
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
  clearCalculatorResetTimer();
  scheduleCalculatorResetTimer();
  updateCalculatorDisplay();
  updateCalculatorHistory(getCalculatorPreview(state.calculatorExpression));
}

async function handleCalculatorEquals() {
  const expression = state.calculatorExpression.trim();
  const unlockMatch = expression.match(/^(\d{6})$/);
  if (unlockMatch) {
    const code = unlockMatch[1];
    state.token = state.token || localStorage.getItem("chatToken");
    if (state.token) {
      const unlocked = await tryPrivacyUnlock(code);
      if (unlocked) return;
    }
    showAuth();
    return;
  }
  const result = evaluateCalculator(expression || "0");
  updateCalculatorOutput(result, expression ? `${expression} =` : "");
  state.calculatorExpression = result === "Error" ? "" : result;
  state.calculatorJustEvaluated = true;
  clearCalculatorResetTimer();
}

function showAppInputDialog({
  title,
  message = "",
  label = "Enter value",
  initialValue = "",
  inputType = "text",
  submitLabel = "Continue",
  cancelLabel = "Cancel",
  showCancel = true,
  minLength = 0,
  errorMessage = ""
}) {
  if (appInputDialogResolver) return Promise.resolve(null);
  const dialog = $("appInputDialog");
  const input = $("appInputDialogValue");
  $("appInputDialogTitle").textContent = title;
  $("appInputDialogMessage").textContent = message;
  $("appInputDialogMessage").classList.toggle("hidden", !message);
  $("appInputDialogLabel").textContent = label;
  $("appInputDialogLabel").classList.toggle("hidden", inputType === "hidden" || !label);
  $("appInputDialogCancel").classList.toggle("hidden", !showCancel);
  $("appInputDialogSubmit").textContent = submitLabel;
  $("appInputDialogCancel").textContent = cancelLabel;
  $("appInputDialogError").textContent = "";
  input.type = inputType;
  input.value = initialValue;
  input.autocomplete = inputType === "password" ? "current-password" : "off";
  dialog.classList.remove("hidden");
  if (inputType === "hidden") $("appInputDialogSubmit").focus();
  else {
    input.focus();
    input.select();
  }

  return new Promise((resolve) => {
    appInputDialogResolver = resolve;
    const finish = (value) => {
      if (!appInputDialogResolver) return;
      const currentResolver = appInputDialogResolver;
      appInputDialogResolver = null;
      dialog.classList.add("hidden");
      $("appInputDialogForm").removeEventListener("submit", onSubmit);
      $("appInputDialogCancel").removeEventListener("click", onCancel);
      $("appInputDialogClose").removeEventListener("click", onCancel);
      dialog.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
      currentResolver(value);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (value.length < minLength) {
        $("appInputDialogError").textContent = errorMessage || `Enter at least ${minLength} characters.`;
        input.focus();
        return;
      }
      finish(value);
    };
    const onCancel = () => finish(null);
    const onOverlayClick = (event) => {
      if (event.target === dialog) onCancel();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !dialog.classList.contains("hidden")) {
        event.preventDefault();
        onCancel();
      }
    };
    $("appInputDialogForm").addEventListener("submit", onSubmit);
    $("appInputDialogCancel").addEventListener("click", onCancel);
    $("appInputDialogClose").addEventListener("click", onCancel);
    dialog.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

function showAppMessage(title, message, buttonLabel = "Done") {
  return showAppInputDialog({
    title,
    message,
    label: "",
    submitLabel: buttonLabel,
    cancelLabel: buttonLabel,
    showCancel: false,
    inputType: "hidden"
  });
}

async function showAppConfirm(message, title = "Please confirm") {
  const result = await showAppInputDialog({
    title,
    message,
    label: "",
    submitLabel: "Continue",
    cancelLabel: "Cancel",
    inputType: "hidden"
  });
  return result !== null;
}

async function promptForLockPin(action) {
  if (!state.user) return null;
  if (!state.user.hasLockedChatPin) {
    const newPin = await showAppInputDialog({
      title: "Set chat lock PIN",
      message: "Create a PIN with at least 4 characters. You will need it to open locked chats.",
      label: "New lock PIN",
      inputType: "password",
      minLength: 4,
      errorMessage: "Lock PIN must be at least 4 characters."
    });
    if (!newPin) return null;
    try {
      await api("/api/lock-pin", {
        method: "POST",
        body: JSON.stringify({ currentPin: "", newPin: newPin.trim() })
      });
      state.user.hasLockedChatPin = true;
      cacheCurrentUser();
      return newPin.trim();
    } catch (error) {
      await showAppMessage("Could not set PIN", error.message);
      return null;
    }
  }
  const title = action === "view" ? "Unlock chat" : `${action === "unlock" ? "Unlock" : "Lock"} chat`;
  return showAppInputDialog({
    title,
    message: action === "view" ? "Enter the PIN you set when locking this chat." : `Enter your lock PIN to ${action} this chat.`,
    label: "Lock PIN",
    inputType: "password",
    minLength: 4,
    errorMessage: "Lock PIN must be at least 4 characters."
  });
}

async function loadConversations() {
  try {
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

async function toggleConversationLock(conversation = state.activeConversation) {
  if (!conversation || conversation.groupId) return;
  const action = conversation.locked ? "unlock" : "lock";
  const code = await promptForLockPin(action);
  if (!code) return;
  const url = `/api/conversations/${encodeURIComponent(conversation.id)}/${action}`;
  const result = await api(url, { method: "POST", body: JSON.stringify({ code }) });
  state.lockedChatCode = action === "lock" ? code : "";
  if (state.activeConversation?.id === conversation.id) state.activeConversation = result.conversation;
  const conversationIndex = state.conversations.findIndex((item) => item.id === conversation.id);
  if (conversationIndex >= 0) state.conversations[conversationIndex] = result.conversation;
  await loadConversations();
  if (state.activeConversation?.id === conversation.id) {
    renderHeader();
    await loadMessages(conversation.id);
  }
}

async function toggleConversationHidden(conversation) {
  if (!conversation || conversation.groupId) return;
  const action = conversation.hidden ? "unhide-user" : "hide-user";
  const body = {};
  if (action === "hide-user") {
    const secretCode = await requestHiddenChatSecret(Boolean(state.user.hasHiddenChatSecret));
    if (!secretCode) return;
    body.secretCode = secretCode;
  }
  const { user } = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/${action}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (action === "hide-user" && !state.user.hasHiddenChatSecret) {
    state.user.hasHiddenChatSecret = true;
    await showAppMessage("Hidden chat secret saved", `Your secret code is ${body.secretCode}. Enter it in the search bar to access hidden chats.`);
  }
  if (user) state.user = user;
  conversation.hidden = !conversation.hidden;
  if (action === "hide-user") conversation.locked = false;
  const isActive = state.activeConversation?.id === conversation.id;
  if (isActive && conversation.hidden) {
    state.lockedChatCode = "";
    state.activeConversation = null;
    state.messages = [];
    renderHeader();
    renderMessages();
    $("chatView").classList.remove("conversation-open");
  }
  await loadConversations();
}

async function toggleConversationBlock(conversation) {
  if (!conversation || conversation.groupId) return;
  const action = conversation.blockedByMe ? "unblock-user" : "block-user";
  if (!conversation.blockedByMe && !await showAppConfirm("They will not be able to message you.", "Block user")) return;
  const { user, conversation: updatedConversation } = await api(
    `/api/conversations/${encodeURIComponent(conversation.id)}/${action}`,
    { method: "POST" }
  );
  if (user) state.user = user;
  if (updatedConversation) Object.assign(conversation, updatedConversation);
  if (state.activeConversation?.id === conversation.id && updatedConversation) {
    state.activeConversation = updatedConversation;
    renderHeader();
  }
  await loadConversations();
}

async function deleteConversationUser(conversation) {
  if (!conversation || conversation.groupId) return;
  if (!await showAppConfirm("Delete this user from your account? This will not remove them from the admin panel.", "Delete user")) return;
  const { user } = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/delete-user`, { method: "POST" });
  if (user) state.user = user;
  if (state.activeConversation?.id === conversation.id) {
    state.activeConversation = null;
    state.messages = [];
    renderHeader();
    renderMessages();
    $("chatView").classList.remove("conversation-open");
  }
  await loadConversations();
}

function runUserAction(action) {
  const conversation = state.userActionConversation;
  closeUserActionMenu();
  Promise.resolve(action(conversation)).catch((error) => {
    showAppMessage("Action failed", error.message);
  });
}

async function loadStarredMessages() {
  const { messages } = await api("/api/messages/starred");
  state.starredMessages = messages;
  renderConversations();
}

async function loadStatuses() {
  const { statuses } = await api("/api/statuses");
  state.statuses = statuses;
  if (state.mainTab === "updates") renderSectionPanel();
}

async function loadCallHistory() {
  const { calls } = await api("/api/calls");
  state.callHistory = calls;
  if (state.mainTab === "calls") renderSectionPanel();
}

function formatCallDuration(seconds) {
  const duration = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(duration / 60);
  const remainingSeconds = duration % 60;
  return minutes ? `${minutes}:${String(remainingSeconds).padStart(2, "0")}` : `${remainingSeconds}s`;
}

function callStatusLabel(call) {
  if (call.status === "missed") return "Missed";
  if (call.status === "no_answer") return "No answer";
  if (call.status === "declined") return "Declined";
  if (call.status === "cancelled") return "Cancelled";
  if (call.status === "calling") return "No answer";
  if (call.status === "completed") return `Completed · ${formatCallDuration(call.durationSeconds)}`;
  return call.direction === "incoming" ? "Incoming" : "Outgoing";
}

function renderSectionPanel() {
  const title = {
    updates: ["Updates", "Share a status and catch up with your friends."],
    communities: ["Communities", "Your group conversations, all in one place."],
    calls: ["Calls", "Your recent voice and video call history."]
  }[state.mainTab];
  if (!title) return;

  $("sectionPanelTitle").textContent = title[0];
  $("sectionPanelSubtitle").textContent = title[1];
  $("sectionPanelAction").classList.toggle("hidden", state.mainTab !== "communities");
  $("sectionPanelAction").textContent = "New group";
  $("sectionPanelAction").dataset.action = "create-group";
  $("statusComposer").classList.toggle("hidden", state.mainTab !== "updates" || $("statusComposer").dataset.open !== "true");

  if (state.mainTab === "updates") {
    const myStatuses = state.statuses.filter((status) => status.userId === state.user.id);
    const latestOwnStatus = myStatuses[0];
    const byUser = new Map();
    state.statuses
      .filter((status) => status.userId !== state.user.id)
      .forEach((status) => {
        const group = byUser.get(status.userId) || { user: status.user, statuses: [] };
        group.statuses.push(status);
        byUser.set(status.userId, group);
      });
    const friends = [...byUser.values()].map((group) => {
      const latest = group.statuses[0];
      return `
        <button class="section-list-row status-story-row ${group.statuses.some((status) => !status.viewedByMe) ? "unread" : ""}" type="button" data-section-status="${latest.id}">
          <span class="story-avatar ${group.statuses.some((status) => !status.viewedByMe) ? "unread" : ""}">${avatarMarkup(group.user, "U")}</span>
          <span class="section-list-main">
            <strong>${escapeHtml(group.user?.displayName || group.user?.userId || "Friend")}</strong>
            <small>${group.statuses.length > 1 ? `${group.statuses.length} updates · ` : ""}${escapeHtml(statusPreviewText(latest))}</small>
          </span>
          <small class="section-list-meta">${new Date(latest.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
        </button>`;
    }).join("");
    $("sectionPanelContent").innerHTML = `
      <section class="updates-section">
        <h2>My status</h2>
        <div class="my-status-card">
          <span class="story-avatar own-story">${avatarMarkup(state.user, "You")}</span>
          <span class="section-list-main">
            <strong>My status</strong>
            <small>${latestOwnStatus
    ? `${escapeHtml(statusPreviewText(latestOwnStatus))} · ${myStatuses.length} updates · ${latestOwnStatus.viewerCount || 0} views · ${latestOwnStatus.reactionCount || 0} reactions · ${latestOwnStatus.replyCount || 0} replies`
    : "Share a photo, video, or text"}</small>
          </span>
          <button class="icon-button add-status-button" type="button" data-action="add-status" title="Add status" aria-label="Add status">+</button>
          ${latestOwnStatus ? `<button class="text-button own-status-open" type="button" data-section-status="${latestOwnStatus.id}">View</button>` : ""}
        </div>
      </section>
      <section class="updates-section">
        <h2>Recent updates</h2>
        ${friends || `<p class="section-empty">When a friend shares a status, it will appear here.</p>`}
      </section>`;
    return;
  }

  if (state.mainTab === "communities") {
    const groups = state.conversations.filter((conversation) => conversation.groupId);
    $("sectionPanelContent").innerHTML = groups.length ? `
      <section class="communities-section">
        <h2>Your groups</h2>
        ${groups.map((conversation) => {
          const group = conversation.group || {};
          const latest = conversation.lastMessage;
          return `
            <div class="section-list-row community-row">
              <button class="community-open" type="button" data-community-conversation="${conversation.id}">
                <span class="avatar">${avatarMarkup({ displayName: group.name }, "G")}</span>
                <span class="section-list-main">
                  <strong>${escapeHtml(group.name || "Group")}</strong>
                  <small>${escapeHtml(latest ? messageSnippet(latest) : group.description || `${conversation.members?.length || 0} members`)}</small>
                </span>
              </button>
              <small class="section-list-meta">${conversation.members?.length || 0} members</small>
            </div>`;
        }).join("")}
      </section>` : `
      <div class="section-empty-card">
        <span class="section-empty-icon">✦</span>
        <h2>Bring people together</h2>
        <p>Create a group for friends, family, or a community you care about.</p>
        <button class="primary" type="button" data-action="create-group">Create a group</button>
      </div>`;
    return;
  }

  const calls = state.callHistory;
  $("sectionPanelContent").innerHTML = calls.length ? `
    <section class="calls-section">
      <h2>Recent</h2>
      ${calls.map((call) => {
        const peerName = call.peer?.displayName || call.peer?.userId || "Unknown contact";
        const directionLabel = call.direction === "incoming" ? "Incoming" : "Outgoing";
        const date = new Date(call.createdAt);
        const dateLabel = date.toLocaleDateString([], { day: "numeric", month: "short" });
        const timeLabel = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const missed = ["missed", "no_answer", "declined"].includes(call.status);
        return `
          <div class="section-list-row call-history-row">
            <button class="call-history-open" type="button" data-call-conversation="${call.conversationId}">
              <span class="avatar">${avatarMarkup(call.peer, "U")}</span>
              <span class="section-list-main">
                <strong class="${missed ? "call-missed" : ""}">${escapeHtml(peerName)}</strong>
                <small class="call-history-meta">${call.type === "video" ? "Video" : "Voice"} · ${directionLabel} · ${callStatusLabel(call)}</small>
              </span>
              <small class="section-list-meta">${dateLabel} · ${timeLabel}</small>
            </button>
            <button class="icon-button call-again-button" type="button" data-call-again="${call.conversationId}" data-call-type="${call.type}" title="Call again" aria-label="Call ${escapeHtml(peerName)} again">
              <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a14 14 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1C10 20 4 14 4 5a1 1 0 0 1 1-1Z"></path></svg>
            </button>
          </div>`;
      }).join("")}
    </section>` : `
    <div class="section-empty-card">
      <span class="section-empty-icon">⌕</span>
      <h2>No calls yet</h2>
      <p>Voice and video calls with your contacts will show up here.</p>
    </div>`;
}

async function setMainTab(tab) {
  if (!["chats", "updates", "communities", "calls"].includes(tab)) return;
  if (tab !== "chats" && state.activeConversation?.locked) {
    state.lockedChatCode = "";
    state.messages = [];
    renderMessages();
  }
  state.mainTab = tab;
  if (tab === "chats") state.conversationView = "active";
  $("chatView").classList.toggle("section-mode", tab !== "chats");
  $("sectionPanel").classList.toggle("hidden", tab === "chats");
  $("chatView").classList.remove("conversation-open");
  document.querySelectorAll("[data-main-tab]").forEach((button) => {
    const active = button.dataset.mainTab === tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("statusComposer").classList.add("hidden");
  $("statusComposer").dataset.open = "false";
  if (tab === "updates") await loadStatuses();
  else if (tab === "communities") {
    state.conversationView = "active";
    await loadConversations();
    renderSectionPanel();
  } else if (tab === "calls") {
    await loadCallHistory();
  } else {
    state.conversationView = "active";
    await loadConversations();
  }
  if (tab !== "chats") renderSectionPanel();
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
  let loadedFromServer = false;
  try {
    const lockCode = state.activeConversation?.id === conversationId && state.activeConversation.locked
      ? state.lockedChatCode
      : "";
    const { messages } = await api(`/api/conversations/${conversationId}/messages`, {
      headers: lockCode ? { "X-Lock-Pin": lockCode } : {}
    });
    state.messages = messages;
    cacheMessages(conversationId);
    loadedFromServer = true;
  } catch (error) {
    if (!error.offline && error.status !== 503) throw error;
    state.messages = loadCachedMessages(conversationId);
  }
  renderMessages({ preserveScroll });
  const canMarkRead = loadedFromServer
    && state.activeConversation?.id === conversationId
    && state.mainTab === "chats"
    && document.visibilityState === "visible"
    && !$("chatView").classList.contains("hidden")
    && $("chatView").classList.contains("conversation-open")
    && (!privacyEnabled() || Boolean(state.privacyToken));
  const hasUnreadMessages = state.messages.some((message) => (
    message.senderId !== state.user.id && !(message.readBy || []).includes(state.user.id)
  ));
  if (canMarkRead && hasUnreadMessages) {
    try {
      const lockCode = state.activeConversation?.id === conversationId && state.activeConversation.locked
        ? state.lockedChatCode
        : "";
      const { statuses = [] } = await api(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: "POST",
        body: JSON.stringify({ lockCode })
      });
      const statusById = new Map(statuses.map((status) => [status.id, status]));
      state.messages = state.messages.map((message) => (
        statusById.has(message.id) ? { ...message, ...statusById.get(message.id) } : message
      ));
      cacheMessages(conversationId);
      renderMessages({ preserveScroll: true });
      await loadConversations();
    } catch (error) {
      console.error("Could not mark conversation messages as read:", error);
    }
  }
  scheduleMessageExpiry(conversationId);
}

function scheduleMessageExpiry(conversationId) {
  const conversation = state.activeConversation;
  if (!conversation || conversation.id !== conversationId) return;
  clearTimeout(state.messageExpirationTimer);
  const ttlHours = Number(conversation?.id === conversationId ? conversation.disappearingHours : 0);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) return;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const now = Date.now();
  const unexpiredMessages = state.messages.filter((message) => {
    const createdAt = new Date(message.createdAt).getTime();
    return !Number.isFinite(createdAt) || createdAt + ttlMs > now;
  });
  if (unexpiredMessages.length !== state.messages.length) {
    state.messages = unexpiredMessages;
    cacheMessages(conversationId);
    renderMessages({ preserveScroll: true });
  }
  const nextExpiry = state.messages.reduce((earliest, message) => {
    const expiresAt = new Date(message.createdAt).getTime() + ttlMs;
    return Number.isFinite(expiresAt) && expiresAt < earliest ? expiresAt : earliest;
  }, Infinity);
  if (!Number.isFinite(nextExpiry)) return;
  state.messageExpirationTimer = setTimeout(() => {
    if (state.activeConversation?.id !== conversationId) return;
    loadMessages(conversationId).catch((error) => {
      console.error("Could not refresh expired chat messages:", error);
    });
  }, Math.max(100, Math.min(2147483647, nextExpiry - Date.now() + 100)));
}

function getOtherMember(conversation) {
  return conversation.members?.find((member) => member.id !== state.user.id) || conversation.members?.[0];
}

function contactDisplayName(user) {
  return user?.contactName || user?.displayName || user?.userId || "User";
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
  $("archivedChatsBtn")?.classList.toggle("active", state.conversationView === "archived");
  $("statusViewBtn")?.classList.toggle("active", state.conversationView === "status");
  $("starredViewBtn")?.classList.toggle("active", state.conversationView === "starred");
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
  const sortedConversations = state.conversations.slice().sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    const timeA = new Date(a.lastMessage?.createdAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.lastMessage?.createdAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  $("conversationList").innerHTML = sortedConversations.map((conversation) => {
    const title = conversation.group?.name || contactDisplayName(getOtherMember(conversation)) || "Chat";
    const other = getOtherMember(conversation);
    const status = conversation.group ? `${conversation.members.length} members` : formatPresenceStatus(other?.id);
    const profileStatus = !conversation.group ? statusLine(other) : "";
    const last = conversation.locked ? "Locked chat" : (conversation.lastMessage?.media ? `[${conversation.lastMessage.media.kind}]` : conversation.lastMessage?.text || "No messages yet");
    return `
      <button class="conversation ${state.activeConversation?.id === conversation.id ? "active" : ""}" data-id="${conversation.id}" type="button">
        <span class="avatar">${avatarMarkup(other, title)}</span>
        <span class="conversation-main">
          <strong>${conversation.pinned ? "Pinned " : ""}${escapeHtml(title)}${conversation.favorite ? `<span class="conversation-favorite" aria-label="Favourite"> ★</span>` : ""}</strong>
          <small>${escapeHtml(conversation.locked ? `${profileStatus ? `${profileStatus} · ` : ""}Locked chat` : profileStatus || last)}</small>
        </span>
        ${conversation.unreadCount ? `<span class="unread-badge">${conversation.unreadCount}</span>` : ""}
        <span class="status-dot ${status === "Online" ? "online" : ""}" title="${status}"></span>
      </button>`;
  }).join("") || `<div class="empty-list">No conversations found.</div>`;
  normalizeUiText();
  if (state.mainTab === "communities") renderSectionPanel();
}

function renderHeader() {
  const conversation = state.activeConversation;
  $("selectMessagesBtn").disabled = !conversation;
  $("clearChatBtn").disabled = !conversation;
  $("messageSearchBtn").disabled = !conversation;
  $("pinChatBtn").disabled = !conversation;
  $("archiveChatBtn").disabled = !conversation;
  $("groupInfoBtn").classList.add("hidden");
  $("callBtn").classList.add("hidden");
  $("videoCallBtn").classList.add("hidden");
  if (!conversation) return;
  const other = getOtherMember(conversation);
  const title = conversation.group?.name || contactDisplayName(other);
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
  }
}

function currentContactDetailsConversation() {
  const conversationId = state.contactDetailsConversationId;
  return state.activeConversation?.id === conversationId
    ? state.activeConversation
    : state.conversations.find((item) => item.id === conversationId) || null;
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function showContactDetails() {
  const conversation = state.activeConversation;
  if (!conversation) return;
  if (conversation.groupId) {
    $("groupInfoBtn").click();
    return;
  }
  state.contactDetailsConversationId = conversation.id;
  const other = getOtherMember(conversation);
  if (!other) return;
  const presence = formatPresenceStatus(other.id);
  const details = [
    ["User ID", other.userId],
    ["Mobile", other.mobile],
    ["About", other.statusText],
    ["Last seen", presence]
  ].filter(([, value]) => String(value || "").trim());
  $("contactDetailsTitle").textContent = "Contact info";
  $("contactDetailsBody").innerHTML = `
    <div class="contact-details-profile">
      <span class="avatar">${avatarMarkup(other, other.displayName || "User")}</span>
      <strong id="contactDetailsName">${escapeHtml(contactDisplayName(other))}</strong>
      <small>${escapeHtml(presence)}</small>
    </div>
    <div class="contact-details-fields">
      ${details.map(([label, value]) => `
        <div class="contact-detail-item">
          <small>${escapeHtml(label)}</small>
          <span>${escapeHtml(value)}</span>
        </div>`).join("")}
    </div>`;
  $("contactNameForm").classList.add("hidden");
  $("contactDetailsMenu").classList.add("hidden");
  $("contactDetailsMenuBtn").setAttribute("aria-expanded", "false");
  $("contactNameInput").value = contactDisplayName(other);
  $("contactNameMessage").textContent = "";
  $("favoriteContactBtn").textContent = conversation.favorite ? "★ Remove favourite" : "☆ Add to favourites";
  const muteRemainingHours = conversation.muteUntil
    ? (new Date(conversation.muteUntil).getTime() - Date.now()) / (60 * 60 * 1000)
    : 0;
  const presetMute = Math.abs(muteRemainingHours - 8) < 0.1
    ? "8h"
    : Math.abs(muteRemainingHours - 168) < 1 ? "1w" : "custom";
  $("contactMuteSelect").value = conversation.muteForever
    ? "forever"
    : conversation.muted && conversation.muteUntil ? presetMute : "off";
  $("contactMuteCustom").classList.toggle("hidden", $("contactMuteSelect").value !== "custom");
  $("contactMuteUntil").value = $("contactMuteSelect").value === "custom" ? localDateTimeValue(conversation.muteUntil) : "";
  $("contactMuteStatus").textContent = conversation.muteForever
    ? "Notifications are muted until you turn them back on."
    : conversation.muted ? `Muted until ${new Date(conversation.muteUntil).toLocaleString()}.` : "Notifications are on.";
  const disappearingValue = Number(conversation.disappearingHours || 0);
  const commonDurations = new Set([0, 1, 6, 12, 24, 72, 168, 720]);
  $("contactDisappearingSelect").value = commonDurations.has(disappearingValue) ? String(disappearingValue) : "custom";
  $("contactDisappearingHours").value = disappearingValue && !commonDurations.has(disappearingValue) ? String(disappearingValue) : "";
  $("contactDisappearingCustom").classList.toggle("hidden", $("contactDisappearingSelect").value !== "custom");
  $("contactLockChatBtn").textContent = conversation.locked ? "Unlock chat" : "Lock chat";
  $("contactHideChatBtn").textContent = conversation.hidden ? "Unhide chat" : "Hide chat";
  $("contactDetailsModal").classList.remove("hidden");
}

async function updateContactConversationPreferences(changes) {
  const conversation = currentContactDetailsConversation();
  if (!conversation) return;
  const editingContactName = !$("contactNameForm").classList.contains("hidden");
  const { conversation: updatedConversation } = await api(
    `/api/conversations/${encodeURIComponent(conversation.id)}/preferences`,
    { method: "PATCH", body: JSON.stringify(changes) }
  );
  Object.assign(conversation, updatedConversation);
  if (state.activeConversation?.id === conversation.id) state.activeConversation = updatedConversation;
  const index = state.conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) state.conversations[index] = updatedConversation;
  cacheConversations();
  renderConversations();
  if (state.activeConversation?.id === conversation.id) renderHeader();
  showContactDetails();
  if (editingContactName && changes.contactName !== undefined) {
    $("contactNameForm").classList.remove("hidden");
    $("contactNameMessage").textContent = "Contact name saved on this account.";
  }
  if (changes.disappearingHours !== undefined && state.activeConversation?.id === conversation.id) {
    await loadMessages(conversation.id);
  }
}

function contactShareText(conversation) {
  const other = getOtherMember(conversation);
  if (!other) return "";
  return [
    `Contact: ${contactDisplayName(other)}`,
    other.userId ? `User ID: ${other.userId}` : "",
    other.mobile ? `Mobile: ${other.mobile}` : ""
  ].filter(Boolean).join("\n");
}

function openContactShare() {
  const conversation = currentContactDetailsConversation();
  if (!conversation) return;
  state.pendingShare = { id: null, text: contactShareText(conversation), media: [] };
  $("contactDetailsModal").classList.add("hidden");
  $("contactDetailsMenu").classList.add("hidden");
  showShareModal();
}

async function shareContactOutside() {
  const conversation = currentContactDetailsConversation();
  if (!conversation) return;
  const text = contactShareText(conversation);
  if (navigator.share) {
    await navigator.share({ title: "Contact", text });
    return;
  }
  await navigator.clipboard.writeText(text);
  alert("Contact details copied.");
}

function startGroupWithContact() {
  const conversation = currentContactDetailsConversation();
  const other = conversation && getOtherMember(conversation);
  if (!other) return;
  state.createGroupMembers = [other];
  state.createGroupSearchResults = [];
  $("createGroupMessage").textContent = "";
  $("createGroupName").value = "";
  $("createGroupDescription").value = "";
  $("createGroupMemberSearch").value = "";
  $("createGroupSearchResults").innerHTML = "";
  renderCreateGroupMembers();
  $("contactDetailsModal").classList.add("hidden");
  $("createGroupModal").classList.remove("hidden");
  $("createGroupName").focus();
}

function toggleContactDetailsMenu() {
  const menu = $("contactDetailsMenu");
  const open = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !open);
  $("contactDetailsMenuBtn").setAttribute("aria-expanded", String(open));
}

async function setContactMute(value) {
  if (value === "custom") {
    $("contactMuteCustom").classList.remove("hidden");
    $("contactMuteUntil").focus();
    return;
  }
  const changes = value === "forever"
    ? { muteForever: true, muteUntil: null }
    : {
        muteForever: false,
        muteUntil: value === "off"
          ? null
          : new Date(Date.now() + (value === "8h" ? 8 : 168) * 60 * 60 * 1000).toISOString()
      };
  await updateContactConversationPreferences(changes);
}

async function saveCustomContactMute() {
  const muteUntil = new Date($("contactMuteUntil").value);
  if (!Number.isFinite(muteUntil.getTime()) || muteUntil.getTime() <= Date.now()) {
    alert("Choose a future date and time.");
    return;
  }
  await updateContactConversationPreferences({ muteForever: false, muteUntil: muteUntil.toISOString() });
}

async function setContactDisappearing(value) {
  if (value === "custom") {
    $("contactDisappearingCustom").classList.remove("hidden");
    $("contactDisappearingHours").focus();
    return;
  }
  await updateContactConversationPreferences({ disappearingHours: Number(value) });
}

async function saveContactDisappearing() {
  const hours = Number($("contactDisappearingHours").value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 8760) {
    alert("Enter a duration between 1 and 8760 hours.");
    return;
  }
  await updateContactConversationPreferences({ disappearingHours: hours });
}

function syncUserActionMenuLabels(conversation = state.userActionConversation) {
  $("menuBlockUserBtn").textContent = conversation?.blockedByMe ? "Unblock user" : "Block user";
  $("menuLockChatBtn").textContent = conversation?.locked ? "Unlock chat" : "Lock chat";
  $("menuHideChatBtn").textContent = conversation?.hidden ? "Unhide chat" : "Hide chat";
  $("menuHideChatBtn").hidden = !conversation?.locked && !conversation?.hidden;
}

function conversationForUserAction(row) {
  const conversationId = row?.dataset.id || row?.dataset.searchConversation || row?.dataset.hiddenConversation;
  return state.conversations.find((conversation) => conversation.id === conversationId)
    || state.searchConversationMap.get(conversationId)
    || state.hiddenConversations.find((conversation) => conversation.id === conversationId)
    || null;
}

function openUserActionMenu(conversation, x, y) {
  if (!conversation || conversation.groupId || !getOtherMember(conversation)?.id) return false;
  closeUserActionMenu();
  state.userActionConversation = conversation;
  syncUserActionMenuLabels(conversation);
  const menu = $("userActionMenu");
  menu.classList.remove("hidden");
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  return true;
}

function closeUserActionMenu() {
  $("userActionMenu")?.classList.add("hidden");
  state.userActionConversation = null;
}

function startSidebarUserActionLongPress(event) {
  if (event.pointerType === "mouse" || event.button !== 0) return;
  const row = event.target.closest(".conversation[data-id], .search-result[data-search-conversation], .search-result[data-hidden-conversation]");
  const conversation = conversationForUserAction(row);
  if (!row || !conversation || conversation.groupId) return;
  clearTimeout(state.userActionLongPressTimer);
  state.userActionPressPoint = { x: event.clientX, y: event.clientY };
  state.userActionLongPressTimer = setTimeout(() => {
    state.suppressNextConversationClick = true;
    clearTimeout(state.userActionClickResetTimer);
    state.userActionClickResetTimer = setTimeout(() => {
      state.suppressNextConversationClick = false;
    }, 1200);
    const bounds = row.getBoundingClientRect();
    openUserActionMenu(
      conversation,
      Math.min(bounds.left + 24, window.innerWidth - 220),
      Math.min(bounds.bottom, window.innerHeight - 190)
    );
  }, 520);
}

function cancelSidebarUserActionLongPress() {
  clearTimeout(state.userActionLongPressTimer);
  state.userActionPressPoint = null;
}

function cancelSidebarUserActionIfMoved(event) {
  const start = state.userActionPressPoint;
  if (!start) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) {
    cancelSidebarUserActionLongPress();
  }
}

function consumeSuppressedConversationClick(event) {
  if (!state.suppressNextConversationClick) return false;
  if (!event.target.closest(".conversation[data-id], .search-result[data-search-conversation], .search-result[data-hidden-conversation]")) return false;
  state.suppressNextConversationClick = false;
  clearTimeout(state.userActionClickResetTimer);
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function formatMessageDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

function renderMessages({ preserveScroll = true } = {}) {
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
  let previousDateKey = "";
  $("messages").innerHTML = state.messages.map((message) => {
    const messageDate = new Date(message.createdAt);
    const dateKey = Number.isNaN(messageDate.getTime()) ? "" : messageDate.toDateString();
    const dateDivider = dateKey && dateKey !== previousDateKey
      ? `<div class="message-date-divider"><span>${escapeHtml(formatMessageDateLabel(message.createdAt))}</span></div>`
      : "";
    previousDateKey = dateKey;
    const own = message.senderId === state.user.id;
    const ticks = own ? tickLabel(message) : "";
    const selected = state.selectedMessageIds.has(message.id);
    const searchHit = state.messageSearch.matches.includes(message.id);
    const currentHit = searchHit && state.messageSearch.matches[state.messageSearch.index] === message.id;
    const starred = (state.user.starredMessageIds || []).includes(message.id);
    return `
      ${dateDivider}
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

function statusTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function closeStatusViewer() {
  $("statusViewerModal").classList.add("hidden");
  state.activeStatusId = null;
  state.statusSequenceIds = [];
  state.statusViewerIndex = -1;
}

function renderStatusSequenceProgress() {
  return state.statusSequenceIds.map((id, index) => `
    <span class="status-progress-segment ${index < state.statusViewerIndex ? "complete" : ""} ${index === state.statusViewerIndex ? "current" : ""}" aria-hidden="true"></span>
  `).join("");
}

function openStatusViewer(status) {
  state.activeStatusId = status.id;
  $("statusViewerTitle").textContent = status.user?.displayName || "Status";
  const viewers = Array.isArray(status.viewers) ? status.viewers : [];
  const reactions = Array.isArray(status.reactions) ? status.reactions : [];
  const replies = Array.isArray(status.replies) ? status.replies : [];
  const viewerHtml = status.canDelete
    ? `<div class="status-viewers">
        <strong>Viewed by ${status.viewerCount || 0}</strong>
        ${viewers.map((view) => `<small>${escapeHtml(view.user?.displayName || view.user?.userId || "User")} · ${escapeHtml(statusTime(view.at))}</small>`).join("") || "<small>No viewers yet.</small>"}
      </div>
      <div class="status-interaction-details">
        <strong>Reactions (${status.reactionCount || 0})</strong>
        ${reactions.map((reaction) => `<small>${escapeHtml(reaction.emoji)} ${escapeHtml(reaction.user?.displayName || reaction.user?.userId || "User")} · ${escapeHtml(statusTime(reaction.at))}</small>`).join("") || "<small>No reactions yet.</small>"}
        <strong>Replies (${status.replyCount || 0})</strong>
        ${replies.map((reply) => `<small><b>${escapeHtml(reply.user?.displayName || reply.user?.userId || "User")}:</b> ${escapeHtml(reply.text)} · ${escapeHtml(statusTime(reply.at))}</small>`).join("") || "<small>No replies yet.</small>"}
      </div>
      <button class="text-button danger" data-delete-status="${escapeHtml(status.id)}" type="button">Delete status</button>`
    : "";
  const reactionPicker = status.canDelete ? "" : `
    <div class="status-reaction-picker" aria-label="React to status">
      ${["❤️", "😂", "😮", "😢", "🙏", "👍", "🔥", "👏"].map((emoji) => `
        <button type="button" class="${status.myReaction === emoji ? "selected" : ""}" data-status-reaction="${escapeHtml(emoji)}" aria-label="React ${escapeHtml(emoji)}" aria-pressed="${status.myReaction === emoji}">${escapeHtml(emoji)}</button>
      `).join("")}
    </div>
    <form class="status-reply-form">
      <input name="reply" maxlength="500" placeholder="Reply privately to ${escapeHtml(status.user?.displayName || "this status")}" aria-label="Reply to status">
      <button class="primary" type="submit">Send</button>
    </form>
    <small class="status-reply-privacy">Only you and the status poster can see this reply.</small>
    ${replies.map((reply) => `<p class="status-own-reply">${escapeHtml(reply.text)} <small>${escapeHtml(statusTime(reply.at))}</small></p>`).join("")}
  `;
  const progress = renderStatusSequenceProgress();
  const previousDisabled = state.statusViewerIndex <= 0;
  const nextDisabled = state.statusViewerIndex < 0 || state.statusViewerIndex >= state.statusSequenceIds.length - 1;
  $("statusViewerBody").innerHTML = `
    ${renderStatusMedia(status)}
    ${status.text ? `<p>${escapeHtml(status.text)}</p>` : ""}
    ${reactionPicker}
    ${viewerHtml}
  `;
  $("statusViewerMeta").innerHTML = `
    <div class="status-viewer-navigation">
      <button class="text-button" type="button" data-status-previous ${previousDisabled ? "disabled" : ""} aria-label="Previous status">‹</button>
      <div class="status-viewer-progress">${progress}</div>
      <button class="text-button" type="button" data-status-next ${nextDisabled ? "disabled" : ""} aria-label="Next status">›</button>
    </div>
    <small>${status.canDelete ? `${status.viewerCount || 0} views · ` : ""}${escapeHtml(statusTime(status.createdAt))}</small>
    <small>${status.expiresAt ? `Expires ${escapeHtml(statusTime(status.expiresAt))}` : "Expires after 24 hours"}</small>
  `;
  $("statusViewerModal").classList.remove("hidden");
  enforceStatusVideoClip($("statusViewerBody").querySelector("video[data-status-clip]"));
}

async function showStatusAt(index) {
  const statusId = state.statusSequenceIds[index];
  const status = state.statuses.find((item) => item.id === statusId);
  if (!status) return;
  const result = await api(`/api/statuses/${encodeURIComponent(status.id)}/view`, { method: "POST" });
  Object.assign(status, result.status || {}, { viewedByMe: true });
  state.statusViewerIndex = index;
  openStatusViewer(status);
  if (state.mainTab === "updates") renderSectionPanel();
}

async function openStatusSequence(status) {
  const sequence = state.statuses
    .filter((item) => item.userId === status.userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  state.statusSequenceIds = sequence.map((item) => item.id);
  const firstUnseenIndex = sequence.findIndex((item) => !item.viewedByMe);
  const statusIndex = state.statusSequenceIds.indexOf(status.id);
  const startIndex = status.userId === state.user.id
    ? 0
    : firstUnseenIndex >= 0 ? firstUnseenIndex : Math.max(0, statusIndex);
  try {
    await showStatusAt(startIndex);
  } catch (error) {
    alert(error.message);
  }
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
  return contactDisplayName(state.activeConversation?.members?.find((member) => member.id === senderId));
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
  if (!query && !date) {
    state.messageSearch.matches = [];
    state.messageSearch.index = 0;
    $("messageSearchCount").textContent = "0/0";
    return;
  }
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
  if (!state.messageSearch.open || (!state.messageSearch.query.trim() && !state.messageSearch.date)) return;
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
  const previousMessageId = state.reactionPickerMessageId;
  state.reactionPickerMessageId = toggle && previousMessageId === messageId ? null : messageId;
  state.deleteOptionsMessageId = null;
  if (previousMessageId) {
    $ ("messages").querySelector(`[data-message="${CSS.escape(previousMessageId)}"] .reaction-picker`)?.remove();
  }
  if (state.reactionPickerMessageId) {
    const message = state.messages.find((item) => item.id === state.reactionPickerMessageId);
    const article = $ ("messages").querySelector(`[data-message="${CSS.escape(state.reactionPickerMessageId)}"]`);
    if (message && article) article.insertAdjacentHTML("beforeend", renderReactionPicker(message));
  }
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
    const mimeType = escapeHtml(mediaSourceMimeType(media, "audio"));
    return `
      <div class="media-card">
        <audio controls preload="metadata"><source src="${media.url}" type="${mimeType}"></audio>
        <a href="${media.url}" download="${escapeHtml(media.originalName)}">${escapeHtml(media.originalName)}</a>
        ${meta}
      </div>
    `;
  }
  if (media.kind === "video") {
    const mimeType = escapeHtml(mediaSourceMimeType(media, "video"));
    return `
      <div class="media-card">
        <video class="message-video" controls preload="metadata"><source src="${media.url}" type="${mimeType}"></video>
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
      label: contactDisplayName(other),
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
  if (!others.length) return "single";
  if (others.every((id) => message.readBy?.includes(id))) return "blue";
  if (message.deliveryStatusVersion === 1 && others.every((id) => message.deliveredTo?.includes(id))) return "double";
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
  renderMessages({ preserveScroll: false });
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
  const conversation = state.conversations.find((item) => item.id === message.conversationId);
  if (conversation?.muteForever || (conversation?.muteUntil && new Date(conversation.muteUntil).getTime() > Date.now())) return;
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

async function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await ensurePushSubscription();
    }
  } catch {
    // ignore
  }
}

async function openConversationById(conversationId, messageId = null, knownConversation = null) {
  let conversation = knownConversation?.id === conversationId
    ? knownConversation
    : state.conversations.find((item) => item.id === conversationId);
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
  if (conversation.locked) {
    const code = await promptForLockPin("view");
    if (!code) return;
    try {
      await api("/api/lock-pin/verify", {
        method: "POST",
        body: JSON.stringify({ code })
      });
    } catch (error) {
      if (error.status === 403) {
        await showAppMessage("Incorrect PIN", "That PIN did not match. The chat is still locked.");
        return;
      }
      throw error;
    }
    state.lockedChatCode = code;
  } else {
    state.lockedChatCode = "";
  }
  state.mainTab = "chats";
  $("chatView").classList.remove("section-mode");
  $("sectionPanel").classList.add("hidden");
  document.querySelectorAll("[data-main-tab]").forEach((button) => {
    const active = button.dataset.mainTab === "chats";
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  state.activeConversation = conversation;
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  $("chatView").classList.add("conversation-open");
  clearReplyComposer();
  if (state.socket?.connected) state.socket.emit("conversation:join", { conversationId });
  renderHeader();
  renderConversations();
  await loadMessages(conversationId);
  if (messageId) {
    const element = $("messages").querySelector(`[data-message="${CSS.escape(messageId)}"]`);
    element?.scrollIntoView({ block: "center" });
    element?.classList.add("current-hit");
  }
}

async function searchUsers() {
  const q = $("searchInput").value.trim();
  const requestId = ++state.searchRequestId;
  $("searchResults").setAttribute("aria-busy", q.length >= 2 ? "true" : "false");
  document.querySelector(".sidebar")?.classList.toggle("searching", q.length >= 2);
  if (q.length < 2) {
    $("searchResults").innerHTML = "";
    $("searchResults").setAttribute("aria-busy", "false");
    state.hiddenConversations = [];
    state.searchConversationMap.clear();
    return;
  }
  $("searchResults").innerHTML = `<p class="search-feedback">Searching contacts, chats, and messages...</p>`;
  const url = `/api/search?q=${encodeURIComponent(q)}`;
  const results = await api(url);
  if (requestId !== state.searchRequestId) return;
  if (results.hiddenUnlocked) {
    state.searchConversationMap.clear();
    state.hiddenConversations = results.hiddenConversations;
    $("searchResults").innerHTML = renderHiddenVault(results.hiddenConversations);
    $("searchResults").setAttribute("aria-busy", "false");
    return;
  }
  state.searchConversationMap = new Map();
  [...results.conversations, ...results.messages.map((item) => item.conversation)].forEach((conversation) => {
    if (conversation?.id) state.searchConversationMap.set(conversation.id, conversation);
  });
  $("searchResults").innerHTML = renderSearchResults(results, q);
  $("searchResults").setAttribute("aria-busy", "false");
}

async function openNewChatModal() {
  const requestId = ++state.newChatSearchRequestId;
  $("newChatModal").classList.remove("hidden");
  $("newChatSearchInput").value = "";
  $("newChatMessage").textContent = "";
  $("deviceContactsBtn").classList.toggle("hidden", typeof navigator.contacts?.select !== "function"
    && typeof window.AndroidContacts?.postMessage !== "function");
  $("newChatContacts").innerHTML = `<p class="search-feedback">Loading your contacts...</p>`;
  $("newChatSearchInput").focus();
  try {
    const { conversations } = await api("/api/conversations");
    state.newChatContacts = [...new Map(conversations
      .filter((conversation) => !conversation.groupId && !conversation.hidden && !conversation.locked)
      .map((conversation) => getOtherMember(conversation))
      .filter(Boolean)
      .map((user) => [user.id, user])).values()]
      .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
    if (requestId === state.newChatSearchRequestId && !$("newChatSearchInput").value.trim()) {
      renderNewChatContacts(state.newChatContacts, "contacts");
    }
  } catch (error) {
    $("newChatMessage").textContent = error.message;
    $("newChatContacts").innerHTML = "";
  }
}

function renderNewChatContacts(users, view) {
  if (!users.length) {
    $("newChatContacts").innerHTML = `<p class="search-feedback">${view === "contacts"
      ? "No contacts yet. Search by name, user ID, or mobile to start a chat."
      : "No matching contacts found."}</p>`;
    return;
  }
  const sectionTitle = view === "contacts" ? "Your contacts" : view === "matches" ? "On Metagram" : "Search results";
  $("newChatContacts").innerHTML = `<div class="new-chat-section-title">${sectionTitle}</div>${users.map((user) => `
    <button class="search-result new-chat-contact" data-new-chat-user="${escapeHtml(user.id)}" type="button">
      <span class="avatar">${avatarMarkup(user, user.displayName)}</span>
      <span><strong>${escapeHtml(user.displayName)}</strong><small>${user.matchedContactName ? `Saved as ${escapeHtml(user.matchedContactName)} · ` : ""}${escapeHtml(user.userId)} · ${escapeHtml(user.mobile)}${user.hidden ? " · Hidden chat" : ""}</small></span>
      <svg class="new-chat-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"></path></svg>
    </button>`).join("")}`;
}

async function matchDeviceContacts() {
  const nativeContacts = window.AndroidContacts;
  if (typeof nativeContacts?.postMessage === "function") {
    $("newChatMessage").textContent = "";
    nativeContacts.onmessage = (event) => {
      let result;
      try {
        result = JSON.parse(event.data);
      } catch {
        $("newChatMessage").textContent = "Could not read the selected contacts.";
        return;
      }
      if (result.type === "picked") {
        matchSelectedDeviceContacts(result.contacts || []).catch((error) => {
          $("newChatMessage").textContent = error.message;
        });
      } else if (result.type === "error") {
        $("newChatMessage").textContent = result.message || "Could not access device contacts.";
      }
    };
    nativeContacts.postMessage("pick-contacts");
    return;
  }
  if (typeof navigator.contacts?.select !== "function") {
    $("newChatMessage").textContent = "This browser cannot open device contacts. Search by email, name, user ID, or mobile instead.";
    return;
  }
  $("newChatMessage").textContent = "";
  try {
    const contacts = await navigator.contacts.select(["name", "email"], { multiple: true });
    await matchSelectedDeviceContacts(contacts.map((contact) => ({
      name: Array.isArray(contact.name) ? contact.name[0] : contact.name || "",
      emails: Array.isArray(contact.email) ? contact.email : contact.email ? [contact.email] : []
    })));
  } catch (error) {
    if (error.name === "AbortError") return;
    $("newChatMessage").textContent = error.message;
  }
}

async function matchSelectedDeviceContacts(contacts) {
  const selected = contacts.map((contact) => ({
    name: Array.isArray(contact.name) ? contact.name[0] : contact.name || "",
    emails: Array.isArray(contact.emails) ? contact.emails : Array.isArray(contact.email) ? contact.email : contact.email ? [contact.email] : []
  })).filter((contact) => contact.emails.length);
  if (!selected.length) {
    $("newChatMessage").textContent = "The selected contacts do not have email addresses.";
    return;
  }
  $("newChatMessage").textContent = "";
  $("newChatContacts").innerHTML = `<p class="search-feedback">Matching selected email contacts...</p>`;
  const matchedUsers = new Map();
  for (let offset = 0; offset < selected.length; offset += 200) {
    const { users } = await api("/api/users/match-contacts", {
      method: "POST",
      body: JSON.stringify({ contacts: selected.slice(offset, offset + 200) })
    });
    users.forEach((user) => matchedUsers.set(user.id, user));
  }
  const users = [...matchedUsers.values()];
  renderNewChatContacts(users, "matches");
  if (!users.length) {
    $("newChatMessage").textContent = "No selected contact emails match a Metagram account yet. You can still search by email or username.";
  }
}

async function searchNewChatContacts() {
  const q = $("newChatSearchInput").value.trim();
  const requestId = ++state.newChatSearchRequestId;
  $("newChatMessage").textContent = "";
  if (!q) {
    renderNewChatContacts(state.newChatContacts, "contacts");
    return;
  }
  if (q.length < 2) {
    $("newChatContacts").innerHTML = `<p class="search-feedback">Enter at least 2 characters to search all users.</p>`;
    return;
  }
  $("newChatContacts").innerHTML = `<p class="search-feedback">Searching contacts...</p>`;
  try {
    const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    if (requestId !== state.newChatSearchRequestId) return;
    renderNewChatContacts(users, "search");
  } catch (error) {
    if (requestId !== state.newChatSearchRequestId) return;
    $("newChatMessage").textContent = error.message;
    $("newChatContacts").innerHTML = "";
  }
}

async function startConversationWithUser(userId) {
  const { conversation } = await api("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ userId })
  });
  state.conversationView = "active";
  if (!conversation.hidden && !conversation.archived && !conversation.locked) {
    const index = state.conversations.findIndex((item) => item.id === conversation.id);
    if (index >= 0) state.conversations[index] = conversation;
    else state.conversations.unshift(conversation);
    cacheConversations();
    renderConversations();
  }
  $("newChatModal").classList.add("hidden");
  await openConversationById(conversation.id, null, conversation);
}

function renderSearchResults({ users, conversations, messages }, query) {
  const sections = [];
  if (users.length) {
    sections.push(`<div class="search-result-section"><h2>Contacts</h2>${users.map((user) => `
      <button class="search-result" ${user.hidden ? `data-hidden-user="${escapeHtml(user.id)}"` : `data-user="${escapeHtml(user.id)}"`} type="button">
        <span class="avatar">${avatarMarkup(user, user.displayName)}</span>
        <span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.userId)} · ${escapeHtml(user.mobile)}${user.hidden ? " · Hidden chat (secret required)" : ""}</small></span>
      </button>`).join("")}</div>`);
  }
  if (conversations.length) {
    sections.push(`<div class="search-result-section"><h2>Chats</h2>${conversations.map((conversation) => {
      const other = getOtherMember(conversation);
      const title = conversation.group?.name || contactDisplayName(other);
      const last = conversation.lastMessage?.media
        ? `[${conversation.lastMessage.media.kind}]`
        : conversation.lastMessage?.text || "No messages yet";
      return `<button class="search-result" data-search-conversation="${escapeHtml(conversation.id)}" type="button">
        <span class="avatar">${avatarMarkup(other, title)}</span>
        <span><strong>${escapeHtml(title)}${conversation.hidden ? " · Hidden" : ""}</strong><small>${escapeHtml(last)}</small></span>
      </button>`;
    }).join("")}</div>`);
  }
  if (messages.length) {
    sections.push(`<div class="search-result-section"><h2>Messages</h2>${messages.map((item) => {
      const conversation = item.conversation;
      const other = getOtherMember(conversation);
      const title = conversation.group?.name || contactDisplayName(other);
      return `<button class="search-result message-search-result" data-search-message="${escapeHtml(item.id)}" data-search-conversation="${escapeHtml(item.conversationId)}" type="button">
        <span class="avatar">${avatarMarkup(other, title)}</span>
        <span><strong>${escapeHtml(title)} · ${escapeHtml(item.senderName)}</strong><small>${highlightSearchText(item.text, query)}</small></span>
      </button>`;
    }).join("")}</div>`);
  }
  return sections.join("") || `<p class="search-feedback">No contacts, chats, or messages found.</p>`;
}

async function openHiddenSearchResult(userId) {
  const code = await showAppInputDialog({
    title: "Unlock hidden chat",
    message: "Enter your hidden chat secret to open this conversation.",
    label: "Secret code",
    inputType: "password",
    minLength: 4,
    errorMessage: "Secret code must be at least 4 characters."
  });
  if (!code) return;
  const { conversations } = await api(`/api/conversations/hidden?code=${encodeURIComponent(code)}`);
  const conversation = conversations.find((item) => getOtherMember(item)?.id === userId);
  if (!conversation) {
    await showAppMessage("Hidden chat unavailable", "No hidden conversation was found for this user.");
    return;
  }
  await openConversationById(conversation.id, null, conversation);
  clearSidebarSearch();
}

function clearSidebarSearch() {
  clearTimeout(state.searchTimer);
  state.searchRequestId += 1;
  $("searchInput").value = "";
  $("searchResults").innerHTML = "";
  $("searchResults").setAttribute("aria-busy", "false");
  document.querySelector(".sidebar")?.classList.remove("searching");
  state.hiddenConversations = [];
  state.searchConversationMap.clear();
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
        <button class="text-button" data-recover-hidden-secret type="button">Forgot secret code?</button>
        <small id="hiddenCodeMessage"></small>
      </div>
      ${conversations.map((conversation) => {
        const other = getOtherMember(conversation);
        const title = contactDisplayName(other);
        const last = conversation.lastMessage?.media ? `[${conversation.lastMessage.media.kind}]` : conversation.lastMessage?.text || "No messages yet";
        return `
          <button class="search-result hidden-result" data-hidden-conversation="${conversation.id}" type="button">
            <span class="avatar">${avatarMarkup(other, title)}</span>
            <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(last)}</small></span>
          </button>`;
      }).join("") || `<p class="hidden-vault-empty">No hidden chats yet.</p>`}
    `;
}

async function requestHiddenChatSecret(secretExists) {
  return showAppInputDialog({
    title: secretExists ? "Enter hidden chat secret" : "Create hidden chat secret",
    message: secretExists
      ? "Enter your current secret code to hide this chat."
      : "Choose a secret code. Enter it in the search bar later to open hidden chats.",
    label: "Secret code",
    minLength: 4,
    errorMessage: "Secret code must be at least 4 characters."
  });
}

async function recoverHiddenChatSecret() {
  const { email } = await api("/api/me/hidden-secret/recovery/request", {
    method: "POST",
    body: JSON.stringify({})
  });
  const code = await showAppInputDialog({
    title: "Enter email recovery code",
    message: `A 6-digit code was sent to ${email}.`,
    label: "Email code",
    inputType: "text",
    minLength: 6,
    errorMessage: "Enter the 6-digit code from your email."
  });
  if (!code) return;
  const newSecret = await showAppInputDialog({
    title: "Create a new hidden chat secret",
    message: "Use this new secret in the search bar to open hidden chats.",
    label: "New secret code",
    inputType: "password",
    minLength: 4,
    errorMessage: "Secret code must be at least 4 characters."
  });
  if (!newSecret) return;
  const result = await api("/api/me/hidden-secret/recovery/verify", {
    method: "POST",
    body: JSON.stringify({ code, newSecret })
  });
  state.user = result.user;
  if (state.activeConversation?.hidden) {
    state.activeConversation = null;
    state.lockedChatCode = "";
    state.messages = [];
    renderHeader();
    renderMessages();
    $("chatView").classList.remove("conversation-open");
  }
  clearSidebarSearch();
  await loadConversations();
  await showAppMessage(
    "Hidden chat secret updated",
    result.chatsDeleted
      ? "Your hidden chat messages were deleted from your account according to the recovery policy."
      : "Your hidden chats are still available with the new secret code."
  );
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
  form.append("recordingForUserId", state.user?.id || "");
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

function formatRecordingDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateRecordingIndicator(type) {
  const elapsedSeconds = Math.floor((Date.now() - state.recordingStartedAt) / 1000);
  const label = type === "video" ? "Video recording" : "Voice recording";
  const audioStatus = type === "video" && state.videoAudioPaused ? " • Audio paused" : "";
  const paused = type === "voice" && state.recorder?.state === "paused";
  const pauseStatus = paused ? " • Paused" : "";
  $("recordingIndicatorText").textContent = `${label} • ${formatRecordingDuration(elapsedSeconds)}${type === "video" ? " / 01:00" : ""}${audioStatus}${pauseStatus}`;
  if (type === "video") $("videoRecordStatus").textContent = `Recording • ${formatRecordingDuration(elapsedSeconds)} / 01:00${audioStatus}`;
  if (type === "voice") $("voiceRecordStatus").textContent = `${paused ? "Paused" : "Recording"} • ${formatRecordingDuration(elapsedSeconds)}`;
}

function startRecordingIndicator(type) {
  stopRecordingIndicator();
  state.recordingStartedAt = Date.now();
  $("recordingIndicator").classList.remove("hidden");
  $("recordingIndicator").dataset.type = type;
  updateRecordingIndicator(type);
  state.recordingIndicatorTimer = setInterval(() => updateRecordingIndicator(type), 1000);
}

function stopRecordingIndicator() {
  clearInterval(state.recordingIndicatorTimer);
  state.recordingIndicatorTimer = null;
  state.recordingStartedAt = 0;
  $("recordingIndicator").classList.add("hidden");
  delete $("recordingIndicator").dataset.type;
}

function setVideoRecordingAudioPaused(paused) {
  const audioTrack = state.videoAudioStream?.getAudioTracks().find((track) => track.readyState === "live");
  if (!audioTrack) throw new Error("Microphone is not available for this recording.");
  state.videoAudioPaused = paused;
  audioTrack.enabled = !paused;
  const button = $("toggleVideoAudioBtn");
  button.textContent = paused ? "Resume audio" : "Pause audio";
  button.title = paused ? "Resume microphone audio" : "Pause microphone audio";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(paused));
  updateRecordingIndicator("video");
}

function createRecordingFile(chunks, recorder, kind) {
  const mimeType = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || "";
  const normalizedMimeType = mimeType.split(";")[0].toLowerCase();
  const extensions = kind === "video"
    ? { "video/webm": ".webm", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/ogg": ".ogv" }
    : { "audio/webm": ".weba", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/aac": ".aac", "audio/wav": ".wav" };
  if (!extensions[normalizedMimeType]) {
    throw new Error(`This browser recorded an unsupported ${kind} format${mimeType ? ` (${mimeType})` : ""}.`);
  }
  const blob = new Blob(chunks, { type: mimeType });
  if (!blob.size) throw new Error(`No ${kind} data was captured. Please try recording again.`);
  return new File([blob], `${kind}-${Date.now()}${extensions[normalizedMimeType]}`, { type: mimeType });
}

function mediaSourceMimeType(media, kind) {
  const mimeType = String(media.mimeType || "").split(";")[0].trim().toLowerCase();
  if (mimeType.startsWith(`${kind}/`)) return mimeType;
  const filename = `${media.originalName || ""} ${media.url || ""}`.toLowerCase();
  if (filename.includes(".webm") || filename.includes(".weba")) return `${kind}/webm`;
  if (kind === "audio") {
    if (/\.(m4a|mp4)(?:\?|$)/.test(filename)) return "audio/mp4";
    if (/\.(ogg|opus)(?:\?|$)/.test(filename)) return "audio/ogg";
    if (/\.mp3(?:\?|$)/.test(filename)) return "audio/mpeg";
    if (/\.wav(?:\?|$)/.test(filename)) return "audio/wav";
  } else {
    if (/\.(mp4|m4v)(?:\?|$)/.test(filename)) return "video/mp4";
    if (/\.mov(?:\?|$)/.test(filename)) return "video/quicktime";
    if (/\.(ogv|ogg)(?:\?|$)/.test(filename)) return "video/ogg";
  }
  return `${kind}/webm`;
}

function openVoiceRecordingPreview() {
  if (state.recorder?.state === "recording" || state.recorder?.state === "paused") return;
  $("voiceRecordStatus").textContent = "Ready to record. Tap Start when you are ready.";
  $("startVoiceRecordBtn").classList.remove("hidden");
  $("startVoiceRecordBtn").disabled = false;
  $("toggleVoicePauseBtn").classList.add("hidden");
  $("stopVoiceRecordBtn").classList.add("hidden");
  $("voicePreviewModal").classList.remove("hidden");
}

async function startVoiceRecording() {
  if (state.recorder?.state === "recording" || state.recorder?.state === "paused") return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Voice recording is not supported in this browser.");
  $("startVoiceRecordBtn").disabled = true;
  state.audioRecordingCancelled = false;
  const requestId = ++state.audioRecordingRequestId;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (requestId !== state.audioRecordingRequestId || state.audioRecordingCancelled) {
    stream.getTracks().forEach((track) => track.stop());
    $("startVoiceRecordBtn").disabled = false;
    return;
  }
  state.audioStream = stream;
  state.audioChunks = [];
  const audioTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];
  const mimeType = audioTypes.find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  state.recorder = recorder;
  recorder.ondataavailable = (event) => {
    if (event.data.size) state.audioChunks.push(event.data);
  };
  recorder.onstop = async () => {
    const chunks = state.audioChunks;
    state.audioChunks = [];
    const cancelled = state.audioRecordingCancelled;
    state.audioRecordingCancelled = false;
    $("voiceBtn").classList.remove("recording");
    $("voiceBtn").setAttribute("aria-pressed", "false");
    $("voiceBtn").setAttribute("aria-label", "Record voice");
    $("voiceBtn").title = "Record voice";
    stopRecordingIndicator();
    stream.getTracks().forEach((track) => track.stop());
    state.audioStream = null;
    $("voicePreviewModal").classList.add("hidden");
    $("startVoiceRecordBtn").disabled = false;
    $("toggleVoicePauseBtn").classList.add("hidden");
    $("toggleVoicePauseBtn").textContent = "Pause";
    $("toggleVoicePauseBtn").setAttribute("aria-label", "Pause voice recording");
    $("toggleVoicePauseBtn").setAttribute("aria-pressed", "false");
    $("stopVoiceRecordBtn").classList.add("hidden");
    if (state.recorder === recorder) state.recorder = null;
    if (cancelled) return;
    try {
      setUploadStatus("Sending voice message...");
      await sendMediaFile(createRecordingFile(chunks, recorder, "audio"));
      setUploadStatus("Voice message sent.");
      setTimeout(() => setUploadStatus(""), 1600);
    } catch (error) {
      setUploadStatus("");
      alert(error.message);
    }
  };
  try {
    recorder.start();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    state.recorder = null;
    throw error;
  }
  $("startVoiceRecordBtn").classList.add("hidden");
  $("toggleVoicePauseBtn").classList.remove("hidden");
  $("stopVoiceRecordBtn").classList.remove("hidden");
  $("voiceBtn").classList.add("recording");
  $("voiceBtn").setAttribute("aria-pressed", "true");
  $("voiceBtn").setAttribute("aria-label", "Stop voice recording");
  $("voiceBtn").title = "Stop voice recording";
  startRecordingIndicator("voice");
}

function toggleVoiceRecordingPause() {
  const recorder = state.recorder;
  if (!recorder || !["recording", "paused"].includes(recorder.state)) return;
  if (recorder.state === "recording") {
    recorder.pause();
    $("toggleVoicePauseBtn").textContent = "Resume";
    $("toggleVoicePauseBtn").setAttribute("aria-label", "Resume voice recording");
    $("toggleVoicePauseBtn").setAttribute("aria-pressed", "true");
  } else {
    recorder.resume();
    $("toggleVoicePauseBtn").textContent = "Pause";
    $("toggleVoicePauseBtn").setAttribute("aria-label", "Pause voice recording");
    $("toggleVoicePauseBtn").setAttribute("aria-pressed", "false");
  }
  updateRecordingIndicator("voice");
}

function cancelVoiceRecording() {
  state.audioRecordingCancelled = true;
  state.audioRecordingRequestId += 1;
  const recorder = state.recorder;
  if (recorder?.state === "recording" || recorder?.state === "paused") {
    recorder.stop();
    return;
  }
  $("startVoiceRecordBtn").disabled = false;
  $("voicePreviewModal").classList.add("hidden");
}

async function openVideoRecordingPreview() {
  if (state.videoRecorder?.state === "recording") {
    state.videoRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera recording is not supported in this browser.");
  if (!window.MediaRecorder) throw new Error("Video recording is not supported in this browser.");
  $("videoCameraSelect").value = "environment";
  state.videoCameraFacingMode = "environment";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: state.videoCameraFacingMode } }
  });
  state.videoStream = stream;
  const actualFacingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (actualFacingMode === "user" || actualFacingMode === "environment") {
    state.videoCameraFacingMode = actualFacingMode;
    $("videoCameraSelect").value = actualFacingMode;
  }
  $("videoRecordPreview").srcObject = stream;
  $("videoPreviewModal").classList.remove("hidden");
  $("videoRecordStatus").textContent = "Set your camera, then tap Start recording.";
  $("startVideoRecordBtn").classList.remove("hidden");
  $("stopVideoRecordBtn").classList.add("hidden");
  $("startVideoRecordBtn").disabled = false;
}

async function startVideoRecording() {
  if (!state.videoStream?.getVideoTracks().some((track) => track.readyState === "live")) {
    throw new Error("Camera preview is not ready. Please choose a camera again.");
  }
  $("startVideoRecordBtn").disabled = true;
  state.videoAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioTrack = state.videoAudioStream.getAudioTracks().find((track) => track.readyState === "live");
  if (!audioTrack) {
    state.videoAudioStream.getTracks().forEach((track) => track.stop());
    state.videoAudioStream = null;
    throw new Error("No active microphone was found. Check microphone permission and try again.");
  }
  audioTrack.enabled = true;
  state.videoAudioPaused = false;
  state.videoChunks = [];
  state.videoRecordingCancelled = false;
  const video = $("videoRecordPreview");
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Video recording is not supported in this browser.");
  state.videoCanvas = canvas;
  state.videoCanvasStream = canvas.captureStream(24);
  const recordingStream = new MediaStream([
    ...state.videoCanvasStream.getVideoTracks(),
    audioTrack
  ]);
  const drawPreviewFrame = () => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    }
    state.videoCanvasAnimation = requestAnimationFrame(drawPreviewFrame);
  };
  drawPreviewFrame();
  const supportedTypes = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4"
  ];
  const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
  if (!recordingStream.getAudioTracks().some((track) => track.enabled && track.readyState === "live")) {
    throw new Error("Microphone audio could not be added to the video recording.");
  }
  state.videoRecorder = recorder;
  recorder.ondataavailable = (event) => {
    if (event.data.size) state.videoChunks.push(event.data);
  };
  recorder.onstop = async () => {
    const chunks = state.videoChunks;
    state.videoChunks = [];
    const cancelled = state.videoRecordingCancelled;
    state.videoRecordingCancelled = false;
    clearTimeout(state.videoTimer);
    state.videoTimer = null;
    $("videoRecordBtn").classList.remove("recording");
    $("videoRecordBtn").setAttribute("aria-pressed", "false");
    $("videoRecordBtn").setAttribute("aria-label", "Record video");
    $("videoRecordBtn").title = "Record video";
    stopRecordingIndicator();
    $("recordingIndicator").classList.add("hidden");
    $("startVideoRecordBtn").disabled = false;
    $("startVideoRecordBtn").classList.remove("hidden");
    $("stopVideoRecordBtn").classList.add("hidden");
    $("toggleVideoAudioBtn").classList.add("hidden");
    $("toggleVideoAudioBtn").disabled = false;
    $("toggleVideoAudioBtn").textContent = "Pause audio";
    $("toggleVideoAudioBtn").setAttribute("aria-pressed", "false");
    state.videoAudioPaused = false;
    if (state.videoCanvasAnimation) cancelAnimationFrame(state.videoCanvasAnimation);
    state.videoCanvasAnimation = null;
    state.videoCanvasStream?.getTracks().forEach((track) => track.stop());
    state.videoCanvasStream = null;
    state.videoCanvas = null;
    state.videoAudioStream?.getTracks().forEach((track) => track.stop());
    state.videoAudioStream = null;
    state.videoStream?.getTracks().forEach((track) => track.stop());
    state.videoStream = null;
    $("videoRecordPreview").srcObject = null;
    $("videoPreviewModal").classList.add("hidden");
    if (cancelled) {
      setUploadStatus("");
      return;
    }
    try {
      const file = createRecordingFile(chunks, recorder, "video");
      setUploadStatus("Uploading recorded video...");
      await sendMediaFile(file);
      setUploadStatus("Video sent.");
      setTimeout(() => setUploadStatus(""), 1600);
    } catch (error) {
      setUploadStatus("");
      alert(error.message);
    }
  };
  state.videoRecorder.start();
  $("startVideoRecordBtn").classList.add("hidden");
  $("stopVideoRecordBtn").classList.remove("hidden");
  $("toggleVideoAudioBtn").classList.remove("hidden");
  $("toggleVideoAudioBtn").disabled = false;
  $("toggleVideoAudioBtn").textContent = "Pause audio";
  $("toggleVideoAudioBtn").setAttribute("aria-label", "Pause microphone audio");
  $("toggleVideoAudioBtn").title = "Pause microphone audio";
  $("toggleVideoAudioBtn").setAttribute("aria-pressed", "false");
  $("videoRecordBtn").classList.add("recording");
  $("videoRecordBtn").setAttribute("aria-pressed", "true");
  $("videoRecordBtn").setAttribute("aria-label", "Stop video recording");
  $("videoRecordBtn").title = "Stop video recording";
  startRecordingIndicator("video");
  setUploadStatus("Recording video... max 1 minute.");
  state.videoTimer = setTimeout(() => {
    if (state.videoRecorder?.state === "recording") state.videoRecorder.stop();
  }, 60 * 1000);
}

async function changeVideoRecordingCamera() {
  const facingMode = $("videoCameraSelect").value || "environment";
  if (facingMode === state.videoCameraFacingMode && state.videoStream) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facingMode } }
  });
  const previousStream = state.videoStream;
  state.videoStream = stream;
  const actualFacingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
  state.videoCameraFacingMode = actualFacingMode === "user" || actualFacingMode === "environment" ? actualFacingMode : facingMode;
  $("videoCameraSelect").value = state.videoCameraFacingMode;
  $("videoRecordPreview").srcObject = stream;
  previousStream?.getTracks().forEach((track) => track.stop());
}

function cancelVideoRecording() {
  if (state.videoRecorder?.state === "recording") {
    state.videoRecordingCancelled = true;
    state.videoRecorder.stop();
    return;
  }
  clearTimeout(state.videoTimer);
  state.videoTimer = null;
  state.videoChunks = [];
  if (state.videoCanvasAnimation) cancelAnimationFrame(state.videoCanvasAnimation);
  state.videoCanvasAnimation = null;
  state.videoCanvasStream?.getTracks().forEach((track) => track.stop());
  state.videoCanvasStream = null;
  state.videoAudioStream?.getTracks().forEach((track) => track.stop());
  state.videoAudioStream = null;
  state.videoStream?.getTracks().forEach((track) => track.stop());
  state.videoStream = null;
  state.videoRecordingCancelled = false;
  $("videoRecordPreview").srcObject = null;
  $("videoPreviewModal").classList.add("hidden");
  $("startVideoRecordBtn").classList.remove("hidden");
  $("startVideoRecordBtn").disabled = false;
  $("stopVideoRecordBtn").classList.add("hidden");
  $("toggleVideoAudioBtn").classList.add("hidden");
  $("toggleVideoAudioBtn").disabled = false;
  $("toggleVideoAudioBtn").textContent = "Pause audio";
  $("toggleVideoAudioBtn").setAttribute("aria-pressed", "false");
  state.videoAudioPaused = false;
  $("videoRecordStatus").textContent = "Set your camera, then tap Start recording.";
  $("videoRecordBtn").classList.remove("recording");
  $("videoRecordBtn").setAttribute("aria-pressed", "false");
  $("videoRecordBtn").setAttribute("aria-label", "Record video");
  $("videoRecordBtn").title = "Record video";
  stopRecordingIndicator();
  setUploadStatus("");
}

function directPeer(conversation = state.activeConversation) {
  if (!conversation || conversation.groupId) return null;
  return getOtherMember(conversation);
}

async function persistCallHistory(call, status, durationSeconds = 0) {
  if (!call?.conversationId || !call.peerId) return;
  call.historyState ||= { id: call.historyId || null, promise: Promise.resolve() };
  const historyState = call.historyState;
  historyState.promise = historyState.promise.then(async () => {
    const { call: savedCall } = await api("/api/calls", {
      method: "POST",
      body: JSON.stringify({
        id: historyState.id,
        conversationId: call.conversationId,
        peerId: call.peerId,
        type: call.type,
        direction: call.direction,
        status,
        durationSeconds
      })
    });
    historyState.id = savedCall.id;
    call.historyId = savedCall.id;
    if (state.mainTab === "calls") await loadCallHistory();
  }).catch((error) => {
    console.error("Could not save call history:", error);
    if (state.mainTab === "calls") $("sectionPanelSubtitle").textContent = `Call history could not be saved: ${error.message}`;
  });
  return historyState.promise;
}

function callMediaConstraints(type = state.call.type) {
  const wantsVideo = type === "video";
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: wantsVideo ? {
      facingMode: $("cameraSelect")?.value || state.cameraFacingMode || "user",
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 24, max: 30 }
    } : false
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
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d");
      const draw = () => {
        context.fillStyle = "#101817";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if ($("remoteVideo").readyState >= 2) context.drawImage($("remoteVideo"), 0, 0, canvas.width, canvas.height);
        if ($("localVideo").readyState >= 2) {
          const insetWidth = 200;
          const insetHeight = 112;
          context.fillStyle = "rgba(255,255,255,0.9)";
          context.fillRect(canvas.width - insetWidth - 20, canvas.height - insetHeight - 20, insetWidth, insetHeight);
          context.drawImage($("localVideo"), canvas.width - insetWidth - 18, canvas.height - insetHeight - 18, insetWidth - 8, insetHeight - 8);
        }
        animationId = requestAnimationFrame(draw);
        state.call.recorderAnimation = animationId;
      };
      draw();
      state.call.recorderCanvas = canvas;
      recordStream = new MediaStream([
        ...canvas.captureStream(15).getVideoTracks(),
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
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
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
  const acceptingIncomingCall = state.call.active
    && state.call.incoming
    && state.call.conversationId === conversationId
    && state.call.peerId === peerId
    && !incoming;
  if (!acceptingIncomingCall) endCall(false);
  state.call.conversationId = conversationId;
  state.call.peerId = peerId;
  state.call.incoming = incoming;
  state.call.type = type;
  state.call.shouldRecord = shouldRecord;
  state.call.active = true;
  state.call.viewMode = "default";
  $("callTitle").textContent = type === "video" ? "Video call" : "Voice call";
  $("callModal").classList.remove("hidden");
  $("callVideoGrid").classList.toggle("hidden", type !== "video");
  $("switchCallCameraBtn").classList.toggle("hidden", type !== "video");
  $("toggleCallViewBtn").classList.toggle("hidden", type !== "video");
  updateCallViewMode();
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
  state.call.direction = "outgoing";
  state.call.historyId = null;
  state.call.historyState = { id: null, promise: Promise.resolve() };
  state.call.connectedAt = null;
  await persistCallHistory(state.call, "calling");
  state.socket.emit("call:invite", { conversationId: state.activeConversation.id, callType: type });
  armCallRingTimeout();
}

function armCallRingTimeout() {
  clearTimeout(state.call.ringTimeout);
  state.call.ringTimeout = setTimeout(() => {
    if (!state.call.active || state.call.connectedAt) return;
    const status = state.call.direction === "incoming" ? "missed" : "no_answer";
    $("callStatus").textContent = status === "missed" ? "Missed call" : "No answer";
    endCall(true, status);
  }, 60000);
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
  state.call.direction = "incoming";
  state.call.historyId = null;
  state.call.historyState = { id: null, promise: Promise.resolve() };
  state.call.connectedAt = null;
  state.call.active = true;
  $("callTitle").textContent = `${fromName || "User"} is calling`;
  $("callStatus").textContent = callType === "video" ? "Incoming video call" : "Incoming voice call";
  $("callVideoGrid").classList.toggle("hidden", callType !== "video");
  $("switchCallCameraBtn").classList.toggle("hidden", callType !== "video");
  $("toggleCallViewBtn").classList.toggle("hidden", callType !== "video");
  updateCallViewMode();
  $("incomingCallActions").classList.remove("hidden");
  $("endCallBtn").classList.add("hidden");
  $("callModal").classList.remove("hidden");
  persistCallHistory(state.call, "calling");
  armCallRingTimeout();
}

async function acceptIncomingCall() {
  const { conversationId, peerId, type } = state.call;
  clearTimeout(state.call.ringTimeout);
  state.call.ringTimeout = null;
  $("incomingCallActions").classList.add("hidden");
  $("endCallBtn").classList.remove("hidden");
  $("callStatus").textContent = "Connecting...";
  await prepareCall({ conversationId, peerId, incoming: false, type, shouldRecord: false });
  state.call.connectedAt = Date.now();
  await persistCallHistory(state.call, "connected");
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

function endCall(notifyPeer = true, status = null) {
  const call = { ...state.call };
  const { conversationId, peerId } = call;
  const finalStatus = status || (call.connectedAt
    ? "completed"
    : call.direction === "incoming" ? "missed" : "cancelled");
  if (notifyPeer && conversationId && peerId) {
    state.socket.emit("call:end", { conversationId, targetUserId: peerId, callStatus: finalStatus });
  }
  clearTimeout(call.ringTimeout);
  if (conversationId && peerId && (call.historyId || call.historyState)) {
    const durationSeconds = call.connectedAt ? Math.floor((Date.now() - call.connectedAt) / 1000) : 0;
    persistCallHistory(call, finalStatus, durationSeconds);
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
    direction: "outgoing",
    historyId: null,
    historyState: null,
    connectedAt: null,
    ringTimeout: null,
    shouldRecord: false,
    incoming: false,
    active: false,
    viewMode: "default"
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
  $("callVideoGrid").classList.remove("swap-view");
  renderHeader();
}

function updateCallViewMode() {
  const grid = $("callVideoGrid");
  if (!grid) return;
  grid.classList.toggle("swap-view", state.call.viewMode === "swapped");
  const button = $("toggleCallViewBtn");
  if (button) {
    button.textContent = state.call.viewMode === "swapped" ? "Normal view" : "Swap view";
  }
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
async function handleCalculatorButtonInput(button) {
  if (!button) return;
  const value = button.dataset.calcValue || button.getAttribute("data-calc-value");
  const action = button.dataset.calcAction || button.getAttribute("data-calc-action");
  const fn = button.dataset.calcFn || button.getAttribute("data-calc-fn");
  if (!value && !action && !fn) return;

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
    clearCalculatorResetTimer();
    scheduleCalculatorResetTimer();
    updateCalculatorDisplay();
    updateCalculatorHistory(getCalculatorPreview(state.calculatorExpression));
    return;
  }
  if (action === "toggle-sign") {
    const val = state.calculatorExpression.trim();
    if (!val || val === "0") return;
    if (val.startsWith("-")) {
      state.calculatorExpression = val.slice(1);
    } else {
      state.calculatorExpression = `-${val}`;
    }
    updateCalculatorDisplay();
    updateCalculatorHistory(getCalculatorPreview(state.calculatorExpression));
    return;
  }
  if (action === "percent") {
    const val = Number(state.calculatorExpression) || 0;
    state.calculatorExpression = String(val / 100);
    updateCalculatorDisplay();
    updateCalculatorHistory(getCalculatorPreview(state.calculatorExpression));
    return;
  }
  if (action === "equals") {
    await handleCalculatorEquals();
    return;
  }
  if (fn) {
    const val = Number(state.calculatorExpression) || 0;
    let result = val;
    switch (fn) {
      case "sin": result = Math.sin(val); break;
      case "cos": result = Math.cos(val); break;
      case "tan": result = Math.tan(val); break;
      case "log": result = val > 0 ? Math.log10(val) : NaN; break;
      case "sqrt": result = val >= 0 ? Math.sqrt(val) : NaN; break;
      case "square": result = val * val; break;
      case "exp": result = Math.exp(val); break;
      case "pi": result = Math.PI; break;
      default: return;
    }
    state.calculatorExpression = Number.isFinite(result) ? String(Number(result.toPrecision(12))) : "Error";
    updateCalculatorDisplay();
  }
}

async function handleCalcEvent(event) {
  const button = event.target.closest("[data-calc-value], [data-calc-action], [data-calc-fn]");
  if (!button) return;
  if (event.cancelable) event.preventDefault();
  await handleCalculatorButtonInput(button);
}

document.addEventListener("click", (event) => {
  if (event.target.closest("#calculatorPrivacyView")) {
    handleCalcEvent(event);
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
document.addEventListener("visibilitychange", () => {
  handlePrivacyVisibilityChange();
  if (
    document.visibilityState === "visible"
    && state.mainTab === "chats"
    && state.activeConversation
    && !$("chatView").classList.contains("hidden")
    && $("chatView").classList.contains("conversation-open")
  ) {
    loadMessages(state.activeConversation.id).catch((error) => {
      console.error("Could not refresh visible conversation messages:", error);
    });
  }
});
window.addEventListener("blur", startPrivacyAwayLock);
window.addEventListener("focus", handlePrivacyReturn);
window.addEventListener("pagehide", startPrivacyAwayLock);
document.addEventListener("dblclick", (event) => {
  // Don't trigger panic lock if double-tapping calculator buttons
  if ($("calculatorPrivacyView").contains(event.target)) return;
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
    clearCalculatorResetTimer();
    scheduleCalculatorResetTimer();
    updateCalculatorDisplay();
    updateCalculatorHistory(getCalculatorPreview(state.calculatorExpression));
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    state.calculatorExpression = "";
    clearCalculatorResetTimer();
    updateCalculatorHistory("");
    updateCalculatorDisplay();
  }
});
$("profileBtn").addEventListener("click", () => {
  closeTopbarMenu();
  $("themePreference").value = getThemePreference();
  $("profileName").value = state.user.displayName;
  $("profileUserId").value = state.user.userId || "";
  $("profileMobile").value = state.user.mobile || "";
  $("profileEmail").value = state.user.email || "";
  $("profileStatusInput").value = state.user.statusText || "";
  $("profileAvatarInput").value = "";
  renderAvatarInto($("profileAvatarPreview"), state.user, state.user.displayName);
  $("privacyCodeInput").value = "";
  state.emailVerificationToken = "";
  state.emailVerificationExpiresAt = 0;
  $("profileEmailVerificationStatus").textContent = "";
  syncPrivacySettings();
  syncNotificationSettings();
  syncMessageAutoDeleteSettings();
  $("profileMessage").textContent = "";
  $("profileMessage").classList.remove("success-text");
  $("profileModal").classList.remove("hidden");
  renderProfileGoogleVerifyButton();
});
$("closeProfileBtn").addEventListener("click", () => {
  state.emailVerificationToken = "";
  state.emailVerificationExpiresAt = 0;
  if (state.googleFlow === "email-verify") state.googleFlow = null;
  $("profileModal").classList.add("hidden");
});
$("themePreference").addEventListener("change", (event) => {
  saveThemePreference(event.currentTarget.value);
});
$("messageAutoDeleteToggle").addEventListener("change", () => {
  $("messageAutoDeleteTtl").disabled = !$("messageAutoDeleteToggle").checked;
});
document.addEventListener("pointerdown", startSidebarUserActionLongPress);
document.addEventListener("pointerup", cancelSidebarUserActionLongPress);
document.addEventListener("pointercancel", cancelSidebarUserActionLongPress);
document.addEventListener("pointermove", cancelSidebarUserActionIfMoved);
document.addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".conversation[data-id], .search-result[data-search-conversation], .search-result[data-hidden-conversation]");
  const conversation = conversationForUserAction(row);
  if (!row || !conversation || conversation.groupId) return;
  event.preventDefault();
  openUserActionMenu(conversation, event.clientX, event.clientY);
});
$("menuBlockUserBtn").addEventListener("click", () => {
  runUserAction(toggleConversationBlock);
});
$("menuLockChatBtn").addEventListener("click", () => {
  runUserAction(toggleConversationLock);
});
$("menuHideChatBtn").addEventListener("click", () => {
  runUserAction(toggleConversationHidden);
});
$("menuDeleteUserBtn").addEventListener("click", () => {
  runUserAction(deleteConversationUser);
});
document.addEventListener("click", (event) => {
  if (event.target.closest("#userActionMenu")) return;
  closeUserActionMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeUserActionMenu();
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
$("forgotHiddenSecretBtn").addEventListener("click", () => {
  closeTopbarMenu();
  recoverHiddenChatSecret().catch((error) => showAppMessage("Recovery failed", error.message));
});
document.addEventListener("click", (event) => {
  if (event.target.closest(".sidebar-fixed-actions")) return;
  closeTopbarMenu();
});
$("backBtn").addEventListener("click", () => {
  if (state.activeConversation?.locked) {
    state.lockedChatCode = "";
    state.messages = [];
    renderMessages();
  }
  $("chatView").classList.remove("conversation-open");
});
$("chatView").addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-main-tab]");
  if (tabButton) setMainTab(tabButton.dataset.mainTab).catch((error) => {
    $("sectionPanelSubtitle").textContent = error.message;
  });
});
$("activeChatsBtn").addEventListener("click", async () => {
  state.conversationView = "active";
  await setMainTab("chats");
});
$("archivedChatsBtn").addEventListener("click", async () => {
  if (state.mainTab !== "chats") await setMainTab("chats");
  state.conversationView = "archived";
  await loadConversations();
});
$("starredViewBtn").addEventListener("click", async () => {
  if (state.mainTab !== "chats") await setMainTab("chats");
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
$("closeStatusViewerBtn").addEventListener("click", closeStatusViewer);
$("statusViewerBody").addEventListener("click", async (event) => {
  const reactionButton = event.target.closest("[data-status-reaction]");
  if (reactionButton && state.activeStatusId) {
    reactionButton.disabled = true;
    try {
      const { status } = await api(`/api/statuses/${encodeURIComponent(state.activeStatusId)}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji: reactionButton.dataset.statusReaction })
      });
      const index = state.statuses.findIndex((item) => item.id === status.id);
      if (index >= 0) state.statuses[index] = status;
      openStatusViewer(status);
      renderSectionPanel();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const button = event.target.closest("[data-delete-status]");
  if (!button) return;
  if (!await showAppConfirm("Delete this status?", "Delete status")) return;
  button.disabled = true;
  try {
    await api(`/api/statuses/${button.dataset.deleteStatus}`, { method: "DELETE" });
    state.statuses = state.statuses.filter((status) => status.id !== button.dataset.deleteStatus);
    closeStatusViewer();
    if (state.mainTab === "updates") renderSectionPanel();
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
});
$("statusViewerBody").addEventListener("submit", async (event) => {
  const form = event.target.closest(".status-reply-form");
  if (!form || !state.activeStatusId) return;
  event.preventDefault();
  const input = form.elements.reply;
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const sendButton = form.querySelector('button[type="submit"]');
  sendButton.disabled = true;
  try {
    const { status } = await api(`/api/statuses/${encodeURIComponent(state.activeStatusId)}/replies`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    const index = state.statuses.findIndex((item) => item.id === status.id);
    if (index >= 0) state.statuses[index] = status;
    openStatusViewer(status);
    renderSectionPanel();
  } catch (error) {
    alert(error.message);
    sendButton.disabled = false;
  }
});
$("statusViewerMeta").addEventListener("click", async (event) => {
  const previous = event.target.closest("[data-status-previous]");
  const next = event.target.closest("[data-status-next]");
  if (previous && state.statusViewerIndex > 0) {
    try {
      await showStatusAt(state.statusViewerIndex - 1);
    } catch (error) {
      alert(error.message);
    }
  } else if (next && state.statusViewerIndex < state.statusSequenceIds.length - 1) {
    try {
      await showStatusAt(state.statusViewerIndex + 1);
    } catch (error) {
      alert(error.message);
    }
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
$("chatIdentity").addEventListener("click", showContactDetails);
$("chatAvatar").addEventListener("click", showContactDetails);
for (const element of [$("chatIdentity"), $("chatAvatar")]) {
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    showContactDetails();
  });
}
$("closeContactDetailsBtn").addEventListener("click", () => $("contactDetailsModal").classList.add("hidden"));
$("contactDetailsModal").addEventListener("click", (event) => {
  if (event.target === $("contactDetailsModal")) $("contactDetailsModal").classList.add("hidden");
});
$("contactLockChatBtn").addEventListener("click", async () => {
  try {
    await toggleConversationLock(state.activeConversation);
    if (state.activeConversation) showContactDetails();
    else $("contactDetailsModal").classList.add("hidden");
  } catch (error) {
    await showAppMessage("Could not update chat lock", error.message);
  }
});
$("contactHideChatBtn").addEventListener("click", async () => {
  const conversation = currentContactDetailsConversation();
  if (!conversation) return;
  try {
    await toggleConversationHidden(conversation);
    if (conversation.hidden) $("contactDetailsModal").classList.add("hidden");
    else showContactDetails();
  } catch (error) {
    await showAppMessage("Could not update hidden chat", error.message);
  }
});
$("contactDetailsMenuBtn").addEventListener("click", toggleContactDetailsMenu);
$("contactDetailsMenu").addEventListener("click", async (event) => {
  const action = event.target.closest("button");
  if (!action) return;
  $("contactDetailsMenu").classList.add("hidden");
  $("contactDetailsMenuBtn").setAttribute("aria-expanded", "false");
  if (action.id === "shareContactBtn") {
    openContactShare();
  } else if (action.id === "shareContactOutsideBtn") {
    try {
      await shareContactOutside();
    } catch (error) {
      if (error.name !== "AbortError") alert(error.message);
    }
  } else if (action.id === "editContactNameBtn") {
    $("contactNameForm").classList.remove("hidden");
    $("contactNameInput").focus();
    $("contactNameInput").select();
  }
});
document.addEventListener("click", (event) => {
  if (event.target.closest("#contactDetailsMenu, #contactDetailsMenuBtn")) return;
  $("contactDetailsMenu")?.classList.add("hidden");
  $("contactDetailsMenuBtn")?.setAttribute("aria-expanded", "false");
});
$("contactNameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = event.currentTarget.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  $("contactNameMessage").textContent = "";
  try {
    await updateContactConversationPreferences({ contactName: $("contactNameInput").value.trim() });
    $("contactNameMessage").textContent = "Contact name saved on this account.";
  } catch (error) {
    $("contactNameMessage").textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});
$("cancelContactNameBtn").addEventListener("click", () => $("contactNameForm").classList.add("hidden"));
$("favoriteContactBtn").addEventListener("click", async () => {
  const conversation = currentContactDetailsConversation();
  if (!conversation) return;
  try {
    await updateContactConversationPreferences({ favorite: !conversation.favorite });
  } catch (error) {
    alert(error.message);
  }
});
$("createGroupWithContactBtn").addEventListener("click", startGroupWithContact);
$("contactMuteSelect").addEventListener("change", async (event) => {
  try {
    await setContactMute(event.currentTarget.value);
  } catch (error) {
    alert(error.message);
  }
});
$("saveContactMuteBtn").addEventListener("click", async () => {
  try {
    await saveCustomContactMute();
  } catch (error) {
    alert(error.message);
  }
});
$("contactDisappearingSelect").addEventListener("change", async (event) => {
  try {
    await setContactDisappearing(event.currentTarget.value);
  } catch (error) {
    alert(error.message);
  }
});
$("saveContactDisappearingBtn").addEventListener("click", async () => {
  try {
    await saveContactDisappearing();
  } catch (error) {
    alert(error.message);
  }
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
  if (!await showAppConfirm("Delete selected messages for everyone?", "Delete messages")) return;
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
  if (!state.activeConversation || !await showAppConfirm("Clear this chat from your screen?", "Clear chat")) return;
  await api(`/api/conversations/${state.activeConversation.id}/clear-for-me`, { method: "POST" });
  state.messages = [];
  renderMessages();
  await loadConversations();
});
$("searchInput").addEventListener("input", () => {
  const showChats = $("searchInput").value.trim() && state.mainTab !== "chats";
  const switchTab = showChats ? setMainTab("chats") : Promise.resolve();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    switchTab.then(() => searchUsers()).catch((error) => {
      $("searchResults").setAttribute("aria-busy", "false");
      $("searchResults").innerHTML = `<p class="search-feedback">Search failed: ${escapeHtml(error.message)}</p>`;
    });
  }, 180);
});

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
$("statusTextInput").addEventListener("input", () => {
  $("statusCharacterCount").textContent = `${$("statusTextInput").value.length}/500`;
});
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
    $("statusCharacterCount").textContent = "0/500";
    $("statusImageInput").value = "";
    clearStatusFilePreview();
    $("statusComposer").dataset.open = "false";
    $("statusComposer").classList.add("hidden");
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
  if (state.recorder?.state === "recording" || state.recorder?.state === "paused") {
    state.recorder.stop();
    return;
  }
  openVoiceRecordingPreview();
});
$("startVoiceRecordBtn").addEventListener("click", () => {
  startVoiceRecording().catch((error) => {
    $("startVoiceRecordBtn").disabled = false;
    state.audioStream?.getTracks().forEach((track) => track.stop());
    state.audioStream = null;
    state.recorder = null;
    $("voiceRecordStatus").textContent = error.message;
  });
});
$("toggleVoicePauseBtn").addEventListener("click", () => {
  try {
    toggleVoiceRecordingPause();
  } catch (error) {
    $("voiceRecordStatus").textContent = error.message;
  }
});
$("stopVoiceRecordBtn").addEventListener("click", () => {
  if (state.recorder?.state === "recording" || state.recorder?.state === "paused") {
    state.audioRecordingCancelled = false;
    state.recorder.stop();
  }
});
$("cancelVoiceRecordBtn").addEventListener("click", cancelVoiceRecording);
$("closeVoicePreviewBtn").addEventListener("click", cancelVoiceRecording);
$("voicePreviewModal").addEventListener("click", (event) => {
  if (event.target === $("voicePreviewModal")) cancelVoiceRecording();
});
$("videoRecordBtn").addEventListener("click", () => {
  if (!state.activeConversation) return;
  openVideoRecordingPreview().catch((error) => {
    state.videoRecordingCancelled = false;
    state.videoStream?.getTracks().forEach((track) => track.stop());
    state.videoStream = null;
    $("videoRecordPreview").srcObject = null;
    $("videoRecordBtn").classList.remove("recording");
    $("videoRecordBtn").setAttribute("aria-pressed", "false");
    $("videoRecordBtn").setAttribute("aria-label", "Record video");
    $("videoRecordBtn").title = "Record video";
    stopRecordingIndicator();
    $("videoPreviewModal").classList.add("hidden");
    setUploadStatus("");
    alert(error.message);
  });
});
$("startVideoRecordBtn").addEventListener("click", () => {
  startVideoRecording().catch((error) => {
    state.videoAudioStream?.getTracks().forEach((track) => track.stop());
    state.videoAudioStream = null;
    if (state.videoCanvasAnimation) cancelAnimationFrame(state.videoCanvasAnimation);
    state.videoCanvasAnimation = null;
    state.videoCanvasStream?.getTracks().forEach((track) => track.stop());
    state.videoCanvasStream = null;
    state.videoCanvas = null;
    state.videoRecorder = null;
    state.videoChunks = [];
    $("startVideoRecordBtn").disabled = false;
    alert(error.message);
  });
});
$("stopVideoRecordBtn").addEventListener("click", () => {
  if (state.videoRecorder?.state === "recording") state.videoRecorder.stop();
});
$("toggleVideoAudioBtn").addEventListener("click", () => {
  if (state.videoRecorder?.state !== "recording") return;
  try {
    setVideoRecordingAudioPaused(!state.videoAudioPaused);
  } catch (error) {
    $("videoRecordStatus").textContent = error.message;
    $("toggleVideoAudioBtn").disabled = true;
  }
});
$("closeVideoPreviewBtn").addEventListener("click", () => {
  cancelVideoRecording();
});
$("cancelVideoRecordBtn").addEventListener("click", () => {
  cancelVideoRecording();
});
$("videoCameraSelect").addEventListener("change", async () => {
  const selector = $("videoCameraSelect");
  selector.disabled = true;
  try {
    await changeVideoRecordingCamera();
  } catch (error) {
    selector.value = state.videoCameraFacingMode;
    alert(error.message);
  } finally {
    selector.disabled = false;
  }
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
$("toggleCallViewBtn").addEventListener("click", () => {
  state.call.viewMode = state.call.viewMode === "swapped" ? "default" : "swapped";
  updateCallViewMode();
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
  endCall(false, "declined");
});
$("endCallBtn").addEventListener("click", () => endCall(true));
$("messageInput").addEventListener("input", () => {
  if (state.activeConversation && state.socket?.connected) state.socket.emit("typing", { conversationId: state.activeConversation.id, typing: true });
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(event.target));
    await establishSession(await api("/api/login", { method: "POST", body: JSON.stringify(body) }));
  } catch (error) {
    $("authError").textContent = error.message;
  }
});

$("googleOnboardingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const submitButton = $("googleOnboardingSubmit");
  submitButton.disabled = true;
  $("googleOnboardingError").textContent = "";
  try {
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const result = await api("/api/auth/google/complete-profile", {
      method: "POST",
      body: JSON.stringify({ ...body, setupToken: state.googleSetupToken })
    });
    state.googleSetupToken = "";
    $("googleOnboardingOverlay").classList.add("hidden");
    await establishSession(result);
  } catch (error) {
    $("googleOnboardingError").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

$("googleOnboardingOverlay").addEventListener("click", (event) => {
  if (event.target === $("googleOnboardingOverlay")) event.preventDefault();
});
document.addEventListener("keydown", (event) => {
  if (!$("googleOnboardingOverlay").classList.contains("hidden") && event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const body = {
    displayName: form.get("displayName"),
    userId: form.get("userId"),
    mobile: form.get("mobile"),
    statusText: form.get("statusText"),
    oldPassword: form.get("oldPassword"),
    newPassword: form.get("newPassword"),
    notificationEnabled: $("notificationToggle")?.checked === true,
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
    if (
      !state.emailVerificationToken
      || !Number.isFinite(state.emailVerificationExpiresAt)
      || state.emailVerificationExpiresAt <= Date.now()
    ) {
      state.emailVerificationToken = "";
      state.emailVerificationExpiresAt = 0;
      throw new Error("Verify your Google email using the button above before saving changes.");
    }
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
          ...(state.privacyToken ? { "X-Privacy-Token": state.privacyToken } : {}),
          ...(state.emailVerificationToken ? { "X-Email-Verification": state.emailVerificationToken } : {})
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
    state.emailVerificationToken = "";
    state.emailVerificationExpiresAt = 0;
    state.googleFlow = null;
    $("profileEmailVerificationStatus").textContent = "Changes saved. Verify again before your next account update.";
  } catch (error) {
    $("profileMessage").textContent = error.message;
    $("profileMessage").classList.remove("success-text");
  }
});

$("conversationList").addEventListener("click", async (event) => {
  if (consumeSuppressedConversationClick(event)) return;
  const starred = event.target.closest("[data-starred-message]");
  if (starred) {
    await openConversationById(starred.dataset.conversation, starred.dataset.starredMessage);
    return;
  }
  const statusButton = event.target.closest("[data-status]");
  if (statusButton) {
    const status = state.statuses.find((item) => item.id === statusButton.dataset.status);
    if (!status) return;
    await openStatusSequence(status);
    return;
  }
  const button = event.target.closest("[data-id]");
  if (!button) return;
  await openConversationById(button.dataset.id);
});

$("sectionPanelAction").addEventListener("click", () => {
  $("createGroupMessage").textContent = "";
  $("createGroupModal").classList.remove("hidden");
  $("createGroupName").focus();
});
$("sectionPanelContent").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "add-status") {
    $("statusComposer").dataset.open = "true";
    $("statusComposer").classList.remove("hidden");
    $("statusTextInput").focus();
    return;
  }
  if (action?.dataset.action === "create-group") {
    $("createGroupMessage").textContent = "";
    $("createGroupModal").classList.remove("hidden");
    $("createGroupName").focus();
    return;
  }
  const statusButton = event.target.closest("[data-section-status]");
  if (statusButton) {
    const status = state.statuses.find((item) => item.id === statusButton.dataset.sectionStatus);
    if (!status) return;
    await openStatusSequence(status);
    return;
  }
  const community = event.target.closest("[data-community-conversation]");
  if (community) {
    await openConversationById(community.dataset.communityConversation);
    $("chatView").classList.add("conversation-open");
    return;
  }
  const callAgain = event.target.closest("[data-call-again]");
  if (callAgain) {
    const conversationId = callAgain.dataset.callAgain;
    const type = callAgain.dataset.callType === "video" ? "video" : "voice";
    await openConversationById(conversationId);
    await startCall(type);
    return;
  }
  const callHistory = event.target.closest("[data-call-conversation]");
  if (callHistory) {
    await openConversationById(callHistory.dataset.callConversation);
  }
});

function renderCreateGroupMembers() {
  $("createGroupSelectedMembers").innerHTML = state.createGroupMembers.map((user) => `
    <button class="selected-group-member" type="button" data-remove-create-member="${user.id}">
      <span class="avatar">${avatarMarkup(user, "U")}</span>
      <span>${escapeHtml(contactDisplayName(user))}</span>
      <span aria-hidden="true">×</span>
    </button>`).join("");
}

$("createGroupMemberSearch").addEventListener("input", () => {
  clearTimeout(state.createGroupSearchTimer);
  state.createGroupSearchTimer = setTimeout(async () => {
    const query = $("createGroupMemberSearch").value.trim();
    if (query.length < 2) {
      $("createGroupSearchResults").innerHTML = "";
      return;
    }
    try {
      const { users } = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
      state.createGroupSearchResults = users
        .filter((user) => user.id !== state.user.id && !state.createGroupMembers.some((member) => member.id === user.id));
      $("createGroupSearchResults").innerHTML = state.createGroupSearchResults.map((user) => `<button class="create-group-result" type="button" data-add-create-member="${user.id}">
          <span class="avatar">${avatarMarkup(user, "U")}</span>
          <span><strong>${escapeHtml(user.displayName || user.userId)}</strong><small>@${escapeHtml(user.userId)}</small></span>
          <span>+</span>
        </button>`).join("") || `<p class="section-empty">No new people found.</p>`;
    } catch (error) {
      $("createGroupMessage").textContent = error.message;
    }
  }, 220);
});
$("createGroupSearchResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-create-member]");
  if (!button) return;
  const user = state.createGroupSearchResults?.find((item) => item.id === button.dataset.addCreateMember);
  if (!user) return;
  state.createGroupMembers.push(user);
  $("createGroupSearchResults").innerHTML = "";
  $("createGroupMemberSearch").value = "";
  renderCreateGroupMembers();
  state.createGroupSearchResults = [];
});
$("createGroupSelectedMembers").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-create-member]");
  if (!button) return;
  state.createGroupMembers = state.createGroupMembers.filter((user) => user.id !== button.dataset.removeCreateMember);
  renderCreateGroupMembers();
});
$("closeCreateGroupBtn").addEventListener("click", () => $("createGroupModal").classList.add("hidden"));
$("createGroupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (!state.createGroupMembers.length) {
    $("createGroupMessage").textContent = "Add at least one person to create a group.";
    return;
  }
  button.disabled = true;
  try {
    const { conversation } = await api("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: $("createGroupName").value,
        description: $("createGroupDescription").value,
        memberIds: state.createGroupMembers.map((user) => user.id)
      })
    });
    state.createGroupMembers = [];
    event.currentTarget.reset();
    renderCreateGroupMembers();
    $("createGroupSearchResults").innerHTML = "";
    $("createGroupModal").classList.add("hidden");
    await setMainTab("chats");
    await openConversationById(conversation.id);
  } catch (error) {
    $("createGroupMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("searchResults").addEventListener("click", async (event) => {
  if (consumeSuppressedConversationClick(event)) return;
  const hiddenUserButton = event.target.closest("[data-hidden-user]");
  if (hiddenUserButton) {
    try {
      await openHiddenSearchResult(hiddenUserButton.dataset.hiddenUser);
    } catch (error) {
      await showAppMessage("Could not open hidden chat", error.message);
    }
    return;
  }
  if (event.target.closest("[data-recover-hidden-secret]")) {
    try {
      await recoverHiddenChatSecret();
    } catch (error) {
      await showAppMessage("Recovery failed", error.message);
    }
    return;
  }
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
    const conversation = state.hiddenConversations.find((item) => item.id === hiddenButton.dataset.hiddenConversation);
    if (conversation) {
      await openConversationById(conversation.id, null, conversation);
      clearSidebarSearch();
    }
    return;
  }
  const searchConversationButton = event.target.closest("[data-search-conversation]");
  if (searchConversationButton) {
    const conversationId = searchConversationButton.dataset.searchConversation;
    const conversation = state.searchConversationMap.get(conversationId);
    const messageId = searchConversationButton.dataset.searchMessage || null;
    if (conversation) await openConversationById(conversationId, messageId, conversation);
    clearSidebarSearch();
    return;
  }
  const button = event.target.closest("[data-user]");
  if (!button) return;
  try {
    await startConversationWithUser(button.dataset.user);
    clearSidebarSearch();
  } catch (error) {
    await showAppMessage("Could not start chat", error.message);
  }
});

$("newChatFab").addEventListener("click", () => openNewChatModal());
$("closeNewChatBtn").addEventListener("click", () => $("newChatModal").classList.add("hidden"));
$("newChatModal").addEventListener("click", (event) => {
  if (event.target === $("newChatModal")) $("newChatModal").classList.add("hidden");
});
$("newChatSearchInput").addEventListener("input", () => searchNewChatContacts());
$("deviceContactsBtn").addEventListener("click", () => matchDeviceContacts());
$("newChatContacts").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-new-chat-user]");
  if (!button) return;
  button.disabled = true;
  try {
    await startConversationWithUser(button.dataset.newChatUser);
  } catch (error) {
    $("newChatMessage").textContent = error.message;
    button.disabled = false;
  }
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
    const emoji = await showAppInputDialog({
      title: "Add a reaction",
      message: "Enter an emoji to add it to your reaction options.",
      label: "Emoji",
      inputType: "text",
      submitLabel: "Add"
    });
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
    if (!await showAppConfirm("Delete this message for everyone?", "Delete message")) return;
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
  if (!state.activeConversation?.groupId || !await showAppConfirm("Leave this group?", "Leave group")) return;
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
enhanceNativeSelects();
bootstrap();
