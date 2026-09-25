// Shared Teams backend (Supabase). Leave empty to run in solo mode only.
// The anon key is designed to be public; row level security in
// supabase/schema.sql is what keeps each team's data private.
window.FOODIE_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
