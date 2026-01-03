// supabaseClient.js
import './lib/supabase.js'; 
import config from './config.js';

const { createClient } = supabase; 

// Use the variables from the config file
export const supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});