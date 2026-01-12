import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error('Missing authorization header')
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - missing authorization' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Create Supabase client and verify user
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      console.error('Authentication failed:', authError?.message || 'No user found')
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - invalid token' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    console.log(`Authenticated user: ${user.id}`)

    // Parse and validate input
    const body = await req.json()
    const { pergunta_original, resposta_ia, voto } = body

    // Input validation
    if (!pergunta_original || typeof pergunta_original !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid input: pergunta_original is required and must be a string' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (!resposta_ia || typeof resposta_ia !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid input: resposta_ia is required and must be a string' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (!voto || !['positivo', 'negativo'].includes(voto)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid input: voto must be "positivo" or "negativo"' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Enforce length limits
    const maxQuestionLength = 5000
    const maxResponseLength = 50000

    if (pergunta_original.length > maxQuestionLength) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid input: pergunta_original exceeds ${maxQuestionLength} characters` }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (resposta_ia.length > maxResponseLength) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid input: resposta_ia exceeds ${maxResponseLength} characters` }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log(`Processing feedback from user ${user.id}: voto=${voto}`)

    // Forward to n8n webhook
    const response = await fetch('https://n8n.vetorix.com.br/webhook-test/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pergunta_original,
        resposta_ia,
        voto,
        user_id: user.id, // Include user ID for tracking
      }),
    })

    const data = await response.text()
    console.log('Feedback sent successfully to n8n webhook')

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error sending feedback:', errorMessage)
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
