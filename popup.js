import { supabaseClient } from "./supabaseClient.js";

// --- UI ELEMENTS ---
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const setupSection = document.getElementById("setup-section");
const unlockSection = document.getElementById("unlock-section");
const msgDiv = document.getElementById("auth-message");

const tabPasswords = document.getElementById("tab-passwords");
const tabShares = document.getElementById("tab-shares");
const passwordList = document.getElementById("password-list");
const shareList = document.getElementById("share-list");

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    // 1. Check Auth & Vault Status
    checkUser();

    // 2. Auth Buttons
    document.getElementById("btn-google-login")?.addEventListener("click", handleGoogleLogin);
    document.getElementById("btn-logout")?.addEventListener("click", handleLogout);

    // 3. Vault Buttons
    document.getElementById("btn-setup")?.addEventListener("click", handleSetupVault);
    document.getElementById("btn-unlock")?.addEventListener("click", handleUnlockVault);
    document.getElementById("btn-lock")?.addEventListener("click", handleLockVault);

    // 4. Tab Navigation
    if(tabPasswords) tabPasswords.addEventListener("click", () => switchTab('passwords'));
    if(tabShares) tabShares.addEventListener("click", () => switchTab('shares'));
});

// --- TAB SWITCHING ---
function switchTab(tab) {
    if (tab === 'passwords') {
        passwordList.style.display = 'block';
        shareList.style.display = 'none';
        
        tabPasswords.style.fontWeight = 'bold';
        tabPasswords.style.color = '#153243';
        tabShares.style.fontWeight = 'normal';
        tabShares.style.color = '#888';
        
        loadCredentials(); // Reload passwords
    } else {
        passwordList.style.display = 'none';
        shareList.style.display = 'block';
        
        tabShares.style.fontWeight = 'bold';
        tabShares.style.color = '#153243';
        tabPasswords.style.fontWeight = 'normal';
        tabPasswords.style.color = '#888';
        
        loadActiveShares(); // Load shares
    }
}

// --- CORE FLOW ---
async function checkUser() {
    // 1. Check Supabase Session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        showSection("auth");
        return;
    }

    // 2. Check if Vault is Set Up or Locked (via Background)
    const vaultStatus = await chrome.runtime.sendMessage({ type: "CHECK_VAULT_STATUS" });
    
    if (vaultStatus.status === "setup_needed") {
        showSection("setup");
    } else if (vaultStatus.status === "locked") {
        showSection("unlock");
    } else if (vaultStatus.status === "unlocked") {
        showSection("app");
        loadCredentials(); // Default load
    }
}

// --- VAULT HANDLERS ---
async function handleSetupVault() {
    const pass = document.getElementById("setup-pass").value;
    if (!pass) return alert("Please enter a master password");
    
    const res = await chrome.runtime.sendMessage({ type: "SETUP_VAULT", password: pass });
    if (res.success) checkUser();
}

async function handleUnlockVault() {
    const pass = document.getElementById("unlock-pass").value;
    if (!pass) return;

    const res = await chrome.runtime.sendMessage({ type: "UNLOCK_VAULT", password: pass });
    if (res.success) {
        document.getElementById("unlock-error").innerText = "";
        checkUser();
    } else {
        document.getElementById("unlock-error").innerText = "Incorrect password";
    }
}

async function handleLockVault() {
    await chrome.runtime.sendMessage({ type: "LOCK_VAULT" });
    checkUser();
}

// --- APP LOGIC: LOAD PASSWORDS ---
async function loadCredentials() {
    passwordList.innerHTML = "<div style='padding:10px; text-align:center;'>Loading...</div>";

    // Request Decrypted Credentials from Background
    const response = await chrome.runtime.sendMessage({ type: "GET_DECRYPTED_CREDENTIALS" });
    
    passwordList.innerHTML = "";
    if (!response.success || !response.data || response.data.length === 0) {
        passwordList.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>No passwords saved yet.</div>";
        return;
    }

    response.data.forEach((item) => {
        const div = document.createElement("div");
        div.className = "bookmark";
        
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
        const accentColor = item.color || "#ddd"; 
        div.style.borderLeft = `5px solid ${accentColor}`;

        div.innerHTML = `
            <div class="bm-info" style="display:flex; align-items:center; gap:12px; flex-grow:1; cursor:pointer;">
                <img src="${faviconUrl}" style="width: 32px; height: 32px; border-radius: 4px;" />
                <div>
                    <div style="font-weight: bold; font-size: 14px; color: #333;">${item.site || "Unknown"}</div>
                    <div style="font-size: 12px; color: #666;">${item.username || "No User"}</div>
                </div>
            </div>
            <button class="btn-share" title="Share" style="background:none; border:none; cursor:pointer; padding:8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
            </button>
        `;

        // 1. CLICK INFO -> FILL
        div.querySelector(".bm-info").addEventListener("click", async () => {
             fillCredential(item);
        });

        // 2. CLICK SHARE -> CREATE LINK
        div.querySelector(".btn-share").addEventListener("click", async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = "..."; 

            const res = await chrome.runtime.sendMessage({ 
                type: "CREATE_SHARE", 
                data: item 
            });

            if (res && res.success) {
                await navigator.clipboard.writeText(res.link);
                btn.innerHTML = `<span style="color:green; font-weight:bold;">✔</span>`; 
            } else {
                alert("Error: " + (res.error || "Unknown error"));
                btn.innerHTML = originalHtml;
            }
            setTimeout(() => btn.innerHTML = originalHtml, 2000);
        });

        passwordList.appendChild(div);
    });
}

// --- APP LOGIC: LOAD SHARES ---
async function loadActiveShares() {
    shareList.innerHTML = "<div style='padding:10px; text-align:center;'>Loading...</div>";
    const response = await chrome.runtime.sendMessage({ type: "GET_MY_SHARES" });

    shareList.innerHTML = "";
    if (!response.success || !response.data || response.data.length === 0) {
        shareList.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>No active shared links.</div>";
        return;
    }

    response.data.forEach(share => {
        const div = document.createElement("div");
        div.className = "bookmark";
        div.style.justifyContent = "space-between";
        div.style.cursor = "default";

        const accessCount = share.shared_to ? share.shared_to.length : 0;

        div.innerHTML = `
            <div>
                <div style="font-weight:bold; color:#333;">${share.site || "Unknown"}</div>
                <div style="font-size:12px; color:#666;">${share.username || "No User"}</div>
                <div style="font-size:11px; color:#999; margin-top:2px;">
                    Accessed by: <b>${accessCount}</b> users
                </div>
            </div>
            <button class="btn-revoke" title="Revoke (Delete)" style="background:none; border:none; cursor:pointer; color:red; padding:8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        // REVOKE
        div.querySelector(".btn-revoke").addEventListener("click", async () => {
            if(confirm("Revoke this link? This action cannot be undone.")) {
                div.style.opacity = "0.5";
                const res = await chrome.runtime.sendMessage({ type: "REVOKE_SHARE", id: share.id });
                if (res.success) {
                    div.remove();
                    if(shareList.children.length === 0) shareList.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>No active shared links.</div>";
                } else {
                    alert("Failed to revoke: " + res.error);
                    div.style.opacity = "1";
                }
            }
        });

        shareList.appendChild(div);
    });
}

// --- HELPER: FILL CREDENTIAL ---
async function fillCredential(item) {
    try {
        let targetTabId = null;
        const storage = await chrome.storage.local.get(['target_tab_id']);
        
        if (storage.target_tab_id) {
            targetTabId = storage.target_tab_id;
            await chrome.storage.local.remove(['target_tab_id']);
            setTimeout(() => window.close(), 100); 
        } else {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            targetTabId = tab?.id;
        }

        if (targetTabId) {
            await chrome.tabs.sendMessage(targetTabId, {
                type: "FILL_CREDENTIALS",
                data: {
                    username: item.username,
                    password: item.password, // This is Plaintext (decrypted by background before sending here)
                },
            });
        }
    } catch (err) {
        console.error("Fill Error:", err);
    }
}

// --- HELPERS: SHOW SECTION ---
function showSection(name) {
    [authSection, appSection, setupSection, unlockSection].forEach(el => el.style.display = "none");
    
    if (name === "auth") authSection.style.display = "block";
    if (name === "app") appSection.style.display = "flex"; // Flex for column layout
    if (name === "setup") setupSection.style.display = "block";
    if (name === "unlock") unlockSection.style.display = "block";
}

// --- AUTH HANDLERS ---
async function handleGoogleLogin() {
    msgDiv.innerText = "Launching Google Login...";
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: chrome.identity.getRedirectURL(),
            skipBrowserRedirect: true,
        },
    });

    if (error) {
        msgDiv.innerText = "Error: " + error.message;
        return;
    }

    chrome.identity.launchWebAuthFlow(
        { url: data.url, interactive: true },
        async (redirectUrl) => {
            if (chrome.runtime.lastError || !redirectUrl) {
                msgDiv.innerText = "Login Cancelled.";
                return;
            }
            const urlObj = new URL(redirectUrl);
            const params = new URLSearchParams(urlObj.hash.substring(1));
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");

            if (!accessToken) {
                msgDiv.innerText = "No token found.";
                return;
            }

            const { error: sessionError } = await supabaseClient.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
            });

            if (sessionError) {
                msgDiv.innerText = "Session Error: " + sessionError.message;
            } else {
                checkUser();
            }
        }
    );
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    await chrome.runtime.sendMessage({ type: "LOCK_VAULT" }); // Lock on logout
    checkUser();
}