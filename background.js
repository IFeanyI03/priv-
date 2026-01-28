import { supabaseClient } from "./supabaseClient.js";
import {
    generateSalt,
    deriveKey,
    encryptData,
    decryptData,
    arrayBufferToBase64,
    base64ToArrayBuffer,
    generateItemKey,
    wrapKey,
    unwrapKey,
} from "./lib/crypto.js";

let sessionKey = null;
let popupWindowId = null;
const pendingShareKeys = new Map();

// --- WINDOW MANAGEMENT ---
chrome.windows.onRemoved.addListener((winId) => {
    if (winId === popupWindowId) popupWindowId = null;
});

function openOrFocusPopup() {
    if (popupWindowId) {
        chrome.windows.get(popupWindowId, {}, (win) => {
            if (chrome.runtime.lastError || !win) createPopup();
            else chrome.windows.update(popupWindowId, { focused: true });
        });
    } else createPopup();
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
    // Vault
    if (message.type === "CHECK_VAULT_STATUS") {
        checkVaultStatus().then(sendResponse);
        return true;
    }
    if (message.type === "SETUP_VAULT") {
        setupVault(message.password).then(sendResponse);
        return true;
    }
    if (message.type === "UNLOCK_VAULT") {
        unlockVault(message.password).then(sendResponse);
        return true;
    }
    if (message.type === "LOCK_VAULT") {
        sessionKey = null;
        pendingShareKeys.clear();
        sendResponse({ success: true });
        return true;
    }

    // Data
    if (message.type === "GET_DECRYPTED_CREDENTIALS") {
        getDecryptedCredentials().then(sendResponse);
        return true;
    }
    if (message.type === "SAVE_PASSWORD") {
        handleSavePassword(message.data).then(sendResponse);
        return true;
    }
    if (message.type === "UPDATE_CREDENTIAL") {
        updateCredential(message.data).then(sendResponse);
        return true;
    }
    if (message.type === "DELETE_CREDENTIAL") {
        deleteCredential(message.id).then(sendResponse);
        return true;
    }

    // Sharing
    if (message.type === "CREATE_SHARE") {
        createShare(message.data).then(sendResponse);
        return true;
    }
    if (message.type === "GET_MY_SHARES") {
        getMyShares().then(sendResponse);
        return true;
    }
    if (message.type === "RESOLVE_SHARED_LINK") {
        resolveSharedLink(message.id, message.key).then(sendResponse);
        return true;
    }
    if (message.type === "SAVE_SHARE_ACCESS") {
        saveShareAccess(message.data).then(sendResponse);
        return true;
    }
    if (message.type === "REVOKE_SHARE") {
        revokeShare(message.id).then(sendResponse);
        return true;
    }

    // UI
    if (message.type === "OPEN_POPUP") {
        if (sender.tab?.id)
            chrome.storage.local.set({ target_tab_id: sender.tab.id });
        openOrFocusPopup();
    }
    if (message.type === "TRIGGER_PRIVACY_MODE") {
        chrome.privacy.services.passwordSavingEnabled.set({ value: false });
        setTimeout(
            () =>
                chrome.privacy.services.passwordSavingEnabled.set({
                    value: true,
                }),
            120000,
        );
        sendResponse({ success: true });
        return true;
    }
});

chrome.action.onClicked.addListener(openOrFocusPopup);

// ==========================================
//  VAULT HELPERS
// ==========================================

async function checkVaultStatus() {
    if (sessionKey) return { status: "unlocked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return { status: "setup_needed" };

    const storageKey = `vault_${user.id}`;
    const local = await chrome.storage.local.get([storageKey]);
    if (local[storageKey]?.vault_salt) return { status: "locked" };

    const { data: profile } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
    if (profile) {
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
        const vaultData = {
            vault_salt: arrayBufferToBase64(salt.buffer),
            vault_validator: validationToken,
        };

        await supabaseClient
            .from("profiles")
            .upsert({ id: user.id, ...vaultData, updated_at: new Date() });
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
        const local = await chrome.storage.local.get([storageKey]);
        let vaultData = local[storageKey];

        if (!vaultData) {
            const { data } = await supabaseClient
                .from("profiles")
                .select("*")
                .eq("id", user.id)
                .single();
            if (data) {
                vaultData = data;
                await chrome.storage.local.set({ [storageKey]: data });
            }
        }
        if (!vaultData) return { success: false, error: "No vault found." };

        const key = await deriveKey(
            masterPassword,
            base64ToArrayBuffer(vaultData.vault_salt),
        );
        try {
            if ((await decryptData(vaultData.vault_validator, key)) !== "VALID")
                throw new Error();
        } catch {
            return { success: false, error: "Incorrect password" };
        }

        sessionKey = key;
        return { success: true };
    } catch {
        return { success: false, error: "Unlock failed" };
    }
}

// ==========================================
//  CORE FUNCTIONS (Standard RLS - No RPC)
// ==========================================

async function handleSavePassword(data) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    // 1. Generate & Wrap Item Key
    const itemKey = await generateItemKey();
    const keyBlob = await wrapKey(itemKey, sessionKey);
    const encryptedPass = await encryptData(data.password, itemKey);

    // 2. Standard Insert
    const { error } = await supabaseClient.from("credentials").insert({
        user_id: user.id,
        site: data.site,
        username: data.username,
        password: encryptedPass,
        color: data.color,
        logo: data.icon,
        key_blob: keyBlob,
    });

    return { success: !error, error: error?.message };
}

async function updateCredential(data) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    try {
        // 1. Fetch existing key
        let { data: cred } = await supabaseClient
            .from("credentials")
            .select("key_blob")
            .eq("id", data.id)
            .single();

        // Auto-Migration for Legacy Items
        let itemKey;
        if (!cred?.key_blob) {
            itemKey = await generateItemKey();
            const newKeyBlob = await wrapKey(itemKey, sessionKey);
            await supabaseClient
                .from("credentials")
                .update({ key_blob: newKeyBlob })
                .eq("id", data.id);
        } else {
            itemKey = await unwrapKey(cred.key_blob, sessionKey);
        }

        // 2. Encrypt with Item Key
        const encryptedPass = await encryptData(data.password, itemKey);

        // 3. Standard Update
        const { error } = await supabaseClient
            .from("credentials")
            .update({
                site: data.site,
                username: data.username,
                password: encryptedPass,
                updated_at: new Date(),
            })
            .eq("id", data.id)
            .eq("user_id", user.id);

        if (error) throw error;
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getDecryptedCredentials() {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    const allCredentials = [];

    // 1. Personal Items (Standard Select)
    const { data: personal } = await supabaseClient
        .from("credentials")
        .select("*")
        .eq("user_id", user.id);
    if (personal) {
        for (const item of personal) {
            try {
                if (item.key_blob) {
                    const itemKey = await unwrapKey(item.key_blob, sessionKey);
                    allCredentials.push({
                        ...item,
                        password: await decryptData(item.password, itemKey),
                        is_shared: false,
                    });
                } else {
                    allCredentials.push({
                        ...item,
                        password: await decryptData(item.password, sessionKey),
                        is_shared: false,
                    });
                }
            } catch (e) {}
        }
    }

    // 2. Shared Items (Standard Select with Filter)
    const { data: shares } = await supabaseClient
        .from("credential_shares")
        .select(
            `
            *,
            credentials ( id, site, username, password, logo, color )
        `,
        )
        .contains("shared_to", [user.id]);

    if (shares) {
        for (const share of shares) {
            try {
                if (!share.credentials) continue;
                // Get User's copy of the key from metadata
                const myKeyBlob = share.recipient_metadata[user.id];
                if (myKeyBlob) {
                    const itemKey = await unwrapKey(myKeyBlob, sessionKey);
                    allCredentials.push({
                        id: share.credentials.id,
                        site: share.credentials.site,
                        username: share.credentials.username,
                        password: await decryptData(
                            share.credentials.password,
                            itemKey,
                        ), // LIVE password
                        color: "#ff9800",
                        logo: share.credentials.logo,
                        is_shared: true,
                    });
                }
            } catch (e) {}
        }
    }
    return { success: true, data: allCredentials };
}

// ==========================================
//  SHARING (Standard RLS)
// ==========================================

async function createShare(item) {
    try {
        const {
            data: { user },
        } = await supabaseClient.auth.getUser();
        if (!sessionKey) throw new Error("Vault locked");

        // 1. Get Item Key (Auto-migrate if needed)
        let { data: cred } = await supabaseClient
            .from("credentials")
            .select("key_blob, password")
            .eq("id", item.id)
            .single();
        let itemKey;

        if (!cred?.key_blob) {
            itemKey = await generateItemKey();
            const newKeyBlob = await wrapKey(itemKey, sessionKey);
            const newEncPass = await encryptData(item.password, itemKey); // item.password is plain from popup
            await supabaseClient
                .from("credentials")
                .update({ key_blob: newKeyBlob, password: newEncPass })
                .eq("id", item.id);
        } else {
            itemKey = await unwrapKey(cred.key_blob, sessionKey);
        }

        // 2. Link Key Logic
        const linkPassword = crypto.randomUUID();
        const salt = generateSalt();
        const linkKey = await deriveKey(linkPassword, salt);
        const wrappedKeyForLink = await wrapKey(itemKey, linkKey);

        // 3. Standard Insert
        const { data, error } = await supabaseClient
            .from("credential_shares")
            .insert({
                credential_id: item.id,
                share_by: user.id,
                shared_to: [],
                recipient_metadata: {},
                encrypted_data: wrappedKeyForLink,
                salt: arrayBufferToBase64(salt.buffer),
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

async function resolveSharedLink(shareId, linkPassword) {
    try {
        // 1. Standard Select (allowed by 'Public read shares' policy)
        // Note: We join credentials to get the live data
        const { data, error } = await supabaseClient
            .from("credential_shares")
            .select(`*, credentials ( site, username, password, logo, color )`)
            .eq("id", shareId)
            .single();

        if (error || !data || !data.credentials)
            return { success: false, error: "Link invalid or revoked" };

        // 2. Expiration (10 mins)
        if (
            data.created_at &&
            Date.now() - new Date(data.created_at).getTime() > 600000
        ) {
            return { success: false, error: "Link expired" };
        }

        // 3. Decrypt
        const linkKey = await deriveKey(
            linkPassword,
            base64ToArrayBuffer(data.salt),
        );
        const itemKey = await unwrapKey(data.encrypted_data, linkKey);

        pendingShareKeys.set(shareId, itemKey);

        return {
            success: true,
            data: {
                s: data.credentials.site,
                u: data.credentials.username,
                p: await decryptData(data.credentials.password, itemKey),
                c: data.credentials.color,
                i: data.credentials.logo,
            },
        };
    } catch (e) {
        return { success: false, error: "Invalid Key" };
    }
}

async function saveShareAccess(data) {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    try {
        const itemKey = pendingShareKeys.get(data.share_id);
        if (!itemKey) throw new Error("Link expired. Reload.");

        const myKeyBlob = await wrapKey(itemKey, sessionKey);
        const { data: share } = await supabaseClient
            .from("credential_shares")
            .select("shared_to, recipient_metadata")
            .eq("id", data.share_id)
            .single();

        const updatedSharedTo = share.shared_to.includes(user.id)
            ? share.shared_to
            : [...share.shared_to, user.id];
        const updatedMetadata = share.recipient_metadata || {};
        updatedMetadata[user.id] = myKeyBlob;

        const { error } = await supabaseClient
            .from("credential_shares")
            .update({
                shared_to: updatedSharedTo,
                recipient_metadata: updatedMetadata,
            })
            .eq("id", data.share_id);

        if (error) throw error;
        pendingShareKeys.delete(data.share_id);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getMyShares() {
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    const { data } = await supabaseClient
        .from("credential_shares")
        .select("*, credentials(site, username, logo, color)")
        .eq("share_by", user.id);

    return {
        success: true,
        data: data
            ? data.map((item) => ({
                  ...item,
                  site: item.credentials?.site || "Deleted",
                  username: item.credentials?.username || "",
                  logo: item.credentials?.logo || "",
                  color: item.credentials?.color || "#7f8c8d",
              }))
            : [],
    };
}

async function revokeShare(id) {
    const { error } = await supabaseClient
        .from("credential_shares")
        .delete()
        .eq("id", id);
    return { success: !error };
}

async function deleteCredential(id) {
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("credentials")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
    return { success: !error };
}
