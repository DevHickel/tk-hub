export function buildInviteEmail(link: string, inviterName: string): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;margin:0;padding:0;background:#f5f5f5}
  .w{max-width:560px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .hd{background:#1E293B;padding:24px 32px;color:#fff}
  .hd h1{margin:0;font-size:18px;font-weight:600}
  .body{padding:32px}
  .body p{font-size:14px;line-height:1.6;color:#1a1a1a;margin:0 0 16px}
  .btn{display:inline-block;background:#3B82F6;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:8px 0}
  .note{font-size:12px;color:#64748B;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb}
  .ft{background:#F8FAFC;padding:16px 32px;font-size:11px;color:#64748B;text-align:center}
</style></head>
<body><div class="w">
  <div class="hd"><h1>TK Solution — Convite</h1></div>
  <div class="body">
    <p>Olá!</p>
    <p><strong>${inviterName}</strong> convidou você para acessar a plataforma TK Solution.</p>
    <p>Para criar sua conta, clique no botão abaixo:</p>
    <p style="text-align:center;margin:24px 0"><a href="${link}" class="btn">Criar minha conta</a></p>
    <p class="note">Este convite expira em <strong>7 dias</strong>. Se você não esperava receber este e-mail, pode ignorá-lo com segurança.</p>
  </div>
  <div class="ft">TK Solution — Plataforma de gestão</div>
</div></body></html>`
}
