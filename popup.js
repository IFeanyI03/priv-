import { supabaseClient } from "./supabaseClient.js";

const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const msgDiv = document.getElementById("auth-message");

// UI Elements for Tabs
const tabPasswords = document.getElementById("tab-passwords");
const tabShares = document.getElementById("tab-shares");
const passwordList = document.getElementById("password-list");
const shareList = document.getElementById("share-list");

document.addEventListener("DOMContentLoaded", () => {
    checkUser();
    
    // Auth Buttons
    document.getElementById("btn-google-login").addEventListener("click", handleGoogleLogin);
    document.getElementById("btn-logout").addEventListener("click", handleLogout);

    // Tab Buttons
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
    if (session) {
        showApp();
        loadCredentials();
    } else {
        showAuth();
    }
}

// --- 1. LOAD PASSWORDS ---
async function loadCredentials() {
    passwordList.innerHTML = "Loading...";

    const { data: credentials, error } = await supabaseClient.rpc("get_credentials");

    if (error) {
        console.error("Error loading credentials:", error);
        passwordList.innerHTML = `<div style="color:red; text-align:center;">Error loading data.</div>`;
        return;
    }

    passwordList.innerHTML = "";

    if (!credentials || credentials.length === 0) {
        passwordList.innerHTML = "<i style='text-align:center; display:block; margin-top:20px; color:#888;'>No credentials saved yet.</i>";
        return;
    }

    credentials.forEach((item) => {
        const div = document.createElement("div");
        div.className = "bookmark";

        const faviconUrl = `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
        const accentColor = item.color && item.color !== "" ? item.color : "#ddd"; 

        div.style.borderLeft = `5px solid ${accentColor}`;

        div.innerHTML = `
            <div class="bm-info" style="display:flex; align-items:center; gap:12px; flex-grow:1;">
                <img src="${faviconUrl}" style="width: 32px; height: 32px; border-radius: 4px;" />
                <div>
                    <div style="font-weight: bold; font-size: 14px; color: #333;">${item.site || "Unknown Site"}</div>
                    <div style="font-size: 12px; color: #666;">${item.username || "No Username"}</div>
                </div>
            </div>
            <button class="btn-share" title="Create Share Link" style="background:none; border:none; cursor:pointer; padding:5px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
            </button>
        `;

        // Fill Credentials Handler
        div.querySelector(".bm-info").addEventListener("click", async () => {
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
                            password: item.password,
                        },
                    });
                }
            } catch (err) {
                console.error("Failed to send credentials:", err);
            }
        });

        // Share Handler
        div.querySelector(".btn-share").addEventListener("click", async (e) => {
            e.stopPropagation();
            
            const btn = e.currentTarget;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = "..."; 

            // Call CREATE_SHARE (inserts to DB)
            const response = await chrome.runtime.sendMessage({ 
                type: "CREATE_SHARE", 
                data: item 
            });

            if (response && response.success) {
                await navigator.clipboard.writeText(response.link);
                btn.innerHTML = `<span style="color:green; font-weight:bold;">✔</span>`; 
            } else {
                alert("Error: " + response.error);
            }
            setTimeout(() => btn.innerHTML = originalHtml, 2000);
        });

        passwordList.appendChild(div);
    });
}

// --- 2. LOAD ACTIVE SHARES ---
async function loadActiveShares() {
    shareList.innerHTML = "Loading...";
    const response = await chrome.runtime.sendMessage({ type: "GET_MY_SHARES" });

    shareList.innerHTML = "";
    if (!response.success || !response.data || response.data.length === 0) {
        shareList.innerHTML = "<div style='text-align:center; color:#888; margin-top:20px;'>No active shared links.</div>";
        return;
    }

    response.data.forEach(share => {
        const div = document.createElement("div");
        div.className = "bookmark";
        div.style.justifyContent = "space-between";

        // Count how many people have access
        const accessCount = share.shared_to ? share.shared_to.length : 0;

        div.innerHTML = `
            <div>
                <div style="font-weight:bold; color:#333;">${share.site || "Unknown"}</div>
                <div style="font-size:12px; color:#666;">${share.username || "No user"}</div>
                <div style="font-size:10px; color:#999; margin-top:2px;">
                    Accessed by: <b>${accessCount}</b> users
                </div>
            </div>
            <button class="btn-revoke" style="background:none; border:none; cursor:pointer; color:red;" title="Revoke Access (Delete Link)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        div.querySelector(".btn-revoke").addEventListener("click", async () => {
            if(confirm("Revoke this link? No one will be able to use it anymore.")) {
                div.style.opacity = "0.5";
                const res = await chrome.runtime.sendMessage({ type: "REVOKE_SHARE", id: share.id });
                if (res.success) {
                    div.remove();
                    if(shareList.children.length === 0) {
                         shareList.innerHTML = "<div style='text-align:center; color:#888; margin-top:20px;'>No active shared links.</div>";
                    }
                } else {
                    alert("Failed to revoke");
                    div.style.opacity = "1";
                }
            }
        });

        shareList.appendChild(div);
    });
}

// --- AUTH LOGIC ---
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
    checkUser();
}

function showApp() {
    authSection.style.display = "none";
    appSection.style.display = "flex"; // Changed to flex for proper layout
}
function showAuth() {
    authSection.style.display = "block";
    appSection.style.display = "none";
}