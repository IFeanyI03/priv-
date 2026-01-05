import { supabaseClient } from './supabaseClient.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_PASSWORD") {
    handleSavePassword(message.data);
  }
});

async function handleSavePassword(data) {
  
  const { data: { user } } = await supabaseClient.auth.getUser();

  if (!user) {
    console.log("User not logged in. Cannot save.");
    return;
  }

  const { data: savedData, error } = await supabaseClient
    .from('credentials')
    .insert([
      {
        site: data.site,
        username: data.username,
        password: data.password,
        user_id: user.id 
      }
    ])
    .select(); 

  if (error) {
    console.error("Error saving credential:", error);
  } else {
    console.log("Credential saved to cloud!", savedData);
  }
}