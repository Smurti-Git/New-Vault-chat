// Guard: bounce to login if no token
if (!localStorage.getItem("vault_token")) {
  window.location.href = "index.html";
}

// ---------- THEME ----------
const themeBtn = document.getElementById("toggleTheme");
const savedTheme = localStorage.getItem("vault_theme") || "dark";
if (savedTheme === "light") {
  document.documentElement.setAttribute("data-theme", "light");
  themeBtn.textContent = "☀️";
}
themeBtn.addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  if (isLight) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("vault_theme", "dark");
    themeBtn.textContent = "🌙";
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("vault_theme", "light");
    themeBtn.textContent = "☀️";
  }
});

// ---------- LOGOUT ----------
document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("vault_token");
  window.location.href = "index.html";
});

// ---------- TABS ----------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab + "-tab").classList.add("active");
  });
});

// ---------- NOTES ----------
let allNotes = [];
let activeNoteId = null;

async function loadNotes() {
  const res = await VaultAPI.getNotes();
  if (res.ok) {
    allNotes = res.notes.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    renderNotes(allNotes);
  }
}

function renderNotes(notes) {
  const list = document.getElementById("notesList");
  if (notes.length === 0) {
    list.innerHTML = `<div class="empty-state">No notes yet. Click "+ New note" to add your first one.</div>`;
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-card" data-id="${n.id}">
      <h3>${escapeHtml(n.title || "Untitled")}</h3>
      <p>${escapeHtml((n.content || "").slice(0, 140))}</p>
      <div class="note-meta">${new Date(n.updated).toLocaleDateString()}</div>
    </div>
  `).join("");

  list.querySelectorAll(".note-card").forEach(card => {
    card.addEventListener("click", () => openNoteEditor(card.dataset.id));
  });
}

document.getElementById("noteSearch").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allNotes.filter(n =>
    (n.title || "").toLowerCase().includes(q) ||
    (n.content || "").toLowerCase().includes(q) ||
    (n.tags || []).join(",").toLowerCase().includes(q)
  );
  renderNotes(filtered);
});

const noteModal = document.getElementById("noteModal");
document.getElementById("newNoteBtn").addEventListener("click", () => openNoteEditor(null));
document.getElementById("cancelNoteBtn").addEventListener("click", () => noteModal.classList.add("hidden"));

function openNoteEditor(id) {
  activeNoteId = id;
  const note = id ? allNotes.find(n => n.id === id) : null;
  document.getElementById("noteTitle").value = note ? note.title : "";
  document.getElementById("noteContent").value = note ? note.content : "";
  document.getElementById("noteTags").value = note ? (note.tags || []).join(", ") : "";
  document.getElementById("deleteNoteBtn").style.display = note ? "inline-block" : "none";
  noteModal.classList.remove("hidden");
}

document.getElementById("saveNoteBtn").addEventListener("click", async () => {
  const note = {
    id: activeNoteId,
    title: document.getElementById("noteTitle").value.trim() || "Untitled",
    content: document.getElementById("noteContent").value,
    tags: document.getElementById("noteTags").value.split(",").map(t => t.trim()).filter(Boolean)
  };
  const btn = document.getElementById("saveNoteBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";
  await VaultAPI.saveNote(note);
  btn.disabled = false;
  btn.textContent = "Save";
  noteModal.classList.add("hidden");
  loadNotes();
});

document.getElementById("deleteNoteBtn").addEventListener("click", async () => {
  if (!activeNoteId) return;
  if (!confirm("Delete this note?")) return;
  await VaultAPI.deleteNote(activeNoteId);
  noteModal.classList.add("hidden");
  loadNotes();
});

// ---------- MEDIA ----------
let allMedia = [];
let activeMediaId = null;

async function loadMedia() {
  const res = await VaultAPI.getMedia();
  if (res.ok) {
    allMedia = res.media.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    renderMedia();
  }
}

function renderMedia() {
  const grid = document.getElementById("mediaGrid");
  if (allMedia.length === 0) {
    grid.innerHTML = `<div class="empty-state">No photos or videos yet.</div>`;
    return;
  }
  grid.innerHTML = allMedia.map(m => `
    <div class="media-thumb-wrap" data-id="${m.id}">
      <div class="media-thumb">
        ${m.thumbnail
          ? `<img src="data:image/jpeg;base64,${m.thumbnail}" alt="${escapeHtml(m.name)}">`
          : `<span class="media-fallback-icon">${m.type === "video" ? "🎬" : "🖼️"}</span>`}
        ${m.type === "video" ? `<span class="media-badge">▶</span>` : ""}
      </div>
      <div class="media-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
    </div>
  `).join("");
  grid.querySelectorAll(".media-thumb-wrap").forEach(el => {
    el.addEventListener("click", () => openMediaPreview(el.dataset.id));
  });
}

document.getElementById("mediaInput").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  const status = document.getElementById("uploadStatus");

  for (const file of files) {
    status.textContent = `Uploading ${file.name}...`;
    const type = file.type.startsWith("video") ? "video" : "image";
    const [base64, thumbnail] = await Promise.all([
      fileToBase64(file),
      makeThumbnail(file, type).catch(() => null)
    ]);
    await VaultAPI.uploadMedia({
      name: file.name,
      mimeType: file.type,
      base64,
      thumbnail,
      type
    });
  }
  status.textContent = "Done.";
  setTimeout(() => (status.textContent = ""), 2000);
  e.target.value = "";
  loadMedia();
});

// Produces a small (max 320px) base64 JPEG (no data: prefix) for instant
// grid previews. Images are resized directly; videos are captured as a
// single frame ~1s in (or the first available frame for short clips).
function makeThumbnail(file, type) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const MAX = 320;

    const finish = (sourceEl, w, h) => {
      const scale = Math.min(1, MAX / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(sourceEl, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7).split(",")[1]);
    };

    if (type === "image") {
      const img = new Image();
      img.onload = () => finish(img, img.naturalWidth, img.naturalHeight);
      img.onerror = reject;
      img.src = url;
    } else {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      video.addEventListener("loadeddata", () => {
        video.currentTime = Math.min(1, (video.duration || 1) / 2);
      });
      video.addEventListener("seeked", () => finish(video, video.videoWidth, video.videoHeight));
      video.addEventListener("error", reject);
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const mediaModal = document.getElementById("mediaModal");
document.getElementById("closeMediaBtn").addEventListener("click", () => mediaModal.classList.add("hidden"));

async function openMediaPreview(id) {
  activeMediaId = id;
  const item = allMedia.find(m => m.id === id);
  const content = document.getElementById("mediaPreviewContent");
  content.innerHTML = `<p style="color:var(--text-dim)">Loading ${escapeHtml(item.name)}...</p>`;
  mediaModal.classList.remove("hidden");

  const res = await VaultAPI.getMediaFile(id);
  if (!res.ok) {
    content.innerHTML = `<p style="color:var(--danger)">Could not load file.</p>`;
    return;
  }
  const src = `data:${res.file.mimeType};base64,${res.file.base64}`;
  content.innerHTML = item.type === "video"
    ? `<video src="${src}" controls></video>`
    : `<img src="${src}" alt="${escapeHtml(item.name)}">`;
}

document.getElementById("deleteMediaBtn").addEventListener("click", async () => {
  if (!activeMediaId) return;
  if (!confirm("Delete this file?")) return;
  await VaultAPI.deleteMedia(activeMediaId);
  mediaModal.classList.add("hidden");
  loadMedia();
});

// ---------- UTIL ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- CHAT (admin: create/manage links from the dashboard) ----------
document.getElementById("createChatBtn").addEventListener("click", async () => {
  const input = document.getElementById("chatNameInput");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const btn = document.getElementById("createChatBtn");
  btn.disabled = true;
  await VaultAPI.createChatSession(name);
  btn.disabled = false;
  input.value = "";
  loadChatSessions();
});

async function loadChatSessions() {
  const res = await VaultAPI.listChatSessions();
  if (res.ok) renderChatSessions(res.sessions);
}

function chatLinkFor(id) {
  return window.location.origin + window.location.pathname.replace(/dashboard\.html$/, "") + "chat.html?session=" + id;
}

function renderChatSessions(sessions) {
  const list = document.getElementById("chatSessionsList");
  if (sessions.length === 0) {
    list.innerHTML = `<div class="empty-state">No chat links yet. Create one above.</div>`;
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="chat-session-card ${s.ended ? "ended" : ""}" data-id="${s.id}">
      <div class="chat-session-top">
        <div>
          <h3>${escapeHtml(s.name)}</h3>
          <div class="chat-meta">${s.ended ? "Ended" : `${s.participants.length} in chat`} · created ${new Date(s.created).toLocaleDateString()}</div>
        </div>
        ${s.ended ? "" : `
          <div>
            <div class="chat-passcode">${s.passcode}</div>
            <div class="chat-passcode-label">CURRENT PASSCODE</div>
          </div>
        `}
      </div>
      ${s.ended ? "" : `
        <div class="chat-link-row">
          <input type="text" readonly value="${chatLinkFor(s.id)}">
          <button class="ghost-btn copy-link-btn" data-id="${s.id}">Copy link</button>
        </div>
        <div class="chat-participants">
          ${s.participants.map(p => `
            <div class="chat-participant-chip">
              <span>${escapeHtml(p.username)}</span>
              <button class="kick-btn" data-id="${s.id}" data-username="${escapeHtml(p.username)}" title="Remove">✕</button>
            </div>
          `).join("") || `<span style="color:var(--text-dim);font-size:13px;">Nobody has joined yet</span>`}
        </div>
        <div class="chat-session-actions">
          <button class="danger-btn end-chat-btn" data-id="${s.id}">End chat</button>
        </div>
      `}
    </div>
  `).join("");

  list.querySelectorAll(".copy-link-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(chatLinkFor(btn.dataset.id));
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy link"), 1500);
    });
  });
  list.querySelectorAll(".kick-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Remove ${btn.dataset.username} from this chat?`)) return;
      await VaultAPI.kickChatUser(btn.dataset.id, btn.dataset.username);
      loadChatSessions();
    });
  });
  list.querySelectorAll(".end-chat-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("End this chat? The link will stop working.")) return;
      await VaultAPI.endChatSession(btn.dataset.id);
      loadChatSessions();
    });
  });
}

// Refresh sessions (and the rotating passcode) periodically while the tab
// is open, so the admin always sees a live code without reloading.
setInterval(() => {
  if (document.getElementById("chat-tab").classList.contains("active")) {
    loadChatSessions();
  }
}, 5000);

document.querySelector('.tab-btn[data-tab="chat"]').addEventListener("click", loadChatSessions);

// ---------- INIT ----------
loadNotes();
loadMedia();
