import { supabaseClient } from "./supabaseClient.js";

// 1. LISTEN for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SAVE_PASSWORD") {
        console.log(" [Background] Message received:", message.data);
        handleSavePassword(message.data);
    } 
    else if (message.type === "OPEN_POPUP") {
        // --- KEY FIX: Save the ID of the tab that requested the popup ---
        if (sender.tab && sender.tab.id) {
            chrome.storage.local.set({ 'target_tab_id': sender.tab.id }, () => {
                handleOpenPopup();
            });
        } else {
            handleOpenPopup();
        }
    }
});

// 2. SAVE to Supabase via RPC
async function handleSavePassword(data) {
    const {
        data: { user },
        error: authError,
    } = await supabaseClient.auth.getUser();

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
        if (savedData && savedData.status === 'exists') {
             console.log("Duplicate ignored:", savedData.message);
        } else {
             console.log(" [Success] Saved Data via RPC:", savedData);
        }
    }
}

// 3. HANDLE OPENING POPUP
function handleOpenPopup() {
    // Opens a clean 'popup' type window (MetaMask style)
    chrome.windows.create({
        url: "popup.html",
        type: "popup",
        width: 360,
        height: 600,
        // 'focused: true' ensures it pops to the front
        focused: true 
    });
}