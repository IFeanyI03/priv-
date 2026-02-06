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
let pendingSaveData = null; // Store pending credential save
const pendingShareKeys = new Map();

// --- WINDOW MANAGEMENT ---
if (typeof chrome !== "undefined" && chrome.windows) {
    chrome.windows.onRemoved.addListener((winId) => {
        if (winId === popupWindowId) popupWindowId = null;
    });
}

function openOrFocusPopup() {
    if (typeof chrome === "undefined" || !chrome.windows) return;

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
    const handleAsync = async () => {
        try {
            // Vault
            if (message.type === "CHECK_VAULT_STATUS")
                return await checkVaultStatus();
            if (message.type === "SETUP_VAULT")
                return await setupVault(message.password);
            if (message.type === "UNLOCK_VAULT")
                return await unlockVault(message.password);
            if (message.type === "LOCK_VAULT") {
                sessionKey = null;
                pendingShareKeys.clear();
                return { success: true };
            }

            // Data
            if (message.type === "GET_DECRYPTED_CREDENTIALS")
                return await getDecryptedCredentials();
            if (message.type === "SAVE_PASSWORD")
                return await handleSavePassword(message.data);
            if (message.type === "UPDATE_CREDENTIAL")
                return await updateCredential(message.data);
            if (message.type === "DELETE_CREDENTIAL")
                return await deleteCredential(message.id);

            // Pending Save Processing (Called by Popup after unlock)
            if (message.type === "PROCESS_PENDING_SAVE") {
                if (!sessionKey || !pendingSaveData) return { success: false };
                const res = await handleSavePassword(pendingSaveData);
                if (res.success) pendingSaveData = null; // Clear on success
                return res;
            }

            // Sharing
            if (message.type === "CREATE_SHARE")
                return await createShare(message.data);
            if (message.type === "GET_MY_SHARES") return await getMyShares();
            if (message.type === "RESOLVE_SHARED_LINK")
                return await resolveSharedLink(message.id, message.key);
            if (message.type === "SAVE_SHARE_ACCESS")
                return await saveShareAccess(message.data);
            if (message.type === "REVOKE_SHARE")
                return await revokeShare(message.id);

            // UI
            if (message.type === "OPEN_POPUP") {
                if (sender.tab?.id)
                    chrome.storage.local.set({ target_tab_id: sender.tab.id });
                openOrFocusPopup();
                return { success: true };
            }
            if (message.type === "TRIGGER_PRIVACY_MODE") {
                chrome.privacy.services.passwordSavingEnabled.set({
                    value: false,
                });
                setTimeout(
                    () =>
                        chrome.privacy.services.passwordSavingEnabled.set({
                            value: true,
                        }),
                    120000,
                );
                return { success: true };
            }
        } catch (err) {
            console.error("Handler Error:", err);
            return { success: false, error: err.message };
        }
    };

    handleAsync().then(sendResponse);
    return true; // Keep channel open
});

if (typeof chrome !== "undefined" && chrome.action) {
    chrome.action.onClicked.addListener(openOrFocusPopup);
}

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
        let local = await chrome.storage.local.get([storageKey]);
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
            const check = await decryptData(vaultData.vault_validator, key);
            if (check !== "VALID") throw new Error("Invalid Validation");
        } catch (e) {
            return { success: false, error: "Incorrect password" };
        }

        sessionKey = key;
        return { success: true };
    } catch (e) {
        return { success: false, error: "Unlock failed" };
    }
}

// ==========================================
//  CORE FUNCTIONS
// ==========================================

async function getDecryptedCredentials() {
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();
    const allCredentials = [];

    const { data: personal } = await supabaseClient
        .from("credentials")
        .select("*")
        .eq("user_id", user.id);

    if (personal) {
        for (const item of personal) {
            try {
                let plainPass;
                if (item.key_blob) {
                    const itemKey = await unwrapKey(item.key_blob, sessionKey);
                    plainPass = await decryptData(item.password, itemKey);
                } else {
                    plainPass = await decryptData(item.password, sessionKey);
                }

                allCredentials.push({
                    ...item,
                    password: plainPass,
                    is_shared: false,
                });
            } catch (e) {
                console.warn(`Skipping corrupted item: ${item.site}`, e);
            }
        }
    }

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

                const myKeyBlob = share.recipient_metadata[user.id];
                if (myKeyBlob) {
                    const itemKey = await unwrapKey(myKeyBlob, sessionKey);
                    const plainPass = await decryptData(
                        share.credentials.password,
                        itemKey,
                    );

                    allCredentials.push({
                        id: share.credentials.id,
                        site: share.credentials.site,
                        username: share.credentials.username,
                        password: plainPass,
                        color: "#ff9800",
                        logo: share.credentials.logo,
                        is_shared: true,
                    });
                }
            } catch (e) {
                console.warn(`Skipping corrupted share: ${share.id}`, e);
            }
        }
    }

    return { success: true, data: allCredentials };
}

async function handleSavePassword(data) {
    // UPDATED: Check for lock and open popup
    if (!sessionKey) {
        pendingSaveData = data;
        openOrFocusPopup();
        return {
            success: false,
            error: "Vault locked. Please enter PIN in the popup.",
        };
    }

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

    const itemKey = await generateItemKey();
    const keyBlob = await wrapKey(itemKey, sessionKey);
    const encryptedPass = await encryptData(data.password, itemKey);

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
        let { data: cred } = await supabaseClient
            .from("credentials")
            .select("key_blob")
            .eq("id", data.id)
            .single();

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

        const encryptedPass = await encryptData(data.password, itemKey);

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

// UPDATED: Prevent duplicates, update existing
async function createShare(item) {
    try {
        const {
            data: { user },
        } = await supabaseClient.auth.getUser();
        if (!sessionKey) throw new Error("Vault locked");

        let { data: cred } = await supabaseClient
            .from("credentials")
            .select("key_blob, password")
            .eq("id", item.id)
            .single();

        let itemKey;
        if (!cred?.key_blob) {
            itemKey = await generateItemKey();
            const newKeyBlob = await wrapKey(itemKey, sessionKey);
            const newEncPass = await encryptData(item.password, itemKey);

            await supabaseClient
                .from("credentials")
                .update({ key_blob: newKeyBlob, password: newEncPass })
                .eq("id", item.id);
        } else {
            itemKey = await unwrapKey(cred.key_blob, sessionKey);
        }

        const linkPassword = crypto.randomUUID();
        const salt = generateSalt();
        const linkKey = await deriveKey(linkPassword, salt);
        const wrappedKeyForLink = await wrapKey(itemKey, linkKey);

        // 1. Check if share already exists
        const { data: existingShare } = await supabaseClient
            .from("credential_shares")
            .select("id")
            .eq("credential_id", item.id)
            .eq("share_by", user.id)
            .maybeSingle();

        let data, error;

        if (existingShare) {
            // 2. UPDATE existing
            const res = await supabaseClient
                .from("credential_shares")
                .update({
                    encrypted_data: wrappedKeyForLink,
                    salt: arrayBufferToBase64(salt.buffer),
                    created_at: new Date().toISOString(),
                })
                .eq("id", existingShare.id)
                .select()
                .single();
            data = res.data;
            error = res.error;
        } else {
            // 3. INSERT new
            const res = await supabaseClient
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
            data = res.data;
            error = res.error;
        }

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
        const { data, error } = await supabaseClient
            .from("credential_shares")
            .select(`*, credentials ( site, username, password, logo, color )`)
            .eq("id", shareId)
            .single();

        if (error || !data || !data.credentials)
            return { success: false, error: "Link invalid" };

        if (
            data.created_at &&
            Date.now() - new Date(data.created_at).getTime() > 600000
        ) {
            return { success: false, error: "Link expired" };
        }

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
        if (!itemKey) throw new Error("Link expired or key missing.");

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
