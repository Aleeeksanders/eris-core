/**
 * EmailService — Eris AXS
 * Servicio de envío de correos transaccionales con template HTML profesional.
 */

import nodemailer from 'nodemailer';

function buildPinEmailHtml(params: {
  name: string;
  profileId: string;
  pin: string;
  email: string;
}): string {
  const { name, profileId, pin } = params;
  const firstName = name.split(' ')[0] || 'Usuario';
  const pinFormatted = pin.match(/.{1,4}/g)?.join(' – ') || pin;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Tu acceso a Eris</title>
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0e0e18;border-radius:16px;border:1px solid rgba(34,211,238,0.12);overflow:hidden;">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#0e0e18 0%,#111827 100%);padding:40px 48px 32px;text-align:center;border-bottom:1px solid rgba(34,211,238,0.1);">
              <div style="display:inline-block;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.25);border-radius:14px;padding:12px 18px;margin-bottom:20px;">
                <span style="font-size:28px;line-height:1;">⚡</span>
              </div>
              <h1 style="margin:0;font-size:28px;font-weight:800;letter-spacing:6px;color:#f8fafc;">ERIS</h1>
              <p style="margin:6px 0 0;font-size:11px;color:#4ade80;letter-spacing:3px;font-weight:600;text-transform:uppercase;">AXS Ecosystem</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:40px 48px;">

              <!-- Saludo -->
              <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f8fafc;">
                Bienvenido, ${firstName}
              </h2>
              <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#94a3b8;">
                Tu cuenta ha sido vinculada exitosamente con tu perfil de Google. 
                A continuación encontrarás tus credenciales de acceso. 
                <strong style="color:#e2e8f0;">Guárdalas en un lugar seguro.</strong>
              </p>

              <!-- Card de credenciales -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(34,211,238,0.04);border:1px solid rgba(34,211,238,0.2);border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#22d3ee;text-transform:uppercase;">Profile ID</p>
                    <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#f8fafc;font-family:'Courier New',Courier,monospace;">${profileId}</p>

                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:2px;color:#22d3ee;text-transform:uppercase;">PIN de Acceso</p>
                    <div style="background:#0a0a14;border:1px solid rgba(34,211,238,0.15);border-radius:8px;padding:14px 18px;margin-top:4px;display:inline-block;width:100%;box-sizing:border-box;">
                      <span style="font-size:22px;font-weight:700;letter-spacing:6px;color:#f8fafc;font-family:'Courier New',Courier,monospace;">${pinFormatted}</span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Aviso de seguridad -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(251,191,36,0.05);border:1px solid rgba(251,191,36,0.2);border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-size:13px;color:#fbbf24;line-height:1.6;">
                      <strong>⚠️ Nota de seguridad:</strong> Este PIN actúa como tu llave de recuperación. 
                      Eris nunca te lo pedirá nuevamente a través de la app en condiciones normales. 
                      Si alguien te lo solicita, no lo compartas.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Info adicional -->
              <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">
                Si no reconoces esta actividad o no creaste esta cuenta, puedes ignorar este correo de forma segura. 
                No se realizaron cambios en ninguna cuenta existente.
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:rgba(0,0,0,0.3);padding:24px 48px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#334155;letter-spacing:2px;">AXS ECOSYSTEM</p>
              <p style="margin:0;font-size:11px;color:#1e293b;">
                Este es un correo automático generado por Eris · No responder
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-footer -->
        <p style="margin:20px 0 0;font-size:11px;color:#1e3a4c;text-align:center;">
          © ${new Date().getFullYear()} AXS Ecosystem · Todos los derechos reservados
        </p>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private from: string = '';

  constructor() {
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';

    if (user && pass) {
      this.from = `"Eris · AXS Ecosystem" <${user}>`;
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
      });
    }
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendNewProfilePin(params: {
    email: string;
    name: string;
    profileId: string;
    pin: string;
  }): Promise<{ ok: boolean; method: 'email' | 'console' }> {
    const html = buildPinEmailHtml(params);

    if (!this.transporter) {
      // Fallback: imprimir en consola del servidor
      console.log(`\n╔══════════════════════════════════════╗`);
      console.log(`║  🔐 NUEVO PERFIL GOOGLE REGISTRADO   ║`);
      console.log(`╠══════════════════════════════════════╣`);
      console.log(`║  Email:      ${params.email.padEnd(25)}║`);
      console.log(`║  Profile ID: ${params.profileId.padEnd(25)}║`);
      console.log(`║  PIN:        ${params.pin.padEnd(25)}║`);
      console.log(`╚══════════════════════════════════════╝\n`);
      return { ok: true, method: 'console' };
    }

    await this.transporter.sendMail({
      from: this.from,
      to: params.email,
      subject: '⚡ Tu acceso a Eris — Credenciales de perfil',
      html,
      text: `Bienvenido a Eris.\n\nProfile ID: ${params.profileId}\nPIN: ${params.pin}\n\nGuarda estas credenciales en un lugar seguro.\n\n— Eris · AXS Ecosystem`,
    });

    return { ok: true, method: 'email' };
  }
}

export const emailService = new EmailService();
