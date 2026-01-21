import { supabaseClient } from "./supabaseClient.js";
import {
    generateSalt,
    deriveKey,
    encryptData,
    decryptData,
    arrayBufferToBase64,
    base64ToArrayBuffer,
} from "./lib/crypto.js";

let sessionKey = null;
let popupWindowId = null; // Track the open window

// --- WINDOW MANAGEMENT ---
// If the user closes the popup window, clear the ID
chrome.windows.onRemoved.addListener((winId) => {
    if (winId === popupWindowId) {
        popupWindowId = null;
    }
});

function openOrFocusPopup() {
    if (popupWindowId) {
        // Check if window still exists
        chrome.windows.get(popupWindowId, {}, (win) => {
            if (chrome.runtime.lastError || !win) {
                createPopup(); // It crashed or was closed, create new
            } else {
                chrome.windows.update(popupWindowId, { focused: true }); // Focus existing
            }
        });
    } else {
        createPopup();
    }
}

function createPopup() {
    chrome.windows.create(
        {
            url: "popup.html",
            type: "popup",
            width: 360,
            height: 600,
            focused: true,
        },
        (win) => {
            popupWindowId = win.id;
        },
    );
}

// --- MESSAGE ROUTER ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // VAULT
    if (message.type === "CHECK_VAULT_STATUS") {
        checkVaultStatus().then(sendResponse);
        return true;
    } else if (message.type === "SETUP_VAULT") {
        setupVault(message.password).then(sendResponse);
        return true;
    } else if (message.type === "UNLOCK_VAULT") {
        unlockVault(message.password).then(sendResponse);
        return true;
    } else if (message.type === "LOCK_VAULT") {
        sessionKey = null;
        sendResponse({ success: true });
        return true;
    }

    // DATA
    else if (message.type === "GET_DECRYPTED_CREDENTIALS") {
        getDecryptedCredentials().then(sendResponse);
        return true;
    } else if (message.type === "SAVE_PASSWORD") {
        handleSavePassword(message.data).then(sendResponse);
        return true;
    } else if (message.type === "SAVE_SHARE_ACCESS") {
        saveShareAccess(message.data).then(sendResponse);
        return true;
    }

    else if (message.type === "DELETE_CREDENTIAL") {
        deleteCredential(message.id).then(sendResponse);
        return true;
    } else if (message.type === "UPDATE_CREDENTIAL") {
        updateCredential(message.data).then(sendResponse);
        return true;
    }

    // SHARING
    else if (message.type === "CREATE_SHARE") {
        createShare(message.data).then(sendResponse);
        return true;
    } else if (message.type === "GET_MY_SHARES") {
        getMyShares().then(sendResponse);
        return true;
    } else if (message.type === "REVOKE_SHARE") {
        revokeShare(message.id).then(sendResponse);
        return true;
    } else if (message.type === "RESOLVE_SHARED_LINK") {
        resolveSharedLink(message.id, message.key).then(sendResponse);
        return true;
    }

    // UI
    else if (message.type === "OPEN_POPUP") {
        if (sender.tab?.id)
            chrome.storage.local.set({ target_tab_id: sender.tab.id });
        openOrFocusPopup();
    }

    // --- NEW: PRIVACY MODE TRIGGER ---
    else if (message.type === "TRIGGER_PRIVACY_MODE") {
        // 1. Turn OFF password saving immediately
        chrome.privacy.services.passwordSavingEnabled.set(
            { value: false },
            () => {
                console.log("Privacy Mode: Chrome password saving disabled.");
            },
        );

        // 2. Set a timer to Turn it BACK ON (after 2 minutes)
        // This gives the user time to click submit without Chrome nagging.
        setTimeout(() => {
            chrome.privacy.services.passwordSavingEnabled.set(
                { value: true },
                () => {
                    console.log(
                        "Privacy Mode: Chrome password saving re-enabled.",
                    );
                },
            );
        }, 120000); // 120,000 ms = 2 minutes

        sendResponse({ success: true });
        return true;
    }
});

// --- OPTIONAL: Handle Icon Click ---
chrome.action.onClicked.addListener(() => {
    openOrFocusPopup();
});

// ==========================================
//  VAULT HELPERS (Identity Aware)
// ==========================================

async function checkVaultStatus() {
    if (sessionKey) return { status: "unlocked" };

    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return { status: "setup_needed" };

    // 1. Check Local Storage SPECIFIC to this user
    const storageKey = `vault_${user.id}`;
    const local = await chrome.storage.local.get([storageKey]);

    if (local[storageKey] && local[storageKey].vault_salt) {
        return { status: "locked" };
    }

    // 2. Fallback: Check Supabase 'profiles' (Cloud Sync)
    const { data: profile } = await supabaseClient
        .from("profiles")
        .select("vault_salt, vault_validator")
        .eq("id", user.id)
        .single();

    if (profile && profile.vault_salt) {
        // Sync to local
        await chrome.storage.local.set({ [storageKey]: profile });
        return { status: "locked" };
    }

    return { status: "setup_needed" };
}

async function setupVault(masterPassword) {
    try {
        const {
            data: { user },
        } = await supabaseClient.auth.getUser();
        if (!user) return { success: false, error: "Not logged in" };

        const salt = generateSalt();
        const key = await deriveKey(masterPassword, salt);
        const validationToken = await encryptData("VALID", key);
        const saltBase64 = arrayBufferToBase64(salt.buffer);

        const vaultData = {
            vault_salt: saltBase64,
            vault_validator: validationToken,
        };

        // 1. Save to Cloud
        const { error } = await supabaseClient.from("profiles").upsert({
            id: user.id,
            ...vaultData,
            updated_at: new Date(),
        });

        if (error) throw error;

        // 2. Save to Local (User Scoped)
        await chrome.storage.local.set({ [`vault_${user.id}`]: vaultData });

        sessionKey = key;
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function unlockVault(masterPassword) {
    try {
        const {
            data: { user },
        } = await supabaseClient.auth.getUser();
        if (!user) return { success: false, error: "Not logged in" };

        const storageKey = `vault_${user.id}`;
        let local = await chrome.storage.local.get([storageKey]);
        let vaultData = local[storageKey];

        // If not found locally, try fetching from cloud one last time
        if (!vaultData) {
            const { data: profile } = await supabaseClient
                .from("profiles")
                .select("*")
                .eq("id", user.id)
                .single();

            if (profile) {
                vaultData = profile;
                await chrome.storage.local.set({ [storageKey]: profile });
            }
        }

        if (!vaultData || !vaultData.vault_salt) {
            return { success: false, error: "No vault found for this user." };
        }

        const salt = base64ToArrayBuffer(vaultData.vault_salt);
        const key = await deriveKey(masterPassword, salt);

        try {
            const check = await decryptData(vaultData.vault_validator, key);
            if (check !== "VALID") throw new Error("Invalid password");
        } catch (e) {
            return { success: false, error: "Incorrect password" };
        }

        sessionKey = key;
        return { success: true };
    } catch (err) {
        return { success: false, error: "Unlock failed" };
    }
}

// ==========================================
//  DATA LOGIC
// ==========================================

async function getDecryptedCredentials() {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return { success: false, error: "Not logged in" };

    const allCredentials = [];

    // 1. Personal
    const { data: personal, error: err1 } =
        await supabaseClient.rpc("get_credentials");
    if (!err1 && personal) {
        for (const item of personal) {
            try {
                const plain = await decryptData(item.password, sessionKey);
                allCredentials.push({
                    ...item,
                    password: plain,
                    is_shared: false,
                });
            } catch (e) {
                console.warn("Skipping item (bad key):", item.site);
            }
        }
    }

    // 2. Shared
    const { data: shared, error: err2 } = await supabaseClient.rpc(
        "get_shared_items_for_user",
        { my_user_id: user.id },
    );
    if (shared) {
        for (const item of shared) {
            try {
                if (item.encrypted_blob) {
                    const plain = await decryptData(
                        item.encrypted_blob,
                        sessionKey,
                    );
                    allCredentials.push({
                        id: item.share_id,
                        site: item.site,
                        username: item.username,
                        password: plain,
                        color: "#ff9800",
                        logo: item.logo,
                        is_shared: true,
                    });
                }
            } catch (e) {
                console.error("Shared decrypt fail", e);
            }
        }
    }
    return { success: true, data: allCredentials };
}

async function handleSavePassword(data) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    const { data: existing } = await supabaseClient
        .from("credentials")
        .select("id")
        .eq("site", data.site)
        .eq("username", data.username)
        .eq("user_id", user.id);
    if (existing && existing.length > 0)
        return { success: false, error: "Duplicate credential." };

    const encryptedPass = await encryptData(data.password, sessionKey);
    const { error } = await supabaseClient.rpc("insert_credential", {
        p_site: data.site,
        p_username: data.username,
        p_password: encryptedPass,
        p_color: data.color,
        p_logo: data.icon,
    });
    return { success: !error, error: error?.message };
}

async function saveShareAccess(data) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    try {
        const myEncryptedPass = await encryptData(data.password, sessionKey);
        const { data: currentShare } = await supabaseClient
            .from("credential_shares")
            .select("shared_to, recipient_metadata")
            .eq("id", data.share_id)
            .single();
        if (!currentShare) throw new Error("Share not found");

        const updatedSharedTo = currentShare.shared_to.includes(user.id)
            ? currentShare.shared_to
            : [...currentShare.shared_to, user.id];
        const updatedMetadata = currentShare.recipient_metadata || {};
        updatedMetadata[user.id] = myEncryptedPass;

        const { error } = await supabaseClient
            .from("credential_shares")
            .update({
                shared_to: updatedSharedTo,
                recipient_metadata: updatedMetadata,
            })
            .eq("id", data.share_id);
        if (error) throw error;
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function createShare(item) {
    try {
        const {
            data: { user },
        } = await supabaseClient.auth.getUser();
        const linkPassword = crypto.randomUUID();
        const salt = generateSalt();
        const key = await deriveKey(linkPassword, salt);
        const payload = JSON.stringify({
            s: item.site,
            u: item.username,
            p: item.password,
            c: item.color,
            i: item.logo || "",
        });
        const encryptedData = await encryptData(payload, key);
        const saltBase64 = arrayBufferToBase64(salt.buffer);

        const { data, error } = await supabaseClient
            .from("credential_shares")
            .insert({
                credential_id: item.id,
                share_by: user.id,
                shared_to: [],
                recipient_metadata: {},
                encrypted_data: encryptedData,
                salt: saltBase64,
            })
            .select()
            .single();
        if (error) throw error;
        return {
            success: true,
            link: `https://example.com/#share_id=${data.id}&key=${linkPassword}`,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getMyShares() {
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) {
        console.log("No user logged in");
        return { success: false };
    }

    // DEBUG: Log the ID to verify it matches the database 'share_by' column
    console.log("Fetching shares for User ID:", user.id);

    // USE THE NEW RPC FUNCTION
    const { data, error } = await supabaseClient.rpc("get_created_shares");

    if (error) {
        console.error("RPC Error:", error);
        return { success: false, error: error.message };
    }

    // The RPC already returns the joined data (site, username, etc.)
    // We just need to handle the case where the parent credential might be deleted
    const formattedData = data.map((item) => ({
        ...item,
        site: item.site || "Deleted Credential",
        username: item.site ? item.username : "(Original credential removed)",
        logo: item.logo || "",
        color: item.color || "#7f8c8d",
    }));

    return { success: true, data: formattedData };
}

async function revokeShare(id) {
    const { error } = await supabaseClient
        .from("credential_shares")
        .delete()
        .eq("id", id);
    return { success: !error };
}

async function resolveSharedLink(shareId, linkPassword) {
    try {
        const { data, error } = await supabaseClient
            .from("credential_shares")
            .select(`*, credentials(site, username)`)
            .eq("id", shareId)
            .single();
        if (error || !data) return { success: false, error: "Link invalid" };

        // --- EXPIRE CHECK: 10 MINUTES ---
        if (data.created_at) {
            const createdTime = new Date(data.created_at).getTime();
            const currentTime = Date.now();
            // 10 minutes * 60 seconds * 1000 ms
            const expirationWindow = 10 * 60 * 1000;

            if (currentTime - createdTime > expirationWindow) {
                return { success: false, error: "Link expired" };
            }
        }
        // --------------------------------

        const salt = base64ToArrayBuffer(data.salt);
        const key = await deriveKey(linkPassword, salt);
        const jsonString = await decryptData(data.encrypted_data, key);
        const decrypted = JSON.parse(jsonString);
        return {
            success: true,
            data: {
                ...decrypted,
                s: data.credentials?.site || decrypted.s,
                u: data.credentials?.username || decrypted.u,
            },
        };
    } catch (e) {
        return { success: false, error: "Invalid Key" };
    }
}

async function deleteCredential(id) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return { success: false, error: "Not logged in" };

    // Ensure we only delete items belonging to this user
    const { error } = await supabaseClient
        .from("credentials")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

    return { success: !error, error: error?.message };
}

async function updateCredential(data) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return { success: false, error: "Not logged in" };

    try {
        const updates = {
            site: data.site,
            username: data.username,
            updated_at: new Date()
        };

        // Only re-encrypt if a password is provided
        if (data.password) {
            const encryptedPass = await encryptData(data.password, sessionKey);
            updates.password = encryptedPass;
        }

        const { error } = await supabaseClient
            .from("credentials")
            .update(updates)
            .eq("id", data.id)
            .eq("user_id", user.id);

        if (error) throw error;
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}