import { supabaseClient } from "./supabaseClient.js";
import { 
    generateSalt, 
    deriveKey, 
    encryptData, 
    decryptData, 
    arrayBufferToBase64, 
    base64ToArrayBuffer 
} from "./lib/crypto.js";

let sessionKey = null; 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- VAULT ---
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

    // --- CREDENTIALS (READING) ---
    else if (message.type === "GET_DECRYPTED_CREDENTIALS") {
        getDecryptedCredentials().then(sendResponse);
        return true;
    }

    // --- SAVING ---
    else if (message.type === "SAVE_PASSWORD") {
        handleSavePassword(message.data).then(sendResponse);
        return true;
    }
    // NEW: Handle Saving a Shared Link (Without touching credentials table)
    else if (message.type === "SAVE_SHARE_ACCESS") {
        saveShareAccess(message.data).then(sendResponse);
        return true;
    }
    
    // --- OTHERS ---
    else if (message.type === "OPEN_POPUP") {
        if (sender.tab?.id) chrome.storage.local.set({ 'target_tab_id': sender.tab.id });
        chrome.windows.create({ url: "popup.html", type: "popup", width: 360, height: 600, focused: true });
    }
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

// ... (Keep verifyVault, setupVault, unlockVault exactly as they were in the previous "FIXED" version) ...
// ... RE-PASTE THE VAULT LOGIC HERE FOR COMPLETENESS IF NEEDED, OR USE EXISTING ...

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
        const validationToken = await encryptData("VALID", key);
        const saltBase64 = arrayBufferToBase64(salt.buffer);
        
        await chrome.storage.local.set({ vault_salt: saltBase64, vault_validator: validationToken });
        sessionKey = key;
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function unlockVault(masterPassword) {
    try {
        const { vault_salt, vault_validator } = await chrome.storage.local.get(["vault_salt", "vault_validator"]);
        if (!vault_salt) return { success: false, error: "No vault found" };

        const salt = base64ToArrayBuffer(vault_salt);
        const key = await deriveKey(masterPassword, salt);
        
        try {
            const check = await decryptData(vault_validator, key);
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
//  UPDATED DATA FETCHING
// ==========================================

async function getDecryptedCredentials() {
    if (!sessionKey) return { success: false, error: "Vault locked" };

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return { success: false, error: "Not logged in" };

    const allCredentials = [];

    // 1. Fetch PERSONAL Credentials (from 'credentials' table)
    const { data: personal, error: err1 } = await supabaseClient.rpc("get_credentials");
    if (!err1 && personal) {
        for (const item of personal) {
            try {
                const plain = await decryptData(item.password, sessionKey);
                allCredentials.push({ ...item, password: plain, is_shared: false });
            } catch (e) { /* Ignore decrypt errors */ }
        }
    }

    // 2. Fetch SHARED Credentials (from 'credential_shares' table)
    // We look for rows where 'shared_to' array contains my User ID
    const { data: shared, error: err2 } = await supabaseClient
        .from('credential_shares')
        .select('*')
        .contains('shared_to', [user.id]);

    if (!err2 && shared) {
        for (const item of shared) {
            try {
                // The encrypted blob for ME is stored in 'recipient_metadata' JSON
                // format: { "my_user_id": "iv:ciphertext" }
                const myEncryptedPass = item.recipient_metadata ? item.recipient_metadata[user.id] : null;
                
                if (myEncryptedPass) {
                    const plain = await decryptData(myEncryptedPass, sessionKey);
                    allCredentials.push({
                        id: item.id, // share id
                        site: item.site,
                        username: item.username,
                        password: plain,
                        color: "#ff9800", // Orange to indicate shared
                        is_shared: true
                    });
                }
            } catch (e) { console.error("Shared decrypt fail", e); }
        }
    }

    return { success: true, data: allCredentials };
}

// ==========================================
//  UPDATED SAVING LOGIC
// ==========================================

async function handleSavePassword(data) {
    // Saves to PERSONAL 'credentials' table (Logic unchanged)
    if (!sessionKey) return { success: false, error: "Vault locked" };
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return { success: false, error: "Not logged in" };

    // Check duplicates... (existing logic)
    const { data: existing } = await supabaseClient.from('credentials').select('id')
        .eq('site', data.site).eq('username', data.username).eq('user_id', user.id);
    if (existing?.length > 0) return { success: false, error: "Duplicate credential." };

    const encryptedPass = await encryptData(data.password, sessionKey);
    const { data: saved, error } = await supabaseClient.rpc("insert_credential", {
        p_site: data.site, p_username: data.username, p_password: encryptedPass,
        p_color: data.color, p_logo: data.icon
    });
    
    return { success: !error, error: error?.message };
}

// ==========================================
//  NEW: SAVE SHARED ACCESS
// ==========================================

async function saveShareAccess(data) {
    // This is called when the user CLICKS "Yes" on a shared link
    if (!sessionKey) return { success: false, error: "Vault locked. Please unlock extension." };
    const { data: { user } } = await supabaseClient.auth.getUser();
    
    try {
        // 1. Re-encrypt the raw password with MY Vault Key
        const myEncryptedPass = await encryptData(data.password, sessionKey);

        // 2. Prepare the update for 'credential_shares'
        // We need to fetch the existing metadata first to merge, or use JSONB update logic
        const { data: currentShare } = await supabaseClient
            .from('credential_shares')
            .select('shared_to, recipient_metadata')
            .eq('id', data.share_id)
            .single();

        if (!currentShare) throw new Error("Share not found");

        const updatedSharedTo = currentShare.shared_to.includes(user.id) 
            ? currentShare.shared_to 
            : [...currentShare.shared_to, user.id];
            
        const updatedMetadata = currentShare.recipient_metadata || {};
        updatedMetadata[user.id] = myEncryptedPass; // Save MY encrypted version

        // 3. Update the table
        const { error } = await supabaseClient
            .from('credential_shares')
            .update({
                shared_to: updatedSharedTo,
                recipient_metadata: updatedMetadata
            })
            .eq('id', data.share_id);

        if (error) throw error;
        return { success: true };

    } catch (err) {
        console.error("Save Share Error", err);
        return { success: false, error: err.message };
    }
}

// ==========================================
//  SHARING HELPERS
// ==========================================

async function createShare(item) {
    // Logic unchanged from previous "Correct" version
    // ... (Keep your createShare logic) ...
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const linkPassword = crypto.randomUUID(); 
        const salt = generateSalt();
        const key = await deriveKey(linkPassword, salt);
        
        const payload = JSON.stringify({
            s: item.site, u: item.username, p: item.password, c: item.color, i: item.logo || ""
        });
        
        const encryptedData = await encryptData(payload, key);
        const saltBase64 = arrayBufferToBase64(salt.buffer);

        const { data, error } = await supabaseClient
            .from('credential_shares')
            .insert({
                credential_id: item.id,
                share_by: user.id,
                shared_to: [],
                recipient_metadata: {}, // Start empty
                encrypted_data: encryptedData,
                salt: saltBase64
            })
            .select().single();

        if (error) throw error;
        return { success: true, link: `https://example.com/#share_id=${data.id}&key=${linkPassword}` };
    } catch (err) { return { success: false, error: err.message }; }
}

async function getMyShares() {
    // Logic unchanged
    const { data: { user } } = await supabaseClient.auth.getUser();
    if(!user) return { success: false };
    const { data, error } = await supabaseClient.from('credential_shares').select('*')
        .eq('share_by', user.id).order('created_at', {ascending:false});
    return { success: !error, data: data };
}

async function revokeShare(id) {
    const { error } = await supabaseClient.from('credential_shares').delete().eq('id', id);
    return { success: !error };
}

async function resolveSharedLink(shareId, linkPassword) {
    // Logic mostly unchanged: fetches the RAW blob using Link Key
    // Used ONLY for the initial "Preview"
    try {
        const { data, error } = await supabaseClient.from('credential_shares').select('*').eq('id', shareId).single();
        if (error || !data) return { success: false, error: "Link invalid" };

        const salt = base64ToArrayBuffer(data.salt);
        const key = await deriveKey(linkPassword, salt);
        const jsonString = await decryptData(data.encrypted_data, key);
        
        return { success: true, data: JSON.parse(jsonString) };
    } catch (e) { return { success: false, error: "Invalid Key" }; }
}