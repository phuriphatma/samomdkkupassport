// js/app.js
import { createClient } from "@supabase/supabase-js";

// GET THESE FROM VITE ENVIRONMENT VARIABLES
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "https://idwlabpbwiwgaoqwbozz.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlkd2xhYnBid2l3Z2FvcXdib3p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDI4MDMsImV4cCI6MjA5NDA3ODgwM30.xMlAljPFiX0ghdUHhXQKPxjOl4zYtCCED-7uhi3BqmA";

export let supabase;
try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
    console.error("Failed to initialize Supabase:", err);
}

