// Templates de email — strings fixas, zero IA (dms/SKILL.md)

export function getExpiryTemplate(docName: string, dias: number, colaborador: string): string {
  const plural = dias > 1 ? 's' : ''
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 0; background: #f5f5f5; }
  .wrapper { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .header { background: #1E293B; padding: 24px 32px; }
  .header h1 { color: #fff; margin: 0; font-size: 20px; }
  .body { padding: 32px; }
  .alert { background: ${dias <= 7 ? '#FEF2F2' : '#FFFBEB'}; border-left: 4px solid ${dias <= 7 ? '#EF4444' : '#F59E0B'}; padding: 16px; border-radius: 4px; margin: 24px 0; }
  .alert p { margin: 0; font-size: 15px; }
  .detail { background: #F8FAFC; padding: 16px; border-radius: 4px; margin: 16px 0; }
  .detail table { width: 100%; border-collapse: collapse; }
  .detail td { padding: 6px 0; font-size: 14px; }
  .detail td:first-child { color: #64748B; width: 40%; }
  .footer { background: #F8FAFC; padding: 16px 32px; font-size: 12px; color: #94A3B8; text-align: center; }
  a.btn { display: inline-block; background: #1E293B; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; margin-top: 24px; }
</style></head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>TK Solution — Alerta de Vencimento</h1>
    </div>
    <div class="body">
      <p>Olá,</p>
      <div class="alert">
        <p>O documento <strong>${docName}</strong> do colaborador <strong>${colaborador}</strong>
        vence em <strong>${dias} dia${plural}</strong>.</p>
      </div>
      <div class="detail">
        <table>
          <tr><td>Documento</td><td><strong>${docName}</strong></td></tr>
          <tr><td>Colaborador</td><td><strong>${colaborador}</strong></td></tr>
          <tr><td>Vence em</td><td><strong>${dias} dia${plural}</strong></td></tr>
        </table>
      </div>
      <p>Acesse o sistema para renovar ou acompanhar o status.</p>
      <a class="btn" href="${process.env.FRONTEND_URL}/documents">Ver Documentos</a>
    </div>
    <div class="footer">
      Este é um alerta automático do sistema TK Solution. Não responda este email.
    </div>
  </div>
</body>
</html>`
}

export function getProcessingCompleteTemplate(fileName: string): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 0; background: #f5f5f5; }
  .wrapper { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; }
  .header { background: #1E293B; padding: 24px 32px; }
  .header h1 { color: #fff; margin: 0; font-size: 20px; }
  .body { padding: 32px; }
  .success { background: #F0FDF4; border-left: 4px solid #22C55E; padding: 16px; border-radius: 4px; }
  a.btn { display: inline-block; background: #1E293B; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; margin-top: 24px; }
  .footer { background: #F8FAFC; padding: 16px 32px; font-size: 12px; color: #94A3B8; text-align: center; }
</style></head>
<body>
  <div class="wrapper">
    <div class="header"><h1>TK Solution — Documento Processado</h1></div>
    <div class="body">
      <div class="success">
        <p>O documento <strong>${fileName}</strong> foi processado com sucesso e está disponível no sistema.</p>
      </div>
      <a class="btn" href="${process.env.FRONTEND_URL}/documents">Ver Documentos</a>
    </div>
    <div class="footer">Sistema TK Solution</div>
  </div>
</body>
</html>`
}
