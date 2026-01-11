import { supabaseClient } from "./supabaseClient.js";

// 1. LISTEN FOR EXTENSION ICON CLICKS (Toolbar)
chrome.action.onClicked.addListener((tab) => {
    // When the icon is clicked, save the current tab ID and open the window
    if (tab && tab.id) {
        chrome.storage.local.set({ 'target_tab_id': tab.id }, () => {
            handleOpenPopup();
        });
    } else {
        handleOpenPopup();
    }
});

// 2. LISTEN FOR MESSAGES (Content Script)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SAVE_PASSWORD") {
        console.log(" [Background] Message received:", message.data);
        handleSavePassword(message.data);
    } 
    else if (message.type === "OPEN_POPUP") {
        // When requested by content script, save that tab's ID and open the window
        if (sender.tab && sender.tab.id) {
            chrome.storage.local.set({ 'target_tab_id': sender.tab.id }, () => {
                handleOpenPopup();
            });
        } else {
            handleOpenPopup();
        }
    }
});

// 3. COMMON FUNCTION TO OPEN THE WINDOW
function handleOpenPopup() {
    chrome.windows.create({
        url: "popup.html",
        type: "popup",
        width: 360,
        height: 600,
        focused: true
    });
}

// 4. SAVE PASSWORD LOGIC
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