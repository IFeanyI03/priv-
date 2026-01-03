// 1. Import 'supabase' from the default export we just added
import supabase from './lib/supabase.js'; 
import config from './config.js';

const { createClient } = supabase; 

// Custom Adapter for Chrome Extension Storage
const chromeStorageAdapter = {
  getItem: (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  },
  setItem: (key, value) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  },
  removeItem: (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => resolve());
    });
  },
};

// 2. Create and Export 'supabaseClient'
export const supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  }
});