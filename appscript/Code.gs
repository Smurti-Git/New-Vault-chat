/**
 * PERSONAL VAULT - Apps Script Backend
 * ------------------------------------
 * One file. Handles:
 *  - login (password check + session token)
 *  - notes CRUD (stored as one JSON index file in Drive)
 *  - media upload/list/delete (photos + videos stored as real files in Drive,
 *    indexed in a JSON file)
 *
 * SETUP (also see README):
 *  1. Run `setPassword()` once from the Apps Script editor (Run button) after
 *     changing YOUR_NEW_PASSWORD below, then delete/blank that line out.
 *  2. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 *  3. Copy the Web App URL into js/api.js on the frontend.
 */

const ROOT_FOLDER_NAME = "PersonalVault";
const NOTES_FILE_NAME = "notes_index.json";
const MEDIA_FILE_NAME = "media_index.json";
const SESSION_HOURS = 12;

// ---------- ONE-TIME SETUP ----------
// Edit the password below, run this function ONCE from the editor (select
// setPassword in the dropdown, click Run), then you can clear the string.
function setPassword() {
  const password = "YOUR_NEW_PASSWORD"; // <-- change this, run once, then remove
  const props = PropertiesService.getScriptProperties();
  props.setProperty("PASSWORD_HASH", hashString(password));
  Logger.log("Password set.");
}

// ---------- ENTRY POINTS ----------
function doGet(e) {
  return jsonOutput({ ok: true, message: "Vault API is running" });
}

// Actions guests can call WITHOUT your vault password — chat participants
// authenticate with a per-session participant token instead (see chat
// functions below). Everything else requires your vault login token.
const PUBLIC_ACTIONS = [
  "login",
  "getChatInfo",
  "joinChat",
  "getChatState",
  "sendChatMessage",
  "getChatFile",
  "leaveChat"
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;

    if (PUBLIC_ACTIONS.indexOf(action) === -1) {
      const valid = checkToken(body.token);
      if (!valid) return jsonOutput({ ok: false, error: "Invalid or expired session" });
    }

    switch (action) {
      case "login":
        return jsonOutput(handleLogin(body.password));
      case "getNotes":
        return jsonOutput({ ok: true, notes: getNotesIndex() });
      case "saveNote":
        return jsonOutput({ ok: true, note: saveNote(body.note) });
      case "deleteNote":
        return jsonOutput({ ok: true, deleted: deleteNote(body.id) });
      case "getMedia":
        return jsonOutput({ ok: true, media: getMediaIndex() });
      case "uploadMedia":
        return jsonOutput({ ok: true, item: uploadMedia(body.file) });
      case "deleteMedia":
        return jsonOutput({ ok: true, deleted: deleteMedia(body.id) });
      case "getMediaFile":
        return jsonOutput({ ok: true, file: getMediaFile(body.id) });

      // ---- Chat (admin actions, require vault token) ----
      case "createChatSession":
        return jsonOutput({ ok: true, session: createChatSession(body.name) });
      case "listChatSessions":
        return jsonOutput({ ok: true, sessions: listChatSessions() });
      case "endChatSession":
        return jsonOutput({ ok: true, ended: endChatSession(body.id) });
      case "kickChatUser":
        return jsonOutput({ ok: true, kicked: kickChatUser(body.id, body.username) });

      // ---- Chat (public / guest actions, use participant token) ----
      case "getChatInfo":
        return jsonOutput(getChatInfo(body.id));
      case "joinChat":
        return jsonOutput(joinChat(body.id, body.passcode, body.username));
      case "getChatState":
        return jsonOutput(getChatState(body.id, body.token, body.since));
      case "sendChatMessage":
        return jsonOutput(sendChatMessage(body.id, body.token, body.message));
      case "getChatFile":
        return jsonOutput(getChatFile(body.id, body.token, body.messageId));
      case "leaveChat":
        return jsonOutput(leaveChat(body.id, body.token));

      default:
        return jsonOutput({ ok: false, error: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}

// ---------- AUTH ----------
function handleLogin(password) {
  const props = PropertiesService.getScriptProperties();
  const storedHash = props.getProperty("PASSWORD_HASH");
  if (!storedHash) return { ok: false, error: "No password set on server yet." };
  if (hashString(password) !== storedHash) return { ok: false, error: "Wrong password" };

  const token = Utilities.getUuid();
  const expires = new Date().getTime() + SESSION_HOURS * 60 * 60 * 1000;
  props.setProperty("TOKEN_" + token, String(expires));
  return { ok: true, token: token };
}

function checkToken(token) {
  if (!token) return false;
  const props = PropertiesService.getScriptProperties();
  const expires = props.getProperty("TOKEN_" + token);
  if (!expires) return false;
  if (new Date().getTime() > Number(expires)) {
    props.deleteProperty("TOKEN_" + token);
    return false;
  }
  return true;
}

function hashString(str) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

// ---------- DRIVE HELPERS ----------
function getRootFolder() {
  const folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function getSubFolder(name) {
  const root = getRootFolder();
  const folders = root.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return root.createFolder(name);
}

function readJsonFile(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) return [];
  const content = files.next().getBlob().getDataAsString();
  try {
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

function writeJsonFile(folder, fileName, data) {
  const files = folder.getFilesByName(fileName);
  const json = JSON.stringify(data, null, 2);
  if (files.hasNext()) {
    files.next().setContent(json);
  } else {
    folder.createFile(fileName, json, MimeType.PLAIN_TEXT);
  }
}

// ---------- NOTES ----------
function getNotesIndex() {
  const root = getRootFolder();
  return readJsonFile(root, NOTES_FILE_NAME);
}

function saveNote(note) {
  const root = getRootFolder();
  const notes = readJsonFile(root, NOTES_FILE_NAME);
  const now = new Date().toISOString();

  if (note.id) {
    const idx = notes.findIndex(n => n.id === note.id);
    if (idx > -1) {
      notes[idx] = Object.assign({}, notes[idx], note, { updated: now });
    } else {
      notes.push(Object.assign({}, note, { updated: now, created: now }));
    }
  } else {
    note.id = "note-" + Utilities.getUuid();
    note.created = now;
    note.updated = now;
    notes.push(note);
  }

  writeJsonFile(root, NOTES_FILE_NAME, notes);
  return note;
}

function deleteNote(id) {
  const root = getRootFolder();
  let notes = readJsonFile(root, NOTES_FILE_NAME);
  const before = notes.length;
  notes = notes.filter(n => n.id !== id);
  writeJsonFile(root, NOTES_FILE_NAME, notes);
  return notes.length < before;
}

// ---------- MEDIA (photos/videos) ----------
function getMediaIndex() {
  const root = getRootFolder();
  return readJsonFile(root, MEDIA_FILE_NAME);
}

// file = { name, mimeType, base64, type: "image"|"video", thumbnail? }
// `thumbnail` is a small base64 JPEG (generated client-side) so the grid
// can render real previews instantly without fetching the full file.
function uploadMedia(file) {
  const folderName = file.type === "video" ? "Videos" : "Images";
  const folder = getSubFolder(folderName);

  const bytes = Utilities.base64Decode(file.base64);
  const blob = Utilities.newBlob(bytes, file.mimeType, file.name);
  const driveFile = folder.createFile(blob);
  // Keep files private to the owner; do NOT setSharing to anyone.

  const root = getRootFolder();
  const media = readJsonFile(root, MEDIA_FILE_NAME);
  const item = {
    id: "media-" + Utilities.getUuid(),
    driveId: driveFile.getId(),
    name: file.name,
    type: file.type,
    mimeType: file.mimeType,
    thumbnail: file.thumbnail || null, // small base64 jpeg, stored inline
    uploaded: new Date().toISOString()
  };
  media.push(item);
  writeJsonFile(root, MEDIA_FILE_NAME, media);
  return item;
}

function deleteMedia(id) {
  const root = getRootFolder();
  let media = readJsonFile(root, MEDIA_FILE_NAME);
  const item = media.find(m => m.id === id);
  if (item) {
    try {
      DriveApp.getFileById(item.driveId).setTrashed(true);
    } catch (e) {
      // file already gone; ignore
    }
  }
  const before = media.length;
  media = media.filter(m => m.id !== id);
  writeJsonFile(root, MEDIA_FILE_NAME, media);
  return media.length < before;
}

// Returns { name, mimeType, base64 } for a media item so the frontend can
// render <img>/<video> previews. Fine for personal-scale files; if you
// start storing very large videos, consider streaming via a public
// (unlisted) share link instead.
function getMediaFile(id) {
  const root = getRootFolder();
  const media = readJsonFile(root, MEDIA_FILE_NAME);
  const item = media.find(m => m.id === id);
  if (!item) throw new Error("Media not found");
  const driveFile = DriveApp.getFileById(item.driveId);
  const blob = driveFile.getBlob();
  return {
    name: item.name,
    mimeType: item.mimeType,
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

// =====================================================================
// CHAT
// =====================================================================
// Passcode is NOT stored — it's derived from a per-session secret + the
// current minute, so anyone with the secret (i.e. this script) can
// compute "the current passcode" on demand, and it automatically
// rotates every 60s with zero cron jobs.
//
// Already-joined participants keep a long-lived participant token
// (separate from your vault password) so they don't need the passcode
// again. New joiners need whatever passcode is live right now.
//
// Messages + media auto-expire after 24h (purged on every read/write).

const CHAT_FOLDER_NAME = "Chats";
const CHAT_INDEX_FILE = "chats_index.json";
const CHAT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const CHAT_PASSCODE_GRACE_MINUTES = 1; // accept current + previous minute's code

function getChatFolder() {
  return getSubFolder(CHAT_FOLDER_NAME);
}

function getChatIndex() {
  return readJsonFile(getChatFolder(), CHAT_INDEX_FILE);
}

function writeChatIndex(list) {
  writeJsonFile(getChatFolder(), CHAT_INDEX_FILE, list);
}

function sessionFileName(id) {
  return "session_" + id + ".json";
}

function readSession(id) {
  const folder = getChatFolder();
  const data = readJsonFile(folder, sessionFileName(id));
  return Array.isArray(data) ? null : data; // sessions are objects, not arrays
}

function writeSession(session) {
  writeJsonFile(getChatFolder(), sessionFileName(session.id), session);
}

function computePasscode(secret, minuteEpoch) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, secret + "_" + minuteEpoch);
  const hex = digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
  const num = parseInt(hex.substring(0, 8), 16) % 1000000;
  return String(num).padStart(6, "0");
}

function currentPasscodeFor(secret) {
  const minuteEpoch = Math.floor(new Date().getTime() / 60000);
  return computePasscode(secret, minuteEpoch);
}

function isValidPasscode(secret, passcode) {
  const minuteEpoch = Math.floor(new Date().getTime() / 60000);
  for (let i = 0; i <= CHAT_PASSCODE_GRACE_MINUTES; i++) {
    if (computePasscode(secret, minuteEpoch - i) === String(passcode)) return true;
  }
  return false;
}

// ---- Admin actions (require vault token) ----

function createChatSession(name) {
  const id = "chat-" + Utilities.getUuid().slice(0, 8);
  const secret = Utilities.getUuid();
  const session = {
    id: id,
    name: name || "Untitled chat",
    secret: secret,
    created: new Date().toISOString(),
    ended: false,
    participants: [], // { username, token, joinedAt }
    messages: []       // { id, from, type, text?, fileId?, mimeType?, fileName?, thumbnail?, timestamp }
  };
  writeSession(session);

  const index = getChatIndex();
  index.push({ id: id, name: session.name, created: session.created, ended: false });
  writeChatIndex(index);

  return { id: id, name: session.name, passcode: currentPasscodeFor(secret) };
}

function listChatSessions() {
  const index = getChatIndex();
  return index.map(entry => {
    const session = readSession(entry.id);
    if (!session) return null;
    purgeExpiredMessages(session); // keep counts accurate
    return {
      id: session.id,
      name: session.name,
      ended: session.ended,
      created: session.created,
      passcode: session.ended ? null : currentPasscodeFor(session.secret),
      participants: session.participants.map(p => ({ username: p.username, joinedAt: p.joinedAt })),
      messageCount: session.messages.length
    };
  }).filter(Boolean);
}

function endChatSession(id) {
  const session = readSession(id);
  if (!session) return false;
  session.ended = true;
  writeSession(session);
  const index = getChatIndex().map(e => (e.id === id ? Object.assign({}, e, { ended: true }) : e));
  writeChatIndex(index);
  return true;
}

function kickChatUser(id, username) {
  const session = readSession(id);
  if (!session) return false;
  const before = session.participants.length;
  session.participants = session.participants.filter(p => p.username !== username);
  writeSession(session);
  return session.participants.length < before;
}

// ---- Guest actions (public, participant-token based) ----

// Lets the join screen show the chat's name before the passcode is entered.
function getChatInfo(id) {
  const session = readSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  if (session.ended) return { ok: false, error: "This chat has ended" };
  return { ok: true, name: session.name };
}

function joinChat(id, passcode, username) {
  const session = readSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  if (session.ended) return { ok: false, error: "This chat has ended" };
  if (!username || !username.trim()) return { ok: false, error: "Username required" };
  username = username.trim().slice(0, 30);

  if (!isValidPasscode(session.secret, passcode)) {
    return { ok: false, error: "Wrong or expired passcode" };
  }
  if (session.participants.some(p => p.username === username)) {
    return { ok: false, error: "That username is already taken in this chat" };
  }

  const token = Utilities.getUuid();
  session.participants.push({ username: username, token: token, joinedAt: new Date().toISOString() });
  writeSession(session);

  return { ok: true, token: token, username: username, sessionName: session.name };
}

function findParticipant(session, token) {
  return session.participants.find(p => p.token === token);
}

function getChatState(id, token, since) {
  const session = readSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  const me = findParticipant(session, token);
  if (!me) return { ok: false, kicked: true, error: "You are no longer in this chat" };
  if (session.ended) return { ok: false, ended: true, error: "This chat has ended" };

  const changed = purgeExpiredMessages(session);
  if (changed) writeSession(session);

  const sinceTime = since ? new Date(since).getTime() : 0;
  const messages = session.messages.filter(m => new Date(m.timestamp).getTime() > sinceTime);

  return {
    ok: true,
    messages: messages,
    participants: session.participants.map(p => ({ username: p.username, joinedAt: p.joinedAt })),
    serverTime: new Date().toISOString()
  };
}

// message = { type: "text"|"image"|"video"|"voice", text?, base64?, mimeType?, fileName?, thumbnail? }
function sendChatMessage(id, token, message) {
  const session = readSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  const me = findParticipant(session, token);
  if (!me) return { ok: false, kicked: true, error: "You are no longer in this chat" };
  if (session.ended) return { ok: false, ended: true, error: "This chat has ended" };

  purgeExpiredMessages(session);

  const entry = {
    id: "msg-" + Utilities.getUuid(),
    from: me.username,
    type: message.type,
    timestamp: new Date().toISOString()
  };

  if (message.type === "text") {
    entry.text = String(message.text || "").slice(0, 4000);
  } else {
    // image / video / voice: store the actual bytes as a Drive file,
    // keep only a reference (+ small thumbnail for images) in the JSON.
    const folder = getSubFolder(CHAT_FOLDER_NAME + "/" + id);
    const bytes = Utilities.base64Decode(message.base64);
    const blob = Utilities.newBlob(bytes, message.mimeType, message.fileName || entry.id);
    const driveFile = folder.createFile(blob);
    entry.fileId = driveFile.getId();
    entry.mimeType = message.mimeType;
    entry.fileName = message.fileName || "";
    entry.thumbnail = message.thumbnail || null;
  }

  session.messages.push(entry);
  writeSession(session);
  return { ok: true, message: entry };
}

function getChatFile(id, token, messageId) {
  const session = readSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  const me = findParticipant(session, token);
  if (!me) return { ok: false, kicked: true, error: "You are no longer in this chat" };

  const msg = session.messages.find(m => m.id === messageId);
  if (!msg || !msg.fileId) return { ok: false, error: "File not found" };

  const driveFile = DriveApp.getFileById(msg.fileId);
  const blob = driveFile.getBlob();
  return {
    ok: true,
    file: {
      mimeType: msg.mimeType,
      fileName: msg.fileName,
      base64: Utilities.base64Encode(blob.getBytes())
    }
  };
}

function leaveChat(id, token) {
  const session = readSession(id);
  if (!session) return { ok: false, error: "Chat not found" };
  session.participants = session.participants.filter(p => p.token !== token);
  writeSession(session);
  return { ok: true };
}

// Removes messages (and their Drive files) older than 24h. Returns true
// if anything changed, so callers know whether to persist.
function purgeExpiredMessages(session) {
  const now = new Date().getTime();
  const keep = [];
  let changed = false;
  session.messages.forEach(m => {
    if (now - new Date(m.timestamp).getTime() > CHAT_MESSAGE_TTL_MS) {
      changed = true;
      if (m.fileId) {
        try { DriveApp.getFileById(m.fileId).setTrashed(true); } catch (e) { /* already gone */ }
      }
    } else {
      keep.push(m);
    }
  });
  session.messages = keep;
  return changed;
}

function doOptions(e) {
  return ContentService.createTextOutput("");
}

// ---------- OUTPUT ----------
function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
