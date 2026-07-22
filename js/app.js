// js/app.js
import { createClient } from "@supabase/supabase-js";

// GET THESE FROM VITE ENVIRONMENT VARIABLES
// Merged into samoweb's Supabase project A (fheueuowbchsnsvbcgil) for single
// sign-on. Passport data lives in the isolated `passport` schema of that
// project (NOT `public`). The fallbacks below are project A on purpose — if the
// build env is missing they must NOT fall back to the retired project B, or the
// app would split-brain (write to B while the DB of record is A).
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "https://fheueuowbchsnsvbcgil.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoZXVldW93YmNoc25zdmJjZ2lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MjU4MjMsImV4cCI6MjA5NTAwMTgyM30.m_xNPmSX4W_UuI4K_pIqixK61CGmoIpmBjnFNHktb0w";

export let supabase;
try {
    // `db.schema: 'passport'` routes every supabase.from(...) to the passport
    // schema (all query surfaces: activities/scans/profiles/samo_seasons/
    // samo_years/certificates/user_tiers). Auth stays on the shared project.
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "passport" } });
} catch (err) {
    console.error("Failed to initialize Supabase:", err);
}

