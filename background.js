import { supabaseClient } from "./supabaseClient.js";
import { 
    deriveKey, 
    generateSalt, 
    encryptData, 
    decryptData,
    arrayBufferToBase64, 
    base64ToArrayBuffer 
} from "./lib/crypto.js";

// --- IN-MEMORY KEY STORAGE ---
// This key is CLEARED when the browser/extension restarts or when locked manually.
let sessionKey = null;

// 1. LISTEN FOR EXTENSION ICON CLICKS (Toolbar)
chrome.action.onClicked.addListener((tab) => {
    if (tab && tab.id) {
        chrome.storage.local.set({ 'target_tab_id': tab.id }, () => {
            handleOpenPopup();
        });
    } else {
        handleOpenPopup();
    }
});

// 2. LISTEN FOR MESSAGES
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Return true to indicate we will sendResponse asynchronously
    if (handleMessage(message, sender, sendResponse)) {
        return true;
    }
});

async function handleMessage(message, sender, sendResponse) {
    try {
        switch (message.type) {
            case "SETUP_MASTER_PASSWORD":
                await handleSetup(message.password);
                sendResponse({ success: true });
                break;

            case "UNLOCK_VAULT":
                const success = await handleUnlock(message.password);
                sendResponse({ success });
                break;
            
            case "LOCK_VAULT":
                sessionKey = null;
                console.log(" [Background] Vault Locked");
                sendResponse({ success: true });
                break;

            case "CHECK_LOCK_STATUS":
                sendResponse({ isLocked: sessionKey === null });
                break;

            case "SAVE_PASSWORD":
                // If locked, open popup to force unlock
                if (!sessionKey) {
                    console.log(" [Background] Vault locked. Opening popup.");
                    if(sender.tab?.id) {
                         await chrome.storage.local.set({ 'target_tab_id': sender.tab.id });
                    }
                    handleOpenPopup();
                    return;
                }
                await handleSavePassword(message.data);
                break;

            case "OPEN_POPUP":
                if (sender.tab && sender.tab.id) {
                    await chrome.storage.local.set({ 'target_tab_id': sender.tab.id });
                }
                handleOpenPopup();
                break;
                
            case "DECRYPT_AND_FILL":
                if (!sessionKey) return; // Locked
                
                // Decrypt the password here in background
                const plainPass = await decryptData(message.encryptedPassword, sessionKey);
                
                // Send plain text ONLY to the specific content script tab
                chrome.tabs.sendMessage(message.tabId, {
                    type: "FILL_CREDENTIALS",
                    data: {
                        username: message.username,
                        password: plainPass
                    }
                });
                break;
        }
    } catch (err) {
        console.error("Background Error:", err);
        sendResponse({ success: false, error: err.message });
    }
}

// --- HANDLERS ---

function handleOpenPopup() {
    chrome.windows.create({
        url: "popup.html",
        type: "popup",
        width: 360,
        height: 600,
        focused: true
    });
}

async function handleSetup(password) {
    const salt = generateSalt();
    const key = await deriveKey(password, salt);

    // Create a "Validation Token" - encrypt the word "VALID"
    const validationToken = await encryptData("VALID", key);

    // Save Salt and Token to Disk (NEVER the password or key)
    await chrome.storage.local.set({
        auth_salt: arrayBufferToBase64(salt.buffer),
        auth_validator: validationToken
    });

    sessionKey = key; // Unlock immediately
    console.log(" [Background] Master Password Set & Vault Unlocked");
}

async function handleUnlock(password) {
    const stored = await chrome.storage.local.get(["auth_salt", "auth_validator"]);
    if (!stored.auth_salt || !stored.auth_validator) return false;

    try {
        const salt = new Uint8Array(base64ToArrayBuffer(stored.auth_salt));
        const key = await deriveKey(password, salt);

        // Try to decrypt the validator
        const check = await decryptData(stored.auth_validator, key);

        if (check === "VALID") {
            sessionKey = key; 
            console.log(" [Background] Vault Unlocked");
            return true;
        }
    } catch (e) {
        // Decryption failed = Wrong password
    }
    return false;
}

async function handleSavePassword(data) {
    if (!sessionKey) return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Encrypt password before sending to Supabase
    const encryptedPassword = await encryptData(data.password, sessionKey);

    const { data: savedData, error } = await supabaseClient.rpc("insert_credential", {
        p_site: data.site,
        p_username: data.username,
        p_password: encryptedPassword, // Storing encrypted string
        p_color: data.color || "",
        p_logo: data.icon || "", 
    });
    
    if (error) console.error("Supabase Save Error:", error);
    else console.log("Saved successfully:", savedData);
}