import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteRequest {
  email: string;
  invitedBy: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, invitedBy }: InviteRequest = await req.json();

    console.log(`Processing invite for email: ${email}, invited by: ${invitedBy}`);

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email é obrigatório" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existingUsers?.users?.some(u => u.email === email);
    
    if (userExists) {
      return new Response(
        JSON.stringify({ error: "Este email já está cadastrado" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if there's a pending invite
    const { data: existingInvite } = await supabaseAdmin
      .from("invites")
      .select("*")
      .eq("email", email)
      .eq("status", "pending")
      .single();

    if (existingInvite) {
      return new Response(
        JSON.stringify({ error: "Este email já possui um convite pendente" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate invite token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

    // Create invite record
    const { error: insertError } = await supabaseAdmin
      .from("invites")
      .insert({
        email,
        invited_by: invitedBy,
        token,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Error creating invite:", insertError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar convite" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get the site URL from the request origin or use a default
    const origin = req.headers.get("origin") || "https://bzhfeqdwxdmvydrdsdno.lovable.app";
    const inviteLink = `${origin}/register?token=${token}&email=${encodeURIComponent(email)}`;

    // Send invite email using Supabase Auth
    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteLink,
      data: {
        invite_token: token,
      },
    });

    if (inviteError) {
      console.error("Error sending invite email:", inviteError);
      // Even if email fails, the invite was created, so user can use the link manually
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: "Convite criado, mas houve erro ao enviar email. Use o link manualmente.",
          inviteLink,
          token 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Invite sent successfully to ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Convite enviado com sucesso!",
        token 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in send-invite function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro interno do servidor" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
