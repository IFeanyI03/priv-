import { supabaseClient } from "./supabaseClient.js";

const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const msgDiv = document.getElementById("auth-message");
const listElement = document.getElementById("password-list");

document.addEventListener("DOMContentLoaded", () => {
    checkUser();
    document
        .getElementById("btn-google-login")
        .addEventListener("click", handleGoogleLogin);
    document
        .getElementById("btn-logout")
        .addEventListener("click", handleLogout);
});

// 1. CHECK USER STATUS
async function checkUser() {
    const {
        data: { session },
    } = await supabaseClient.auth.getSession();
    if (session) {
        showApp();
        loadCredentials();
    } else {
        showAuth();
    }
}

// 2. LOAD SAVED PASSWORDS
async function loadCredentials() {
    listElement.innerHTML = "Loading...";

    // Call the Secure RPC Function
    const { data: credentials, error } = await supabaseClient.rpc(
        "get_credentials"
    );

    if (error) {
        console.error("Error loading credentials:", error);
        listElement.innerHTML = `<div style="color:red; text-align:center;">Error loading data.</div>`;
        return;
    }

    listElement.innerHTML = "";

    if (!credentials || credentials.length === 0) {
        listElement.innerHTML =
            "<i style='text-align:center; display:block; margin-top:20px; color:#888;'>No credentials saved yet.</i>";
        return;
    }

    credentials.forEach((item) => {
        const div = document.createElement("div");
        div.className = "bookmark";

        // Use Google for icon, but use saved color for border
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${item.site}&sz=64`;
        const accentColor =
            item.color && item.color !== "" ? item.color : "#ddd"; // Default gray if no color

        div.style.cssText = `
      background: white; 
      padding: 12px; 
      margin-bottom: 10px; 
      border-radius: 6px; 
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border: 1px solid #eee;
      border-left: 5px solid ${accentColor};
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: background 0.2s;
    `;

        // Add hover effect
        div.onmouseover = () => (div.style.background = "#f9f9f9");
        div.onmouseout = () => (div.style.background = "white");

        div.innerHTML = `
      <img src="${faviconUrl}" style="width: 32px; height: 32px; border-radius: 4px;" />
      <div>
        <div style="font-weight: bold; font-size: 14px; color: #333;">${
            item.site || "Unknown Site"
        }</div>
        <div style="font-size: 12px; color: #666;">${
            item.username || "No Username"
        }</div>
      </div>
    `;

        // --- CLICK TO FILL HANDLER ---
        div.addEventListener("click", async () => {
            try {
                // Get the active tab
                const [tab] = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });

                if (tab?.id) {
                    // Send message to contentScript
                    await chrome.tabs.sendMessage(tab.id, {
                        type: "FILL_CREDENTIALS",
                        data: {
                            username: item.username,
                            password: item.password,
                        },
                    });

                    // Optional: Provide feedback or close popup
                    // window.close();
                }
            } catch (err) {
                console.error("Failed to send credentials to page:", err);
            }
        });
        // -----------------------------

        listElement.appendChild(div);
    });
}

// 3. HANDLE GOOGLE LOGIN (Restored)
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

    // Launch Chrome Identity Flow
    chrome.identity.launchWebAuthFlow(
        {
            url: data.url,
            interactive: true,
        },
        async (redirectUrl) => {
            if (chrome.runtime.lastError || !redirectUrl) {
                msgDiv.innerText = "Login Cancelled.";
                return;
            }

            // Extract tokens from the URL
            const urlObj = new URL(redirectUrl);
            const params = new URLSearchParams(urlObj.hash.substring(1)); // Remove the '#'

            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");

            if (!accessToken) {
                msgDiv.innerText = "No token found.";
                return;
            }

            // Set the session in Supabase
            const { error: sessionError } =
                await supabaseClient.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });

            if (sessionError) {
                msgDiv.innerText = "Session Error: " + sessionError.message;
            } else {
                checkUser(); // Refresh UI
            }
        }
    );
}

// 4. HANDLE LOGOUT (Restored)
async function handleLogout() {
    await supabaseClient.auth.signOut();
    checkUser();
}

// 5. UI HELPERS
function showApp() {
    authSection.style.display = "none";
    appSection.style.display = "block";
}
function showAuth() {
    authSection.style.display = "block";
    appSection.style.display = "none";
}