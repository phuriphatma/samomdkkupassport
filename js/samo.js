// js/samo.js — SamoYear (วาระสโม) / Season helpers.
// "Current" = the single open row where ended_at IS NULL. These degrade to null
// if the tables don't exist yet (migration db/0006 not run), so the app keeps
// working and scans just land in the "unassigned" bucket until a year is declared.
import { supabase } from './app.js';

export async function getCurrentYear() {
    const { data, error } = await supabase
        .from('samo_years').select('*')
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1);
    if (error) return null;
    return (data && data[0]) || null;
}

export async function getCurrentSeason(yearId) {
    let q = supabase.from('samo_seasons').select('*')
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1);
    if (yearId) q = q.eq('samo_year_id', yearId);
    const { data, error } = await q;
    if (error) return null;
    return (data && data[0]) || null;
}

export async function getCurrentContext() {
    const year = await getCurrentYear();
    const season = year ? await getCurrentSeason(year.id) : null;
    return { year, season };
}
