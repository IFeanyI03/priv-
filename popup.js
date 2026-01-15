import { supabaseClient } from "./supabaseClient.js";

// --- UI REFERENCES ---
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const setupSection = document.getElementById("setup-section");
const unlockSection = document.getElementById("unlock-section");

const tabPasswords = document.getElementById("tab-passwords");
const tabShares = document.getElementById("tab-shares");
const passwordList = document.getElementById("password-list");
const shareList = document.getElementById("share-list");

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
    checkUser();
    
    // Auth & Vault Buttons
    document.getElementById("btn-google-login")?.addEventListener("click", handleGoogleLogin);
    document.getElementById("btn-logout")?.addEventListener("click", handleLogout);
    document.getElementById("btn-setup")?.addEventListener("click", handleSetupVault);
    document.getElementById("btn-unlock")?.addEventListener("click", handleUnlockVault);
    document.getElementById("btn-lock")?.addEventListener("click", handleLockVault);

    // Tabs
    if(tabPasswords) tabPasswords.addEventListener("click", () => switchTab('passwords'));
    if(tabShares) tabShares.addEventListener("click", () => switchTab('shares'));
});

// --- NAVIGATION ---
function switchTab(tab) {
    if (tab === 'passwords') {
        passwordList.style.display = 'block';
        shareList.style.display = 'none';
        tabPasswords.style.fontWeight = 'bold';
        tabPasswords.style.color = '#153243';
        tabShares.style.fontWeight = 'normal';
        tabShares.style.color = '#888';
        loadCredentials(); 
    } else {
        passwordList.style.display = 'none';
        shareList.style.display = 'block';
        tabShares.style.fontWeight = 'bold';
        tabShares.style.color = '#153243';
        tabPasswords.style.fontWeight = 'normal';
        tabPasswords.style.color = '#888';
        loadActiveShares();
    }
}

async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { showSection("auth"); return; }
    
    const vaultStatus = await chrome.runtime.sendMessage({ type: "CHECK_VAULT_STATUS" });
    
    if (vaultStatus.status === "setup_needed") showSection("setup");
    else if (vaultStatus.status === "locked") showSection("unlock");
    else if (vaultStatus.status === "unlocked") { 
        showSection("app"); 
        loadCredentials(); 
    }
}

// --- RENDER: PASSWORDS TAB ---
async function loadCredentials() {
    passwordList.innerHTML = "<div style='padding:10px; text-align:center;'>Loading...</div>";
    const response = await chrome.runtime.sendMessage({ type: "GET_DECRYPTED_CREDENTIALS" });
    passwordList.innerHTML = "";

    if (!response.success || !response.data || response.data.length === 0) {
        passwordList.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>No passwords saved yet.</div>";
        return;
    }

    // Split Data
    const myItems = response.data.filter(item => !item.is_shared);
    const sharedItems = response.data.filter(item => item.is_shared);

    const renderList = (items, title, isShared) => {
        if (items.length === 0) return;
        
        // Section Header
        const header = document.createElement("div");
        header.style.cssText = "font-size: 11px; font-weight: bold; color: #999; margin: 15px 0 8px 5px; text-transform: uppercase;";
        header.innerText = title;
        passwordList.appendChild(header);

        items.forEach((item) => {
            const div = document.createElement("div");
            div.className = "bookmark";
            
            const faviconUrl = item.logo || `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
            const accentColor = isShared ? "#ff9800" : (item.color || "#153243"); 
            
            div.style.borderLeft = `4px solid ${accentColor}`;

            div.innerHTML = `
                <div class="bm-info" style="display:flex; align-items:center; gap:12px; flex-grow:1; cursor:pointer;">
                    <img src="${faviconUrl}" style="width: 28px; height: 28px; border-radius: 4px;" />
                    <div>
                        <div style="font-weight: 600; font-size: 14px; color: #333;">${item.site || "Unknown"}</div>
                        <div style="font-size: 12px; color: #777;">${item.username || "No User"}</div>
                    </div>
                </div>
                ${!isShared ? `
                <button class="btn-share" title="Share" style="background:none; border:none; cursor:pointer; padding:5px; opacity:0.6;">
                    🔗
                </button>` : 
                `<span style="font-size:9px; color:#ff9800; border:1px solid #ff9800; padding:1px 4px; border-radius:3px; font-weight:bold;">SHARED</span>`
                }
            `;

            // Click to Fill
            div.querySelector(".bm-info").addEventListener("click", () => fillCredential(item));
            
            // Share Button (My Items Only)
            if (!isShared) {
                div.querySelector(".btn-share").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget;
                    const originalHtml = btn.innerHTML;
                    btn.innerText = "⏳";
                    
                    const res = await chrome.runtime.sendMessage({ type: "CREATE_SHARE", data: item });
                    
                    if (res?.success) {
                        await navigator.clipboard.writeText(res.link);
                        btn.innerText = "✔";
                    } else {
                        btn.innerText = "❌";
                        alert("Error: " + res.error);
                    }
                    setTimeout(() => btn.innerHTML = originalHtml, 2000);
                });
            }
            passwordList.appendChild(div);
        });
    };

    renderList(myItems, "My Vault", false); 
    renderList(sharedItems, "Shared With Me", true);
}

// --- RENDER: SHARED LINKS TAB ---
async function loadActiveShares() {
    shareList.innerHTML = "<div style='padding:10px; text-align:center;'>Loading...</div>";
    const response = await chrome.runtime.sendMessage({ type: "GET_MY_SHARES" });
    shareList.innerHTML = "";

    if (!response.success || !response.data || response.data.length === 0) {
        shareList.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>No active share links.</div>";
        return;
    }

    response.data.forEach(share => {
        const div = document.createElement("div");
        div.className = "bookmark";
        div.style.justifyContent = "space-between";
        
        const count = share.shared_to ? share.shared_to.length : 0;
        const siteName = share.site || "Unknown";
        const userName = share.username || "Unknown";
        const favicon = `https://www.google.com/s2/favicons?domain=${siteName}&sz=64`;

        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${favicon}" style="width: 24px; height: 24px; border-radius: 4px;" />
                <div>
                    <div style="font-weight:bold; color:#333; font-size:13px;">${siteName}</div>
                    <div style="font-size:11px; color:#666;">${userName}</div>
                    <div style="font-size:10px; color:#999;">Accessed by: ${count}</div>
                </div>
            </div>
            <button class="btn-revoke" style="background:none; border:none; cursor:pointer; color:red; padding:5px;">🗑️</button>
        `;
        
        div.querySelector(".btn-revoke").addEventListener("click", async () => {
            if(confirm("Revoke this link? Users with access will lose it.")) {
                const res = await chrome.runtime.sendMessage({ type: "REVOKE_SHARE", id: share.id });
                if (res.success) loadActiveShares();
            }
        });
        shareList.appendChild(div);
    });
}

// --- HELPERS ---

async function fillCredential(item) {
    const storage = await chrome.storage.local.get(['target_tab_id']);
    let tabId = storage.target_tab_id;
    
    if (tabId) {
        await chrome.storage.local.remove(['target_tab_id']);
    } else { 
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); 
        tabId = tab?.id; 
    }
    
    if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: "FILL_CREDENTIALS", data: item });
        setTimeout(() => window.close(), 100);
    }
}

function showSection(name) {
    [authSection, appSection, setupSection, unlockSection].forEach(el => el.style.display = "none");
    if (name === "auth") authSection.style.display = "block";
    if (name === "app") appSection.style.display = "flex";
    if (name === "setup") setupSection.style.display = "block";
    if (name === "unlock") unlockSection.style.display = "block";
}

async function handleSetupVault() {
    const pass = document.getElementById("setup-pass").value;
    if (pass) { 
        const res = await chrome.runtime.sendMessage({ type: "SETUP_VAULT", password: pass }); 
        if (res.success) checkUser(); 
    }
}

async function handleUnlockVault() {
    const pass = document.getElementById("unlock-pass").value;
    if (pass) { 
        const res = await chrome.runtime.sendMessage({ type: "UNLOCK_VAULT", password: pass }); 
        if (res.success) checkUser(); 
        else alert("Incorrect Password");
    }
}

async function handleLockVault() { 
    await chrome.runtime.sendMessage({ type: "LOCK_VAULT" }); 
    checkUser(); 
}

async function handleGoogleLogin() {
    const { data, error } = await supabaseClient.auth.signInWithOAuth({ 
        provider: "google", 
        options: { 
            redirectTo: chrome.identity.getRedirectURL(), 
            skipBrowserRedirect: true 
        }
    });
    
    if (!error) {
        chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, async (url) => {
            if (url) {
                const params = new URLSearchParams(new URL(url).hash.substring(1));
                await supabaseClient.auth.setSession({ 
                    access_token: params.get("access_token"), 
                    refresh_token: params.get("refresh_token") 
                });
                checkUser();
            }
        });
    } else {
        alert("Login Error: " + error.message);
    }
}

async function handleLogout() { 
    await supabaseClient.auth.signOut(); 
    await handleLockVault(); 
}