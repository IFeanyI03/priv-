import { supabaseClient } from './supabaseClient.js';

const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const listElement = document.getElementById("password-list");
const msgDiv = document.getElementById('auth-message');

document.addEventListener('DOMContentLoaded', () => {
  checkUser();
  document.getElementById('btn-google-login').addEventListener('click', handleGoogleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
});

async function checkUser() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showApp();
    loadCredentials(); // Renamed function for clarity
  } else {
    showAuth();
  }
}

async function loadCredentials() {
  listElement.innerHTML = "Loading...";

  // Changed table to 'credentials'
  const { data: credentials, error } = await supabaseClient
    .from('credentials')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    listElement.innerText = "Error loading credentials.";
    console.error(error);
    return;
  }

  listElement.innerHTML = "";
  
  if (!credentials || credentials.length === 0) {
    listElement.innerHTML = "<i style='text-align:center; display:block; margin-top:20px; color:#888;'>No credentials saved yet.</i>";
    return;
  }

  credentials.forEach(item => {
    const div = document.createElement("div");
    div.className = "bookmark";
    // Inline styles for a cleaner card look
    div.style.cssText = "background: white; padding: 10px; margin-bottom: 8px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);";
    
    div.innerHTML = `
      <div style="font-weight: bold; font-size: 14px;">${item.site}</div>
      <div style="font-size: 12px; color: #555;">${item.username}</div>
      <div style="font-size: 10px; color: #999; margin-top: 4px;">Password hidden</div>
    `;
    listElement.appendChild(div);
  });
}

// ... Keep your handleGoogleLogin, handleLogout, showApp, and showAuth functions exactly as they were ...
// (Providing them below just in case)

async function handleGoogleLogin() {
  msgDiv.innerText = "Launching Google Login...";
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: chrome.identity.getRedirectURL(),
      skipBrowserRedirect: true
    }
  });
  if (error) {
    msgDiv.innerText = "Error: " + error.message;
    return;
  }
  chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, async (redirectUrl) => {
    if (chrome.runtime.lastError || !redirectUrl) {
      msgDiv.innerText = "Login Cancelled.";
      return;
    }
    const urlObj = new URL(redirectUrl);
    const params = new URLSearchParams(urlObj.hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken) {
      msgDiv.innerText = "No token found.";
      return;
    }
    const { error: sessionError } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (sessionError) msgDiv.innerText = sessionError.message;
    else checkUser();
  });
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  checkUser();
}

function showApp() {
  authSection.style.display = 'none';
  appSection.style.display = 'block';
}

function showAuth() {
  authSection.style.display = 'block';
  appSection.style.display = 'none';
}