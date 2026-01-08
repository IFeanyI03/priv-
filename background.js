import { supabaseClient } from "./supabaseClient.js";

// 1. LISTEN for messages from contentScript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SAVE_PASSWORD") {
        console.log(" [Background] Message received:", message.data);
        handleSavePassword(message.data);
    } 
    else if (message.type === "OPEN_POPUP") {
        console.log(" [Background] Opening Extension Popup Window");
        handleOpenPopup();
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

    console.log(" [Background] Saving for User ID:", user.id);

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
        console.error(
            " [Supabase Error] Details:",
            JSON.stringify(error, null, 2)
        );
    } else {
        // Optional: Check custom status if you implemented the existence check
        if (savedData && savedData.status === 'exists') {
             console.log("Duplicate ignored:", savedData.message);
        } else {
             console.log(" [Success] Saved Data via RPC:", savedData);
        }
    }
}

// 3. HANDLE OPENING POPUP (As a window)
function handleOpenPopup() {
    chrome.windows.create({
        url: "popup.html",
        type: "popup",
        width: 360,
        height: 600,
        focused: true
    });
}