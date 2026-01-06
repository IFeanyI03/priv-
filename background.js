import { supabaseClient } from "./supabaseClient.js";

// 1. LISTEN for the save message
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SAVE_PASSWORD") {
        console.log(" [Background] Message received:", message.data);
        handleSavePassword(message.data);
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

    // FIX: Changed 'p_icon' to 'p_logo' to match your SQL function
    const { data: savedData, error } = await supabaseClient.rpc(
        "insert_credential",
        {
            p_site: data.site,
            p_username: data.username,
            p_password: data.password,
            p_color: data.color || "",
            p_logo: data.icon || "", // <--- This maps the JS 'icon' to SQL 'p_logo'
        }
    );

    if (error) {
        console.error(
            " [Supabase Error] Details:",
            JSON.stringify(error, null, 2)
        );
    } else {
        console.log(" [Success] Saved Data via RPC:", savedData);
    }
}
