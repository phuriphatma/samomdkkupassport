// js/app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// GET THESE FROM VITE ENVIRONMENT VARIABLES
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper to update UI after login
export function setAuthUI(user) {
  const loginBtn = document.getElementById("login-btn");
  const userDisplay = document.getElementById("user-display");
  if (user) {
    if (loginBtn) loginBtn.style.display = "none";
    if (userDisplay) {
      userDisplay.style.display = "block";
      userDisplay.innerText = user.email;
    }
  } else {
    if (loginBtn) loginBtn.style.display = "block";
    if (userDisplay) userDisplay.style.display = "none";
  }
}
