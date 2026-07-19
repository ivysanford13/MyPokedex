// Supabase client used for auth (signup, login, token verification).
// This uses the anon key, which is safe to use server-side for auth flows
// (it's the same key that would be used in a browser).
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn(
    "Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing from .env — auth routes will fail."
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = supabase;