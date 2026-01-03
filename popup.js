import { supabase } from './supabaseClient.js';

// DOM Elements
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');
const msgDiv = document.getElementById('auth-message');

document.addEventListener('DOMContentLoaded', async () => {
  checkUser();

  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-signup').addEventListener('click', handleSignup);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
});

async function checkUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    showApp();
    loadPasswords();
  } else {
    showAuth();
  }
}

async function handleLogin() {
  const email = emailInput.value;
  const password = passInput.value;
  
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) msgDiv.innerText = error.message;
  else checkUser();
}

async function handleSignup() {
  const email = emailInput.value;
  const password = passInput.value;

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) msgDiv.innerText = error.message;
  else msgDiv.innerText = "Check your email for confirmation link!";
}

async function handleLogout() {
  await supabase.auth.signOut();
  checkUser();
}

// ------------------------------------------
//  DATA FETCHING
// ------------------------------------------
async function loadPasswords() {
  const listElement = document.getElementById("password-list");
  listElement.innerHTML = "Loading...";

  const { data: passwords, error } = await supabase
    .from('passwords')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    listElement.innerText = "Error loading passwords.";
    return;
  }

  listElement.innerHTML = "";
  
  passwords.forEach(item => {
    // ... Use your existing UI generation code here ...
    // Example:
    const div = document.createElement("div");
    div.className = "bookmark";
    div.innerHTML = `<b>${item.site}</b><br>${item.username}`;
    listElement.appendChild(div);
  });
}

// UI Toggles
function showApp() {
  authSection.style.display = 'none';
  appSection.style.display = 'block';
}
function showAuth() {
  authSection.style.display = 'block';
  appSection.style.display = 'none';
}