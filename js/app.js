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

// ── The legacy-admin client ──────────────────────────────────────────────────
// The temporary admin/1234 door needs a REAL Supabase session, because the
// database can only grant rights to an identity it can verify (see
// js/admin-scope.js for the whole story). It signs into ONE shared account.
//
// It gets its OWN client with its OWN storageKey, deliberately. Sessions are
// keyed by storageKey in localStorage, so sharing the default key would mean an
// organiser opening the admin panel silently replaces their own Google session
// on that browser — logging them out of their personal passport, and swapping
// the identity the dashboard and scan pages see. Two keys, two independent
// sessions, no interference in either direction.
let legacyClient = null;
export function getLegacyAdminClient() {
    if (!legacyClient) {
        legacyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            db: { schema: "passport" },
            auth: { storageKey: "sb-passport-legacy-admin", detectSessionInUrl: false },
        });
    }
    return legacyClient;
}

// ── adminDb: which client the admin panel's DATA calls should use ─────────────
// A live binding, so reassigning it here updates every importer (ES modules
// export bindings, not copies). admin-page.js does its reads/writes through
// `adminDb` and its Google sign-in through `supabase`, so one line switches the
// whole panel onto the legacy session without touching 20 call sites.
export let adminDb = supabase;
export function useLegacyAdminDb() { adminDb = getLegacyAdminClient(); }
export function useNormalAdminDb() { adminDb = supabase; }

