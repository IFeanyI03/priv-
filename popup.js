import { supabaseClient } from "./supabaseClient.js";

// --- DOM ELEMENTS ---
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const setupSection = document.getElementById("setup-section");
const unlockSection = document.getElementById("unlock-section");
const editSection = document.getElementById("edit-section");

const tabPasswords = document.getElementById("tab-passwords");
const tabShares = document.getElementById("tab-shares");
const passwordList = document.getElementById("password-list");
const shareList = document.getElementById("share-list");

const editIdInput = document.getElementById("edit-id");
const editSiteInput = document.getElementById("edit-site");
const editUsernameInput = document.getElementById("edit-username");
const editPasswordInput = document.getElementById("edit-password");

const pinInputs = document.querySelectorAll(".pin-input");

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    checkUser();
    setupPinInputs();

    // Main Buttons
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

    // Tab Switching
    if (tabPasswords)
        tabPasswords.addEventListener("click", () => switchTab("passwords"));
    if (tabShares)
        tabShares.addEventListener("click", () => switchTab("shares"));

    // Edit Section Buttons
    document
        .getElementById("btn-cancel-edit")
        ?.addEventListener("click", () => {
            // Hide password immediately when cancelling
            editPasswordInput.setAttribute("type", "password");
            showSection("app");
        });

    document
        .getElementById("btn-save-edit")
        ?.addEventListener("click", handleSaveEdit);

    // Secure Reveal Password Logic
    document
        .getElementById("toggle-edit-pass")
        ?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const currentType = editPasswordInput.getAttribute("type");

            if (currentType === "password") {
                // Require PIN to view
                showModal({
                    title: "Security Check",
                    message: "Enter your Vault PIN to reveal the password:",
                    inputPlaceholder: "4-Digit PIN",
                    onConfirm: async (pin) => {
                        if (!pin) return;
                        // Validate PIN by trying to "unlock" again
                        const res = await chrome.runtime.sendMessage({
                            type: "UNLOCK_VAULT",
                            password: pin,
                        });

                        if (res.success) {
                            editPasswordInput.setAttribute("type", "text");
                        } else {
                            showToast("Incorrect PIN", "error");
                        }
                    },
                });
            } else {
                // Hide it
                editPasswordInput.setAttribute("type", "password");
            }
        });

    // Global Click Listener: Close Kebab Menus
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".kebab-container")) {
            document
                .querySelectorAll(".dropdown-menu")
                .forEach((el) => (el.style.display = "none"));
        }
    });
});

// --- UI HELPER FUNCTIONS (Toast & Modal) ---

function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        // Lazy create if missing (though it should be in HTML)
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const icon = type === "success" ? "✔" : type === "error" ? "✖" : "ℹ";
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => toast.remove());
    }, 3000);
}

function showModal({
    title,
    message,
    type = "confirm",
    inputPlaceholder = null,
    onConfirm,
}) {
    const overlay = document.getElementById("modal-overlay");
    const titleEl = document.getElementById("modal-title");
    const msgEl = document.getElementById("modal-message");
    const inputEl = document.getElementById("modal-input");
    const cancelBtn = document.getElementById("modal-cancel");
    const confirmBtn = document.getElementById("modal-confirm");

    // Set Text
    titleEl.innerText = title;
    msgEl.innerText = message;

    // Handle Input Field
    inputEl.value = "";
    if (inputPlaceholder) {
        inputEl.style.display = "block";
        inputEl.placeholder = inputPlaceholder;
    } else {
        inputEl.style.display = "none";
    }

    // Button Styles
    confirmBtn.className = `modal-btn ${type === "danger" ? "danger" : "confirm"}`;
    confirmBtn.innerText = type === "danger" ? "Delete" : "OK";

    // Show Modal
    overlay.style.display = "flex";
    if (inputPlaceholder) setTimeout(() => inputEl.focus(), 50);

    // Cleanup Function
    const close = () => {
        overlay.style.display = "none";
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    cancelBtn.onclick = close;

    confirmBtn.onclick = () => {
        const val = inputEl.value;
        if (inputPlaceholder && !val) {
            inputEl.style.border = "1px solid red";
            return;
        }
        inputEl.style.border = "1px solid #ddd"; // Reset border
        close();
        if (onConfirm) onConfirm(val);
    };
}

// --- CORE LOGIC ---

function setupPinInputs() {
    pinInputs.forEach((input, index) => {
        // 1. Auto-focus next & Auto-submit on last digit
        input.addEventListener("input", (e) => {
            if (input.value.length === 1) {
                if (index < pinInputs.length - 1) {
                    pinInputs[index + 1].focus();
                } else {
                    // Auto-submit when the 4th digit is filled
                    handleUnlockVault();
                }
            }
        });

        // 2. Backspace navigation
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

        // 3. Select all on focus
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

function showSection(name) {
    [authSection, appSection, setupSection, unlockSection, editSection].forEach(
        (el) => (el.style.display = "none"),
    );
    if (name === "auth") authSection.style.display = "block";
    if (name === "app") appSection.style.display = "flex";
    if (name === "setup") setupSection.style.display = "block";
    if (name === "unlock") {
        unlockSection.style.display = "block";
        // Auto-focus first PIN input
        setTimeout(() => {
            if (pinInputs[0]) pinInputs[0].focus();
        }, 50);
    }
    if (name === "edit") editSection.style.display = "flex";
}

// --- DATA LOADING & RENDERING ---

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

    const myItems = response.data.filter((item) => !item.is_shared);
    const sharedItems = response.data.filter((item) => item.is_shared);

    const renderList = (items, title, isShared) => {
        if (items.length === 0) return;

        const header = document.createElement("div");
        header.style.cssText =
            "font-size: 11px; font-weight: bold; color: #999; margin: 15px 0 8px 5px; text-transform: uppercase;";
        header.innerText = title;
        passwordList.appendChild(header);

        items.forEach((item) => {
            const div = document.createElement("div");
            div.style.cssText =
                "background: white; padding: 12px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #eee; display: flex; align-items: center; gap: 12px; cursor: pointer; position: relative;";

            const faviconUrl =
                item.logo ||
                `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
            const accentColor = isShared ? "#ff9800" : item.color || "#153243";
            div.style.borderLeft = `4px solid ${accentColor}`;

            // HTML Structure: Icon + Info + Kebab(if user owned)
            div.innerHTML = `
                <div class="bm-info" style="display:flex; align-items:center; gap:12px; flex-grow:1;">
                    <img src="${faviconUrl}" style="width: 28px; height: 28px; border-radius: 4px;" />
                    <div>
                        <div style="font-weight: 600; font-size: 14px; color: #333;">${item.site || "Unknown"}</div>
                        <div style="font-size: 12px; color: #777;">${item.username || "No User"}</div>
                    </div>
                </div>
                ${
                    !isShared
                        ? `
                <div class="kebab-container">
                    <button class="kebab-btn">⋮</button>
                    <div class="dropdown-menu" style="display: none;">
                        <div class="dropdown-item btn-share">🔗 Share</div>
                        <div class="dropdown-item btn-edit">✏️ Edit</div>
                        <div class="dropdown-item btn-delete delete">🗑️ Delete</div>
                    </div>
                </div>`
                        : `<span style="font-size:9px; color:#ff9800; border:1px solid #ff9800; padding:1px 4px; border-radius:3px; font-weight:bold;">SHARED</span>`
                }
            `;

            // Click main area -> Fill
            div.querySelector(".bm-info").addEventListener("click", () =>
                fillCredential(item),
            );

            // Logic for Kebab Menu
            if (!isShared) {
                const kebabBtn = div.querySelector(".kebab-btn");
                const dropdown = div.querySelector(".dropdown-menu");

                kebabBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    // Close others
                    document
                        .querySelectorAll(".dropdown-menu")
                        .forEach((el) => {
                            if (el !== dropdown) el.style.display = "none";
                        });
                    // Toggle current
                    dropdown.style.display =
                        dropdown.style.display === "block" ? "none" : "block";
                });

                // Share
                div.querySelector(".btn-share").addEventListener(
                    "click",
                    async (e) => {
                        e.stopPropagation();
                        dropdown.style.display = "none";

                        const btn = e.currentTarget;
                        const originalText = btn.innerText;
                        btn.innerText = "⏳ Generating...";

                        const res = await chrome.runtime.sendMessage({
                            type: "CREATE_SHARE",
                            data: item,
                        });
                        if (res?.success) {
                            navigator.clipboard.writeText(res.link);
                            showToast("Link copied to clipboard!", "success");
                        } else {
                            showToast(res.error, "error");
                        }
                        btn.innerText = originalText;
                    },
                );

                // Edit
                div.querySelector(".btn-edit").addEventListener(
                    "click",
                    (e) => {
                        e.stopPropagation();
                        dropdown.style.display = "none";
                        openEditMode(item);
                    },
                );

                // Delete
                div.querySelector(".btn-delete").addEventListener(
                    "click",
                    (e) => {
                        e.stopPropagation();
                        dropdown.style.display = "none";

                        showModal({
                            title: "Delete Credential",
                            message: `Are you sure you want to delete ${item.site}?`,
                            type: "danger",
                            onConfirm: async () => {
                                const res = await chrome.runtime.sendMessage({
                                    type: "DELETE_CREDENTIAL",
                                    id: item.id,
                                });
                                if (res.success) {
                                    showToast("Credential deleted", "success");
                                    loadCredentials();
                                } else {
                                    showToast(res.error, "error");
                                }
                            },
                        });
                    },
                );
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
            <button class="btn-revoke" style="background:none; border:none; cursor:pointer; color:red; padding:8px;" title="Revoke Access">🗑️</button>
        `;

        div.querySelector(".btn-revoke").addEventListener("click", () => {
            showModal({
                title: "Revoke Access",
                message:
                    "Revoke this link? Access will be removed for everyone.",
                type: "danger",
                onConfirm: async () => {
                    const res = await chrome.runtime.sendMessage({
                        type: "REVOKE_SHARE",
                        id: share.id,
                    });
                    if (res.success) {
                        showToast("Link revoked", "success");
                        loadActiveShares();
                    } else {
                        showToast("Error: " + res.error, "error");
                    }
                },
            });
        });
        shareList.appendChild(div);
    });
}

// --- CREDENTIAL ACTIONS ---

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
        chrome.runtime.sendMessage({ type: "TRIGGER_PRIVACY_MODE" });
        chrome.tabs.sendMessage(tabId, {
            type: "FILL_CREDENTIALS",
            data: item,
        });
        setTimeout(() => window.close(), 100);
    }
}

async function handleSetupVault() {
    const pass = document.getElementById("setup-pass").value;
    if (pass) {
        if (pass.length !== 4) {
            showToast("Please enter a 4-digit PIN.", "error");
            return;
        }

        const res = await chrome.runtime.sendMessage({
            type: "SETUP_VAULT",
            password: pass,
        });
        if (res.success) checkUser();
        else showToast(res.error, "error");
    }
}

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
            // Reset PIN inputs
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
        else showToast(error.message, "error");
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    await handleLockVault();
}

// --- EDIT MODE LOGIC ---

function openEditMode(item) {
    editIdInput.value = item.id;
    editSiteInput.value = item.site;
    editUsernameInput.value = item.username;
    // We set the real password value, but keep the input type="password" initially
    editPasswordInput.value = item.password;
    editPasswordInput.setAttribute("type", "password");

    showSection("edit");
}

async function handleSaveEdit() {
    const id = editIdInput.value;
    const site = editSiteInput.value;
    const username = editUsernameInput.value;
    const password = editPasswordInput.value;

    if (!site || !username || !password) {
        showToast("All fields are required", "error");
        return;
    }

    const btn = document.getElementById("btn-save-edit");
    const originalText = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const res = await chrome.runtime.sendMessage({
        type: "UPDATE_CREDENTIAL",
        data: { id, site, username, password },
    });

    btn.innerText = originalText;
    btn.disabled = false;

    if (res.success) {
        showSection("app");
        // Ensure hidden for next time
        editPasswordInput.setAttribute("type", "password");
        loadCredentials();
        showToast("Credential updated!", "success");
    } else {
        showToast("Error: " + res.error, "error");
    }
}
