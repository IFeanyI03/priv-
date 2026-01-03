import { supabase } from './supabaseClient.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_PASSWORD") {
    handleSavePassword(message.data);
  }
});

async function handleSavePassword(data) {
  // 1. Check if user is logged in
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    console.log("User not logged in. Cannot save.");
    // Optional: Send notification to user to login
    return;
  }

  // 2. Insert into Supabase
  const { error } = await supabase
    .from('passwords')
    .insert({
      site: data.site,
      username: data.username,
      password: data.password,
      user_id: user.id 
    });

  if (error) {
    console.error("Error saving password:", error);
  } else {
    console.log("Password saved to cloud!");
  }
}