import { supabaseClient } from "./supabaseClient.js";
import { 
    generateSalt, 
    deriveKey, 
    encryptData, 
    decryptData, 
    arrayBufferToBase64, 
    base64ToArrayBuffer 
} from "./lib/crypto.js";

// --- GLOBAL STATE ---
let sessionKey = null; 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- VAULT & AUTH ---
    if (message.type === "CHECK_VAULT_STATUS") {
        checkVaultStatus().then(sendResponse);
        return true; 
    }
    else if (message.type === "SETUP_VAULT") {
        setupVault(message.password).then(sendResponse);
        return true;
    }
    else if (message.type === "UNLOCK_VAULT") {
        unlockVault(message.password).then(sendResponse);
        return true;
    }
    else if (message.type === "LOCK_VAULT") {
        sessionKey = null;
        sendResponse({ success: true });
        return true;
    }

    // --- CREDENTIALS ---
    else if (message.type === "GET_DECRYPTED_CREDENTIALS") {
        getDecryptedCredentials().then(sendResponse);
        return true;
    }
    else if (message.type === "SAVE_PASSWORD") {
        handleSavePassword(message.data).then(res => sendResponse(res));
        return true;
    }
    
    // --- POPUP & TABS ---
    else if (message.type === "OPEN_POPUP") {
        if (sender.tab?.id) {
            chrome.storage.local.set({ 'target_tab_id': sender.tab.id });
        }
        chrome.windows.create({
            url: "popup.html", type: "popup", width: 360, height: 600, focused: true 
        });
    }

    // --- SHARING ---
    else if (message.type === "CREATE_SHARE") {
        createShare(message.data).then(sendResponse);
        return true;
    }
    else if (message.type === "GET_MY_SHARES") {
        getMyShares().then(sendResponse);
        return true;
    }
    else if (message.type === "REVOKE_SHARE") {
        revokeShare(message.id).then(sendResponse);
        return true;
    }
    else if (message.type === "RESOLVE_SHARED_LINK") {
        resolveSharedLink(message.id, message.key).then(sendResponse);
        return true;
    }
});

// ==========================================
//  SECTION A: VAULT SECURITY (FIXED)
// ==========================================

async function checkVaultStatus() {
    const storage = await chrome.storage.local.get(["vault_salt", "vault_validator"]);
    if (!storage.vault_salt || !storage.vault_validator) return { status: "setup_needed" };
    if (!sessionKey) return { status: "locked" };
    return { status: "unlocked" };
}

async function setupVault(masterPassword) {
    try {
        const salt = generateSalt();
        const key = await deriveKey(masterPassword, salt);

        // --- FIX 1: Create a Validation Token ---
        // We encrypt the word "VALID". Later, we try to decrypt it.
        // If decryption fails, we know the password is wrong.
        const validationToken = await encryptData("VALID", key);
        
        const saltBase64 = arrayBufferToBase64(salt.buffer);
        
        await chrome.storage.local.set({ 
            vault_salt: saltBase64,
            vault_validator: validationToken 
        });
        
        sessionKey = key;
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function unlockVault(masterPassword) {
    try {
        const { vault_salt, vault_validator } = await chrome.storage.local.get(["vault_salt", "vault_validator"]);
        if (!vault_salt || !vault_validator) return { success: false, error: "No vault found" };

        const salt = base64ToArrayBuffer(vault_salt);
        const key = await deriveKey(masterPassword, salt);
        
        // --- FIX 1 (Cont): Verify the Password ---
        try {
            const check = await decryptData(vault_validator, key);
            if (check !== "VALID") throw new Error("Invalid password");
        } catch (e) {
            // Decryption failed means the key (and thus the password) is wrong
            return { success: false, error: "Incorrect password" };
        }

        sessionKey = key; 
        return { success: true };
    } catch (err) {
        return { success: false, error: "Unlock failed" };
    }
}

// ==========================================
//  SECTION B: DATA HANDLING (FIXED)
// ==========================================

async function getDecryptedCredentials() {
    if (!sessionKey) return { success: false, error: "Vault locked" };

    const { data: credentials, error } = await supabaseClient.rpc("get_credentials");
    if (error) return { success: false, error: error.message };

    // --- FIX 2: Decrypt passwords before sending to Popup ---
    const decryptedList = await Promise.all(credentials.map(async (item) => {
        try {
            // Try to decrypt. If it fails (e.g. old plaintext data), return as is or mark error
            const plainPass = await decryptData(item.password, sessionKey);
            return { ...item, password: plainPass };
        } catch (e) {
            // Fallback for legacy/plaintext data if you have any
            return { ...item }; 
        }
    }));

    return { success: true, data: decryptedList };
}

async function handleSavePassword(data) {
    if (!sessionKey) return { success: false, error: "Vault is locked" };

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return { success: false, error: "Not logged in" };

    // --- FIX 3: Check for Duplicates ---
    // Prevent saving if (site + username) already exists for this user
    const { data: existing } = await supabaseClient
        .from('credentials')
        .select('id')
        .eq('site', data.site)
        .eq('username', data.username)
        .eq('user_id', user.id); // Ensure we only check current user's vault

    if (existing && existing.length > 0) {
        return { success: false, error: "Credential already exists in your vault." };
    }

    // --- FIX 2 (Cont): Encrypt before saving ---
    const encryptedPass = await encryptData(data.password, sessionKey);

    const { data: savedData, error } = await supabaseClient.rpc(
        "insert_credential",
        {
            p_site: data.site,
            p_username: data.username,
            p_password: encryptedPass, // Send ENCRYPTED string
            p_color: data.color || "",
            p_logo: data.icon || "", 
        }
    );
    
    if (error) {
        console.error("Supabase Error:", error);
        return { success: false, error: error.message };
    }
    return { success: true, data: savedData };
}

// ==========================================
//  SECTION C: SHARING (FIXED)
// ==========================================

async function createShare(item) {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return { success: false, error: "Not logged in" };

        const linkPassword = crypto.randomUUID(); 
        const salt = generateSalt();
        const key = await deriveKey(linkPassword, salt);
        
        // We share the PLAINTEXT password inside the encrypted bundle
        // (The receiver will re-encrypt it with THEIR master password upon saving)
        const payload = JSON.stringify({
            s: item.site,
            u: item.username,
            p: item.password, // 'item.password' here is already decrypted by getDecryptedCredentials
            c: item.color,
            i: item.logo || ""
        });
        
        const encryptedData = await encryptData(payload, key);
        const saltBase64 = arrayBufferToBase64(salt.buffer);

        const { data, error } = await supabaseClient
            .from('credential_shares')
            .insert({
                credential_id: item.id,
                share_by: user.id,
                shared_to: [],
                encrypted_data: encryptedData,
                salt: saltBase64
            })
            .select()
            .single();

        if (error) throw error;

        const shareUrl = `https://example.com/#share_id=${data.id}&key=${linkPassword}`;
        return { success: true, link: shareUrl };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getMyShares() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return { success: false };

    const { data, error } = await supabaseClient
        .from('credential_shares')
        .select('*')
        .eq('share_by', user.id)
        .order('created_at', { ascending: false });

    return { success: !error, data: data };
}

async function revokeShare(shareId) {
    const { error } = await supabaseClient
        .from('credential_shares')
        .delete()
        .eq('id', shareId);
    return { success: !error, error: error?.message };
}

async function resolveSharedLink(shareId, linkPassword) {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        
        const { data, error } = await supabaseClient
            .from('credential_shares')
            .select('*')
            .eq('id', shareId)
            .single();

        if (error || !data) return { success: false, error: "Link revoked or not found" };

        const salt = base64ToArrayBuffer(data.salt);
        const key = await deriveKey(linkPassword, salt);
        const jsonString = await decryptData(data.encrypted_data, key);
        
        if (!jsonString) throw new Error("Decryption failed");

        // Update Access List
        if (user && !data.shared_to.includes(user.id)) {
            const updatedList = [...data.shared_to, user.id];
            supabaseClient
                .from('credential_shares')
                .update({ shared_to: updatedList })
                .eq('id', shareId)
                .then(() => {});
        }

        return { success: true, data: JSON.parse(jsonString) };
    } catch (err) {
        return { success: false, error: "Invalid Key or Data" };
    }
}