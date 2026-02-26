
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

console.log('DEBUG: SUPABASE_URL:', process.env.SUPABASE_URL ? 'FOUND' : 'MISSING');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase URL or Key in environment variables');
}

let supabase = null;
if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('✅ Supabase client initialized');
    } catch (err) {
        console.error('❌ Failed to initialize Supabase client:', err.message);
    }
}

module.exports = supabase;
