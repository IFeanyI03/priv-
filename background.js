import { supabaseClient } from "./supabaseClient.js";
import { 
    generateSalt, 
    deriveKey, 
    encryptData, 
    decryptData, 
    arrayBufferToBase64, 
    base64ToArrayBuffer 
} from "./lib/crypto.js";

// 1. LISTEN for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    // --- Existing Handlers ---
    if (message.type === "SAVE_PASSWORD") {
        console.log(" [Background] Saving Password...");
        handleSavePassword(message.data).then(() => sendResponse({ success: true }));
        return true; 
    } 
    else if (message.type === "OPEN_POPUP") {
        if (sender.tab && sender.tab.id) {
            chrome.storage.local.set({ 'target_tab_id': sender.tab.id }, () => {
                handleOpenPopup();
            });
        } else {
            handleOpenPopup();
        }
    }
    
    // --- NEW: Share Handlers ---
    else if (message.type === "CREATE_SHARE") {
        createShare(message.data).then(sendResponse);
        return true; // Async response
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

// ---------------------------------------------------------
// EXISTING FUNCTIONS
// ---------------------------------------------------------

async function handleSavePassword(data) {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
        console.error(" [Background] Auth Error or No User:", authError);
        return;
    }

    const { data: savedData, error } = await supabaseClient.rpc(
        "insert_credential",
        {
            p_site: data.site,
            p_username: data.username,
            p_password: data.password,
            p_color: data.color || "",
            p_logo: data.icon || "", 
        }
    );

    if (error) {
        console.error(" [Supabase Error] Details:", JSON.stringify(error, null, 2));
    } else {
        console.log(" [Success] Saved Data via RPC:", savedData);
    }
}

function handleOpenPopup() {
    chrome.windows.create({
        url: "popup.html",
        type: "popup",
        width: 360,
        height: 600,
        focused: true 
    });
}

// ---------------------------------------------------------
// NEW SHARE FUNCTIONS
// ---------------------------------------------------------

// 1. CREATE SHARE (Uploads to DB)
async function createShare(item) {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return { success: false, error: "Not logged in" };

        // A. Generate a random One-Time Password (OTP)
        const linkPassword = crypto.randomUUID(); 
        const salt = generateSalt();
        const key = await deriveKey(linkPassword, salt);
        
        // B. Prepare Payload
        const payload = JSON.stringify({
            s: item.site,
            u: item.username,
            p: item.password, 
            c: item.color,
            i: item.logo || ""
        });
        
        const encryptedData = await encryptData(payload, key);
        const saltBase64 = arrayBufferToBase64(salt.buffer);

        // C. Upload to Supabase 'credential_shares' table
        const { data, error } = await supabaseClient
            .from('credential_shares')
            .insert({
                credential_id: item.id, // Links to original credential
                share_by: user.id,
                shared_to: [],          // Starts empty
                encrypted_data: encryptedData,
                salt: saltBase64
            })
            .select()
            .single();

        if (error) throw error;

        // D. Create URL
        // Key is in the hash, so it is NOT sent to the server.
        const shareUrl = `https://example.com/#share_id=${data.id}&key=${linkPassword}`;
        
        return { success: true, link: shareUrl };

    } catch (err) {
        console.error("Share Error:", err);
        return { success: false, error: err.message };
    }
}

// 2. GET SHARES (For "My Links" tab)
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

// 3. REVOKE SHARE (Delete from DB)
async function revokeShare(shareId) {
    const { error } = await supabaseClient
        .from('credential_shares')
        .delete()
        .eq('id', shareId);
    
    return { success: !error, error: error?.message };
}

// 4. RESOLVE LINK (For Receiver)
async function resolveSharedLink(shareId, linkPassword) {
    try {
        // A. Get Receiver User
        const { data: { user } } = await supabaseClient.auth.getUser();
        
        // B. Fetch Encrypted Data
        const { data, error } = await supabaseClient
            .from('credential_shares')
            .select('*')
            .eq('id', shareId)
            .single();

        if (error || !data) return { success: false, error: "Link revoked or not found" };

        // C. Decrypt locally
        const salt = base64ToArrayBuffer(data.salt);
        const key = await deriveKey(linkPassword, salt);
        const jsonString = await decryptData(data.encrypted_data, key);
        
        if (!jsonString) throw new Error("Decryption failed");

        // D. Update Access List (shared_to)
        if (user && !data.shared_to.includes(user.id)) {
            const updatedList = [...data.shared_to, user.id];
            
            // Fire and forget update
            supabaseClient
                .from('credential_shares')
                .update({ shared_to: updatedList })
                .eq('id', shareId)
                .then(res => {
                    if(res.error) console.error("Failed to update access list", res.error);
                });
        }

        return { success: true, data: JSON.parse(jsonString) };

    } catch (err) {
        console.error(err);
        return { success: false, error: "Invalid Key or Data Corrupted" };
    }
}