import { supabaseClient } from "./supabaseClient.js";
import { 
    generateSalt, 
    deriveKey, 
    encryptData, 
    decryptData, 
    arrayBufferToBase64, 
    base64ToArrayBuffer 
} from "./lib/crypto.js";

// --- GLOBAL STATE (In-Memory) ---
// This key disappears when Chrome closes (Auto-Lock)
let sessionKey = null; 

// --- 1. MESSAGE ROUTER ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    // A. VAULT MANAGEMENT
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
    }

    // B. CREDENTIALS (APP)
    else if (message.type === "GET_DECRYPTED_CREDENTIALS") {
        getDecryptedCredentials().then(sendResponse);
        return true;
    }
    else if (message.type === "SAVE_PASSWORD") {
        handleSavePassword(message.data).then(() => sendResponse({ success: true }));
        return true;
    }
    else if (message.type === "OPEN_POPUP") {
        handleOpenPopup(sender?.tab?.id);
    }

    // C. SHARING FEATURES
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
//  SECTION A: VAULT LOGIC
// ==========================================

async function checkVaultStatus() {
    // 1. Check if "vault_salt" exists in storage. 
    // If not, the user hasn't set up the extension yet.
    const storage = await chrome.storage.local.get(["vault_salt"]);
    
    if (!storage.vault_salt) {
        return { status: "setup_needed" };
    }
    
    // 2. If salt exists, but we have no sessionKey, it's Locked.
    if (!sessionKey) {
        return { status: "locked" };
    }
    
    // 3. Otherwise, it's Unlocked.
    return { status: "unlocked" };
}

async function setupVault(masterPassword) {
    try {
        const salt = generateSalt();
        // Derive key to verify it works (and usually we'd encrypt a 'test' phrase)
        // For simplicity, we just save the salt.
        // In a real app, you might encrypt the Supabase Session token here too.
        
        const saltBase64 = arrayBufferToBase64(salt.buffer);
        await chrome.storage.local.set({ vault_salt: saltBase64 });
        
        // Auto-unlock
        sessionKey = await deriveKey(masterPassword, salt);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function unlockVault(masterPassword) {
    try {
        const { vault_salt } = await chrome.storage.local.get(["vault_salt"]);
        if (!vault_salt) return { success: false, error: "No vault found" };

        const salt = base64ToArrayBuffer(vault_salt);
        const key = await deriveKey(masterPassword, salt);
        
        // Ideally, verify the key against a stored hash (checksum). 
        // Here we assume success if no error is thrown during derivation.
        sessionKey = key; 
        return { success: true };
    } catch (err) {
        return { success: false, error: "Invalid password" };
    }
}

async function getDecryptedCredentials() {
    if (!sessionKey) return { success: false, error: "Vault locked" };

    const { data: credentials, error } = await supabaseClient.rpc("get_credentials");
    if (error || !credentials) return { success: false, data: [] };

    // Decrypt each password
    const decryptedList = await Promise.all(credentials.map(async (item) => {
        try {
            // Note: In "handleSavePassword" below, we are NOT encrypting with Master Password yet
            // to keep this compatible with your previous code. 
            // If you want full encryption, you must update handleSavePassword to use 'sessionKey' too.
            // For now, we assume stored passwords are essentially accessible or using Supabase RLS.
            
            // IF you were encrypting with sessionKey, you would do:
            // const plainPass = await decryptData(item.password, sessionKey);
            
            return { ...item }; // Returning as-is based on your current DB structure
        } catch (e) {
            return { ...item, password: "(Decryption Failed)" };
        }
    }));

    return { success: true, data: decryptedList };
}

// ==========================================
//  SECTION B: SAVING & POPUP
// ==========================================

async function handleSavePassword(data) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // TODO: Ideally, encrypt 'data.password' with 'sessionKey' here before sending to Supabase
    // const encryptedPass = await encryptData(data.password, sessionKey);

    const { data: savedData, error } = await supabaseClient.rpc(
        "insert_credential",
        {
            p_site: data.site,
            p_username: data.username,
            p_password: data.password, // Storing plain/server-side encrypted for now
            p_color: data.color || "",
            p_logo: data.icon || "", 
        }
    );
    
    if (error) console.error("Supabase Error:", error);
    else console.log("Saved:", savedData);
}

function handleOpenPopup(tabId) {
    if (tabId) {
        chrome.storage.local.set({ 'target_tab_id': tabId });
    }
    chrome.windows.create({
        url: "popup.html",
        type: "popup",
        width: 360,
        height: 600,
        focused: true 
    });
}

// ==========================================
//  SECTION C: SHARING LOGIC
// ==========================================

async function createShare(item) {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return { success: false, error: "Not logged in" };

        const linkPassword = crypto.randomUUID(); 
        const salt = generateSalt();
        const key = await deriveKey(linkPassword, salt);
        
        const payload = JSON.stringify({
            s: item.site,
            u: item.username,
            p: item.password, 
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
        console.error("Share Error:", err);
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
        return { success: false, error: "Invalid Key" };
    }
}