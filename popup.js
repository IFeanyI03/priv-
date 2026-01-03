import { supabaseClient } from './supabaseClient.js';

const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
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
    loadPasswords();
  } else {
    showAuth();
  }
}

async function handleGoogleLogin() {
  msgDiv.innerText = "Launching Google Login...";

  // 1. Ask Supabase for the Google OAuth URL
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: chrome.identity.getRedirectURL(),
      skipBrowserRedirect: true // Crucial: Gives us the URL instead of redirecting
    }
  });

  if (error) {
    msgDiv.innerText = "Error: " + error.message;
    return;
  }

  // 2. Launch Chrome's native login window
  chrome.identity.launchWebAuthFlow(
    {
      url: data.url,
      interactive: true
    },
    async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        msgDiv.innerText = "Login Cancelled.";
        return;
      }

      // 3. Parse tokens from the redirect URL
      // URL looks like: https://<id>.chromiumapp.org/#access_token=...&refresh_token=...
      const urlObj = new URL(redirectUrl);
      const params = new URLSearchParams(urlObj.hash.substring(1)); // Remove the '#'
      
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (!accessToken) {
        msgDiv.innerText = "No token found.";
        return;
      }

      // 4. Save session to Supabase
      const { error: sessionError } = await supabaseClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (sessionError) {
        msgDiv.innerText = "Session Error: " + sessionError.message;
      } else {
        checkUser(); // Refresh UI
      }
    }
  );
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  checkUser();
}

async function loadPasswords() {
  const listElement = document.getElementById("password-list");
  listElement.innerHTML = "Loading...";

  const { data: passwords, error } = await supabaseClient
    .from('passwords')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    listElement.innerText = "Error loading.";
    return;
  }

  listElement.innerHTML = "";
  if (passwords.length === 0) {
    listElement.innerHTML = "<i>No passwords saved yet.</i>";
    return;
  }

  passwords.forEach(item => {
    const div = document.createElement("div");
    div.className = "bookmark";
    div.style.padding = "8px";
    div.style.borderBottom = "1px solid #ccc";
    div.innerHTML = `<b>${item.site}</b><br><small>${item.username}</small>`;
    listElement.appendChild(div);
  });
}

function showApp() {
  authSection.style.display = 'none';
  appSection.style.display = 'block';
}

function showAuth() {
  authSection.style.display = 'block';
  appSection.style.display = 'none';
}