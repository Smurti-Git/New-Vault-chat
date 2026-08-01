/**
 * Talks to the Google Apps Script backend.
 *
 * IMPORTANT: after you deploy Code.gs as a Web App (see README), paste the
 * deployment URL below. It looks like:
 * https://script.google.com/macros/s/AKfycb.../exec
 */
const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

const VaultAPI = (() => {
  function getToken() {
    return localStorage.getItem("vault_token");
  }

  async function call(action, payload = {}) {
    const body = Object.assign({ action, token: getToken() }, payload);
    const res = await fetch(API_URL, {
      method: "POST",
      // text/plain avoids a CORS preflight against Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok === false && data.error === "Invalid or expired session") {
      localStorage.removeItem("vault_token");
      window.location.href = "index.html";
    }
    return data;
  }

  return {
    login: (password) => call("login", { password }),
    getNotes: () => call("getNotes"),
    saveNote: (note) => call("saveNote", { note }),
    deleteNote: (id) => call("deleteNote", { id }),
    getMedia: () => call("getMedia"),
    getMediaFile: (id) => call("getMediaFile", { id }),
    uploadMedia: (file) => call("uploadMedia", { file }),
    deleteMedia: (id) => call("deleteMedia", { id }),

    // ---- Chat: admin (uses your vault token automatically) ----
    createChatSession: (name) => call("createChatSession", { name }),
    listChatSessions: () => call("listChatSessions"),
    endChatSession: (id) => call("endChatSession", { id }),
    kickChatUser: (id, username) => call("kickChatUser", { id, username }),

    // ---- Chat: guest (uses a participant token, not your vault token) ----
    getChatInfo: (id) => call("getChatInfo", { id }),
    joinChat: (id, passcode, username) => call("joinChat", { id, passcode, username }),
    getChatState: (id, participantToken, since) =>
      callWithToken("getChatState", participantToken, { id, since }),
    sendChatMessage: (id, participantToken, message) =>
      callWithToken("sendChatMessage", participantToken, { id, message }),
    getChatFile: (id, participantToken, messageId) =>
      callWithToken("getChatFile", participantToken, { id, messageId }),
    leaveChat: (id, participantToken) =>
      callWithToken("leaveChat", participantToken, { id })
  };

  // Guest chat calls authenticate with their own participant token, which
  // is NOT the same as (and should not be overwritten by) your vault
  // login token — so these bypass the normal call() token injection.
  async function callWithToken(action, token, payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action, token }, payload))
    });
    return res.json();
  }
})();
