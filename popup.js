import { supabaseClient } from "./supabaseClient.js";

const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const setupSection = document.getElementById("setup-section");
const unlockSection = document.getElementById("unlock-section");

const tabPasswords = document.getElementById("tab-passwords");
const tabShares = document.getElementById("tab-shares");
const passwordList = document.getElementById("password-list");
const shareList = document.getElementById("share-list");

const editSection = document.getElementById("edit-section");
const editIdInput = document.getElementById("edit-id");
const editSiteInput = document.getElementById("edit-site");
const editUsernameInput = document.getElementById("edit-username");
const editPasswordInput = document.getElementById("edit-password");

// Get the 4 input boxes for the PIN
const pinInputs = document.querySelectorAll(".pin-input");

document.addEventListener("DOMContentLoaded", () => {
    checkUser();
    setupPinInputs(); // Initialize the PIN input behavior

    document
        .getElementById("btn-google-login")
        ?.addEventListener("click", handleGoogleLogin);
    document
        .getElementById("btn-logout")
        ?.addEventListener("click", handleLogout);
    document
        .getElementById("btn-setup")
        ?.addEventListener("click", handleSetupVault);
    document
        .getElementById("btn-unlock")
        ?.addEventListener("click", handleUnlockVault);
    document
        .getElementById("btn-lock")
        ?.addEventListener("click", handleLockVault);

    document.getElementById("btn-cancel-edit")?.addEventListener("click", () => showSection("app"));
    document.getElementById("btn-save-edit")?.addEventListener("click", handleSaveEdit);
    document.getElementById("toggle-edit-pass")?.addEventListener("click", () => {
        const type = editPasswordInput.getAttribute("type") === "password" ? "text" : "password";
        editPasswordInput.setAttribute("type", type);
    });

    if (tabPasswords)
        tabPasswords.addEventListener("click", () => switchTab("passwords"));
    if (tabShares)
        tabShares.addEventListener("click", () => switchTab("shares"));
});

// --- NEW: 4-Digit PIN Input Logic ---
function setupPinInputs() {
    pinInputs.forEach((input, index) => {
        // 1. Move to next input automatically when a digit is typed
        input.addEventListener("input", (e) => {
            if (input.value.length === 1) {
                if (index < pinInputs.length - 1) {
                    pinInputs[index + 1].focus();
                } else {
                    // Optional: You could trigger unlock immediately on the last digit here
                    // handleUnlockVault();
                }
            }
        });

        // 2. Handle Backspace (move focus to previous input)
        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && input.value === "") {
                if (index > 0) {
                    pinInputs[index - 1].focus();
                }
            }
            if (e.key === "Enter") {
                handleUnlockVault();
            }
        });

        // 3. Select existing text when clicking an input (easier editing)
        input.addEventListener("focus", () => input.select());
    });
}

function switchTab(tab) {
    if (tab === "passwords") {
        passwordList.style.display = "block";
        shareList.style.display = "none";
        tabPasswords.style.fontWeight = "bold";
        tabPasswords.style.color = "#153243";
        tabShares.style.fontWeight = "normal";
        tabShares.style.color = "#888";
        loadCredentials();
    } else {
        passwordList.style.display = "none";
        shareList.style.display = "block";
        tabShares.style.fontWeight = "bold";
        tabShares.style.color = "#153243";
        tabPasswords.style.fontWeight = "normal";
        tabPasswords.style.color = "#888";
        loadActiveShares();
    }
}

async function checkUser() {
    const {
        data: { session },
    } = await supabaseClient.auth.getSession();
    if (!session) {
        showSection("auth");
        return;
    }

    const vaultStatus = await chrome.runtime.sendMessage({
        type: "CHECK_VAULT_STATUS",
    });
    if (vaultStatus.status === "setup_needed") showSection("setup");
    else if (vaultStatus.status === "locked") showSection("unlock");
    else if (vaultStatus.status === "unlocked") {
        showSection("app");
        loadCredentials();
    }
}

async function loadCredentials() {
    passwordList.innerHTML =
        "<div style='padding:20px; text-align:center; color:#888;'>Loading...</div>";
    const response = await chrome.runtime.sendMessage({
        type: "GET_DECRYPTED_CREDENTIALS",
    });
    passwordList.innerHTML = "";

    if (!response.success || !response.data || response.data.length === 0) {
        passwordList.innerHTML =
            "<div style='padding:20px; text-align:center; color:#888;'>No passwords saved yet.</div>";
        return;
    }

    // Sort: Non-shared first
    const myItems = response.data.filter((item) => !item.is_shared);
    const sharedItems = response.data.filter((item) => item.is_shared);

    const renderList = (items, title, isShared) => {
        if (items.length === 0) return;

        // Section Header
        const header = document.createElement("div");
        header.style.cssText =
            "font-size: 11px; font-weight: bold; color: #999; margin: 15px 0 8px 5px; text-transform: uppercase;";
        header.innerText = title;
        passwordList.appendChild(header);

        items.forEach((item) => {
            const div = document.createElement("div");
            // Basic styling for the list item (you can move this to CSS class 'bookmark')
            div.style.cssText =
                "background: white; padding: 12px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #eee; display: flex; align-items: center; gap: 12px; cursor: pointer;";

            const faviconUrl =
                item.logo ||
                `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
            const accentColor = isShared ? "#ff9800" : item.color || "#153243";
            div.style.borderLeft = `4px solid ${accentColor}`;

            div.innerHTML = `
            <div class="bm-info" style="display:flex; align-items:center; gap:12px; flex-grow:1;">
                <img src="${faviconUrl}" style="width: 28px; height: 28px; border-radius: 4px;" />
                <div>
                    <div style="font-weight: 600; font-size: 14px; color: #333;">${item.site || "Unknown"}</div>
                    <div style="font-size: 12px; color: #777;">${item.username || "No User"}</div>
                </div>
            </div>
            ${!isShared
                    ? `
            <div style="display:flex; gap:5px;">
                <button class="btn-share" title="Share" style="background:none; border:none; cursor:pointer; opacity:0.6;">🔗</button>
                <button class="btn-edit" title="Edit" style="background:none; border:none; cursor:pointer; opacity:0.6;">✏️</button>
                <button class="btn-delete" title="Delete" style="background:none; border:none; cursor:pointer; opacity:0.6; color:red;">🗑️</button>
            </div>`
                    : `<span style="font-size:9px; color:#ff9800; border:1px solid #ff9800; padding:1px 4px; border-radius:3px; font-weight:bold;">SHARED</span>`
                }
        `;

            // Click to fill
            div.querySelector(".bm-info").addEventListener("click", () =>
                fillCredential(item),
            );

            // Share button logic
            if (!isShared) {
                div.querySelector(".btn-share").addEventListener(
                    "click",
                    async (e) => {
                        e.stopPropagation();
                        const btn = e.currentTarget;
                        btn.innerText = "⏳";
                        const res = await chrome.runtime.sendMessage({
                            type: "CREATE_SHARE",
                            data: item,
                        });
                        if (res?.success) {
                            navigator.clipboard.writeText(res.link);
                            btn.innerText = "✔";
                        } else {
                            btn.innerText = "❌";
                            alert(res.error);
                        }
                        setTimeout(() => (btn.innerText = "🔗"), 2000);
                    },
                );
            }

            if (!isShared) {
                div.querySelector(".btn-delete").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm(`Are you sure you want to delete ${item.site}?`)) {
                        const res = await chrome.runtime.sendMessage({ type: "DELETE_CREDENTIAL", id: item.id });
                        if (res.success) loadCredentials();
                        else alert(res.error);
                    }
                });

                div.querySelector(".btn-edit").addEventListener("click", (e) => {
                    e.stopPropagation();
                    openEditMode(item);
                });
            }
            passwordList.appendChild(div);
        });
    };

    renderList(myItems, "My Vault", false);
    renderList(sharedItems, "Shared With Me", true);
}

async function loadActiveShares() {
    shareList.innerHTML =
        "<div style='padding:20px; text-align:center; color:#888;'>Loading...</div>";
    const response = await chrome.runtime.sendMessage({
        type: "GET_MY_SHARES",
    });
    shareList.innerHTML = "";

    if (!response.success || !response.data || response.data.length === 0) {
        shareList.innerHTML =
            "<div style='padding:20px; text-align:center; color:#888;'>No active share links.</div>";
        return;
    }

    response.data.forEach((share) => {
        const div = document.createElement("div");
        div.style.cssText =
            "background: white; padding: 12px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;";

        const count = share.shared_to ? share.shared_to.length : 0;
        const siteName = share.site || "Unknown";
        const userName = share.username || "Unknown";
        const favicon =
            share.logo ||
            `https://www.google.com/s2/favicons?domain=${siteName}&sz=64`;
        const accentColor = share.color || "#153243";

        div.style.borderLeft = `4px solid ${accentColor}`;

        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <img src="${favicon}" style="width: 32px; height: 32px; border-radius: 4px;" />
                <div>
                    <div style="font-weight:bold; color:#333; font-size:14px;">${siteName}</div>
                    <div style="font-size:12px; color:#666;">${userName}</div>
                    <div style="display:flex; align-items:center; gap:4px; margin-top:3px;">
                        <span style="font-size:10px; color:#555; background:#eee; padding:2px 6px; border-radius:10px;">
                            👥 <b>${count}</b> Access
                        </span>
                    </div>
                </div>
            </div>
            <button class="btn-revoke" style="background:none; border:none; cursor:pointer; color:red; padding:8px;" title="Revoke Access">
                🗑️
            </button>
        `;

        div.querySelector(".btn-revoke").addEventListener("click", async () => {
            if (
                confirm(
                    "Revoke this link? Access will be removed for everyone.",
                )
            ) {
                const res = await chrome.runtime.sendMessage({
                    type: "REVOKE_SHARE",
                    id: share.id,
                });
                if (res.success) {
                    loadActiveShares();
                } else {
                    alert("Error: " + res.error);
                }
            }
        });
        shareList.appendChild(div);
    });
}

// --- FILL CREDENTIAL (With Privacy Mode Trigger) ---
async function fillCredential(item) {
    const storage = await chrome.storage.local.get(["target_tab_id"]);
    let tabId = storage.target_tab_id;
    if (tabId) {
        await chrome.storage.local.remove(["target_tab_id"]);
    } else {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        tabId = tab?.id;
    }

    if (tabId) {
        // 1. Trigger Privacy Mode (Stop Chrome Save Prompt)
        chrome.runtime.sendMessage({ type: "TRIGGER_PRIVACY_MODE" });

        // 2. Fill Credential
        chrome.tabs.sendMessage(tabId, {
            type: "FILL_CREDENTIALS",
            data: item,
        });

        setTimeout(() => window.close(), 100);
    }
}

function showSection(name) {
    [authSection, appSection, setupSection, unlockSection, editSection].forEach(
        (el) => (el.style.display = "none"),
    );
    if (name === "auth") authSection.style.display = "block";
    if (name === "app") appSection.style.display = "flex";
    if (name === "setup") setupSection.style.display = "block";

    if (name === "unlock") {
        unlockSection.style.display = "block";
        // Auto-focus the first PIN box when unlocking
        setTimeout(() => {
            if (pinInputs[0]) pinInputs[0].focus();
        }, 50);
    }
    if (name === "edit") editSection.style.display = "flex";
}

async function handleSetupVault() {
    const pass = document.getElementById("setup-pass").value;
    if (pass) {
        // Optional: Enforce 4-digit check here too if you want
        if (pass.length !== 4) {
            alert("Please enter a 4-digit PIN for the setup.");
            return;
        }

        const res = await chrome.runtime.sendMessage({
            type: "SETUP_VAULT",
            password: pass,
        });
        if (res.success) checkUser();
        else alert(res.error);
    }
}

// --- UPDATED UNLOCK: Combine 4 digits ---
async function handleUnlockVault() {
    let pass = "";
    pinInputs.forEach((input) => (pass += input.value));

    if (pass.length === 4) {
        const res = await chrome.runtime.sendMessage({
            type: "UNLOCK_VAULT",
            password: pass,
        });
        if (res.success) {
            document.getElementById("unlock-error").innerText = "";
            checkUser();
        } else {
            document.getElementById("unlock-error").innerText = "Incorrect PIN";
            // Clear inputs and refocus first
            pinInputs.forEach((input) => (input.value = ""));
            pinInputs[0].focus();
        }
    } else {
        document.getElementById("unlock-error").innerText =
            "Please enter 4 digits";
    }
}

async function handleLockVault() {
    await chrome.runtime.sendMessage({ type: "LOCK_VAULT" });
    // Clear inputs
    pinInputs.forEach((input) => (input.value = ""));
    checkUser();
}

async function handleGoogleLogin() {
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: chrome.identity.getRedirectURL(),
            skipBrowserRedirect: true,
        },
    });
    if (!error) {
        chrome.identity.launchWebAuthFlow(
            { url: data.url, interactive: true },
            async (url) => {
                if (url) {
                    const params = new URLSearchParams(
                        new URL(url).hash.substring(1),
                    );
                    await supabaseClient.auth.setSession({
                        access_token: params.get("access_token"),
                        refresh_token: params.get("refresh_token"),
                    });
                    checkUser();
                }
            },
        );
    } else {
        const msgEl = document.getElementById("auth-message");
        if (msgEl) msgEl.innerText = error.message;
        else alert(error.message);
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    await handleLockVault();
}

function openEditMode(item) {
    editIdInput.value = item.id;
    editSiteInput.value = item.site;
    editUsernameInput.value = item.username;
    editPasswordInput.value = item.password; // This is plain text because loadCredentials decrypted it
    showSection("edit");
}

async function handleSaveEdit() {
    const id = editIdInput.value;
    const site = editSiteInput.value;
    const username = editUsernameInput.value;
    const password = editPasswordInput.value;

    if (!site || !username || !password) {
        alert("All fields are required");
        return;
    }

    // Show simple loading state
    const btn = document.getElementById("btn-save-edit");
    const originalText = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const res = await chrome.runtime.sendMessage({
        type: "UPDATE_CREDENTIAL",
        data: { id, site, username, password }
    });

    btn.innerText = originalText;
    btn.disabled = false;

    if (res.success) {
        showSection("app");
        loadCredentials();
    } else {
        alert("Error updating: " + res.error);
    }
}