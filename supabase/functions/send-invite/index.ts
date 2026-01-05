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

    // Check if user already exists in auth.users
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existingUsers?.users?.some(u => u.email === email);
    
    if (userExists) {
      return new Response(
        JSON.stringify({ error: "Este email já está cadastrado" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get the site URL from environment variable (REQUIRED)
    const siteUrl = Deno.env.get("SITE_URL");
    if (!siteUrl) {
      console.error("SITE_URL environment variable is not configured");
      return new Response(
        JSON.stringify({ error: "Configuração de URL do site ausente. Configure a variável SITE_URL." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
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
      // Return the existing invite link instead of creating a new one
      const existingLink = `${siteUrl}/register?token=${existingInvite.token}&email=${encodeURIComponent(email)}`;
      return new Response(
        JSON.stringify({ 
          error: "Este email já possui um convite pendente",
          inviteLink: existingLink 
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate invite token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

    // Create invite record with status EXPLICITLY set to 'pending'
    const { data: insertedInvite, error: insertError } = await supabaseAdmin
      .from("invites")
      .insert({
        email: email,
        invited_by: invitedBy,
        token: token,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating invite:", insertError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar convite" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Invite created with status:", insertedInvite?.status);

    // Build invite link using the configured SITE_URL
    const inviteLink = `${siteUrl}/register?token=${token}&email=${encodeURIComponent(email)}`;

    // Use Supabase Auth generateLink to create a signup link WITHOUT creating the user
    // This generates a magic link that can be sent via email
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: email,
      options: {
        redirectTo: inviteLink,
        data: {
          invite_token: token,
        },
      },
    });

    if (linkError) {
      console.error("Error generating link:", linkError);
      // Even if link generation fails, the invite was created
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: "Convite criado! Copie o link manualmente para enviar ao usuário.",
          inviteLink,
          token 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Invite created successfully for ${email}`);
    console.log(`Invite link: ${inviteLink}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Convite criado com sucesso! Envie o link para o usuário.",
        inviteLink,
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
