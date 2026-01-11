import { supabaseClient } from "./supabaseClient.js";

// UI Elements
const setupSection = document.getElementById("setup-section");
const unlockSection = document.getElementById("unlock-section");
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const listElement = document.getElementById("password-list");
const msgDiv = document.getElementById("auth-message");

document.addEventListener("DOMContentLoaded", async () => {
    // Event Listeners
    document.getElementById("btn-setup").addEventListener("click", handleSetup);
    document.getElementById("btn-unlock").addEventListener("click", handleUnlock);
    
    // Lock button closes the window (which technically keeps it unlocked in background until restart, 
    // unless we explicitly call LOCK_VAULT. Let's add explicit lock.)
    document.getElementById("btn-lock").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ type: "LOCK_VAULT" });
        window.close();
    });
    
    document.getElementById("btn-google-login").addEventListener("click", handleGoogleLogin);
    document.getElementById("btn-logout").addEventListener("click", handleLogout);

    await initFlow();
});

async function initFlow() {
    // 1. Is the vault set up?
    const stored = await chrome.storage.local.get(["auth_salt"]);
    if (!stored.auth_salt) {
        showSection(setupSection);
        return;
    }

    // 2. Is the vault unlocked?
    const { isLocked } = await chrome.runtime.sendMessage({ type: "CHECK_LOCK_STATUS" });
    if (isLocked) {
        showSection(unlockSection);
        return;
    }

    // 3. Is the user logged into Supabase?
    checkUser();
}

async function handleSetup() {
    const password = document.getElementById("setup-pass").value;
    if (!password) return alert("Password cannot be empty");

    await chrome.runtime.sendMessage({ type: "SETUP_MASTER_PASSWORD", password });
    initFlow(); 
}

async function handleUnlock() {
    const password = document.getElementById("unlock-pass").value;
    const errDiv = document.getElementById("unlock-error");
    errDiv.innerText = "Unlocking...";

    const response = await chrome.runtime.sendMessage({ type: "UNLOCK_VAULT", password });
    
    if (response.success) {
        errDiv.innerText = "";
        initFlow();
    } else {
        errDiv.innerText = "Incorrect password.";
    }
}

async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        showSection(appSection);
        loadCredentials();
    } else {
        showSection(authSection);
    }
}

async function loadCredentials() {
    listElement.innerHTML = "Loading...";

    const { data: credentials, error } = await supabaseClient.rpc("get_credentials");
    
    if (error || !credentials) {
        listElement.innerHTML = error ? "Error loading data." : "No credentials saved.";
        console.error(error);
        return;
    }

    listElement.innerHTML = "";
    if(credentials.length === 0) {
         listElement.innerHTML = "<div style='text-align:center; margin-top:20px; color:#888;'>No passwords saved.</div>";
         return;
    }

    credentials.forEach((item) => {
        const div = document.createElement("div");
        div.className = "bookmark";
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
        const accentColor = item.color || "#ddd";
        
        div.style.borderLeft = `5px solid ${accentColor}`;

        div.innerHTML = `
            <img src="${faviconUrl}" style="width:32px; height:32px; border-radius:4px;" />
            <div>
                <div style="font-weight:bold; font-size:14px; color:#333;">${item.site || "Unknown"}</div>
                <div style="font-size:12px; color:#666;">${item.username || "No Username"}</div>
            </div>
        `;
        
        // CLICK TO FILL
        div.addEventListener("click", async () => {
             const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
             const storage = await chrome.storage.local.get(['target_tab_id']);
             
             // Prioritize target_tab_id if this is a popup window
             const finalTabId = storage.target_tab_id || (tab ? tab.id : null);
             await chrome.storage.local.remove(['target_tab_id']);

             if(finalTabId) {
                 // Send message to background to decrypt and fill
                 chrome.runtime.sendMessage({
                     type: "DECRYPT_AND_FILL",
                     encryptedPassword: item.password,
                     username: item.username,
                     tabId: finalTabId
                 });
                 
                 // Close window if it was opened as a detached popup
                 if(storage.target_tab_id) window.close();
             }
        });

        listElement.appendChild(div);
    });
}

// --- AUTH HELPERS ---

async function handleGoogleLogin() {
    if(msgDiv) msgDiv.innerText = "Launching Google Login...";
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: chrome.identity.getRedirectURL(),
            skipBrowserRedirect: true,
        },
    });

    if (error) {
        if(msgDiv) msgDiv.innerText = "Error: " + error.message;
        return;
    }

    chrome.identity.launchWebAuthFlow(
        { url: data.url, interactive: true },
        async (redirectUrl) => {
            if (chrome.runtime.lastError || !redirectUrl) {
                if(msgDiv) msgDiv.innerText = "Login Cancelled.";
                return;
            }
            const urlObj = new URL(redirectUrl);
            const params = new URLSearchParams(urlObj.hash.substring(1));
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");

            if (!accessToken) {
                if(msgDiv) msgDiv.innerText = "No token found.";
                return;
            }

            const { error: sessionError } = await supabaseClient.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
            });

            if (sessionError && msgDiv) {
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

function showSection(el) {
    [setupSection, unlockSection, authSection, appSection].forEach(x => x.style.display = 'none');
    el.style.display = 'block';
}