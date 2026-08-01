const params = new URLSearchParams(window.location.search);
const SESSION_ID = params.get("session");
const POLL_MS = 3000;

const joinScreen = document.getElementById("joinScreen");
const roomScreen = document.getElementById("roomScreen");

if (!SESSION_ID) {
  document.body.innerHTML = "<p style='padding:40px;text-align:center;'>Missing chat link. Ask for a fresh link.</p>";
  throw new Error("no session id");
}

const tokenKey = "chat_token_" + SESSION_ID;
const usernameKey = "chat_username_" + SESSION_ID;
const cacheKey = "chat_cache_" + SESSION_ID;

let myToken = localStorage.getItem(tokenKey);
let myUsername = localStorage.getItem(usernameKey);
let pollTimer = null;
let lastSeenTime = null;

// ---------- LOCAL CACHE (messages shown are kept for 24h then dropped) ----------
function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey) || "[]");
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return raw.filter(m => new Date(m.timestamp).getTime() > cutoff);
  } catch (e) {
    return [];
  }
}

function saveCache(messages) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const trimmed = messages.filter(m => new Date(m.timestamp).getTime() > cutoff);
  localStorage.setItem(cacheKey, JSON.stringify(trimmed));
}

let cachedMessages = loadCache();

// ---------- BOOT ----------
(async function init() {
  const info = await VaultAPI.getChatInfo(SESSION_ID);
  if (!info.ok) {
    document.getElementById("joinChatName").textContent = "💬 Unavailable";
    document.getElementById("joinSubtitle").textContent = info.error || "This chat link no longer works.";
    document.getElementById("joinForm").style.display = "none";
    return;
  }
  document.getElementById("joinChatName").textContent = "💬 " + info.name;
  document.title = info.name + " — Chat";

  if (myToken && myUsername) {
    // Already joined on this device — verify the token is still valid.
    const state = await VaultAPI.getChatState(SESSION_ID, myToken, null);
    if (state.ok) {
      enterRoom(info.name);
      return;
    }
    // token invalid/kicked — clear it and fall through to join screen
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(usernameKey);
    myToken = null;
  }
})();

// ---------- JOIN ----------
document.getElementById("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("joinUsername").value.trim();
  const passcode = document.getElementById("joinPasscode").value.trim();
  const errorEl = document.getElementById("joinError");
  errorEl.textContent = "";

  const res = await VaultAPI.joinChat(SESSION_ID, passcode, username);
  if (!res.ok) {
    errorEl.textContent = res.error || "Could not join";
    return;
  }
  myToken = res.token;
  myUsername = res.username;
  localStorage.setItem(tokenKey, myToken);
  localStorage.setItem(usernameKey, myUsername);
  enterRoom(res.sessionName);
});

// ---------- ROOM ----------
function enterRoom(chatName) {
  joinScreen.style.display = "none";
  roomScreen.style.display = "flex";
  document.getElementById("roomChatName").textContent = chatName;
  document.getElementById("roomWhoAmI").textContent = "You are " + myUsername;

  renderMessages(cachedMessages);
  if (cachedMessages.length) {
    lastSeenTime = cachedMessages[cachedMessages.length - 1].timestamp;
  }

  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

async function poll() {
  const state = await VaultAPI.getChatState(SESSION_ID, myToken, lastSeenTime);
  if (!state.ok) {
    clearInterval(pollTimer);
    if (state.kicked) {
      alert("You were removed from this chat by the admin.");
    } else if (state.ended) {
      alert("This chat has ended.");
    }
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(usernameKey);
    window.location.reload();
    return;
  }
  if (state.messages.length) {
    cachedMessages = cachedMessages.concat(state.messages);
    saveCache(cachedMessages);
    lastSeenTime = state.messages[state.messages.length - 1].timestamp;
    appendMessages(state.messages);
  }
}

function renderMessages(messages) {
  const el = document.getElementById("chatMessages");
  el.innerHTML = "";
  appendMessages(messages);
}

function appendMessages(messages) {
  const el = document.getElementById("chatMessages");
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  messages.forEach(m => el.appendChild(renderMessage(m)));
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function renderMessage(m) {
  const wrap = document.createElement("div");
  wrap.className = "chat-msg" + (m.from === myUsername ? " own" : "");
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let bodyHtml;
  if (m.type === "text") {
    bodyHtml = escapeHtml(m.text);
  } else if (m.type === "image" && m.thumbnail) {
    bodyHtml = `<img src="data:image/jpeg;base64,${m.thumbnail}" data-msgid="${m.id}" class="chat-lazy-media">`;
  } else {
    const label = m.type === "video" ? "🎬 Video — tap to play" : m.type === "voice" ? "🎙️ Voice message — tap to play" : "📎 " + escapeHtml(m.fileName || "file");
    bodyHtml = `<div class="chat-file-pending" data-msgid="${m.id}" data-type="${m.type}">${label}</div>`;
  }

  wrap.innerHTML = `
    <div class="chat-msg-author">${escapeHtml(m.from)}</div>
    <div class="chat-msg-bubble">${bodyHtml}</div>
    <div class="chat-msg-time">${time}</div>
  `;

  const lazyEl = wrap.querySelector("[data-msgid]");
  if (lazyEl) lazyEl.addEventListener("click", () => loadChatFile(m, lazyEl));
  return wrap;
}

async function loadChatFile(m, el) {
  if (el.dataset.loaded) return;
  el.textContent = "Loading...";
  const res = await VaultAPI.getChatFile(SESSION_ID, myToken, m.id);
  if (!res.ok) { el.textContent = "Could not load file"; return; }
  const src = `data:${res.file.mimeType};base64,${res.file.base64}`;
  el.dataset.loaded = "1";
  if (m.type === "video") {
    el.outerHTML = `<video src="${src}" controls></video>`;
  } else if (m.type === "voice") {
    el.outerHTML = `<audio src="${src}" controls></audio>`;
  } else if (m.type === "image") {
    el.outerHTML = `<img src="${src}">`;
  }
}

// ---------- SEND: text ----------
document.getElementById("sendChatBtn").addEventListener("click", sendText);
document.getElementById("chatTextInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

async function sendText() {
  const input = document.getElementById("chatTextInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const res = await VaultAPI.sendChatMessage(SESSION_ID, myToken, { type: "text", text });
  if (res.ok) {
    cachedMessages.push(res.message);
    saveCache(cachedMessages);
    lastSeenTime = res.message.timestamp;
    appendMessages([res.message]);
  }
}

// ---------- SEND: photo/video ----------
document.getElementById("chatFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const type = file.type.startsWith("video") ? "video" : "image";
  const base64 = await fileToBase64(file);
  const thumbnail = type === "image" ? await makeSimpleThumbnail(file).catch(() => null) : null;

  const res = await VaultAPI.sendChatMessage(SESSION_ID, myToken, {
    type, base64, mimeType: file.type, fileName: file.name, thumbnail
  });
  if (res.ok) {
    cachedMessages.push(res.message);
    saveCache(cachedMessages);
    lastSeenTime = res.message.timestamp;
    appendMessages([res.message]);
  }
  e.target.value = "";
});

// ---------- SEND: voice ----------
let mediaRecorder = null;
let recordedChunks = [];

document.getElementById("recordVoiceBtn").addEventListener("click", async () => {
  const btn = document.getElementById("recordVoiceBtn");
  const row = document.getElementById("chatInputRow");

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      row.classList.remove("recording");
      btn.textContent = "🎤";
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      const base64 = await blobToBase64(blob);
      const res = await VaultAPI.sendChatMessage(SESSION_ID, myToken, {
        type: "voice", base64, mimeType: "audio/webm", fileName: "voice.webm"
      });
      if (res.ok) {
        cachedMessages.push(res.message);
        saveCache(cachedMessages);
        lastSeenTime = res.message.timestamp;
        appendMessages([res.message]);
      }
    };
    mediaRecorder.start();
    row.classList.add("recording");
    btn.textContent = "⏹";
  } catch (err) {
    alert("Microphone access is needed to record a voice message.");
  }
});

// ---------- LEAVE ----------
document.getElementById("leaveChatBtn").addEventListener("click", async () => {
  if (!confirm("Leave this chat? You'll need a fresh passcode to rejoin.")) return;
  clearInterval(pollTimer);
  await VaultAPI.leaveChat(SESSION_ID, myToken);
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(usernameKey);
  localStorage.removeItem(cacheKey);
  window.location.reload();
});

// ---------- UTIL ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function makeSimpleThumbnail(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 320;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7).split(",")[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
