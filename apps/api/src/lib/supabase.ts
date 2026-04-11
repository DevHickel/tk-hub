import { createClient } from '@supabase/supabase-js'

// Backend usa service key — bypassa RLS (auth já foi validada no middleware)
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)
