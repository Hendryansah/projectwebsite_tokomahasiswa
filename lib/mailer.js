const nodemailer = require('nodemailer');

class Mailer {
  constructor() {
    this.resendKey = process.env.RESEND_API_KEY || '';
    this.smtpHost = process.env.SMTP_HOST || '';
    this.smtpPort = process.env.SMTP_PORT || 587;
    this.smtpUser = process.env.SMTP_USER || '';
    this.smtpPass = process.env.SMTP_PASS || '';
    this.senderEmail = process.env.MAIL_FROM || 'noreply@store.id';
    this.storeName = process.env.STORE_NAME || 'X-Digital Premium Store';

    if (this.smtpHost && this.smtpUser && this.smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: Number(this.smtpPort),
        secure: Number(this.smtpPort) === 465,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass
        }
      });
    }
  }

  /**
   * Mengirimkan kredensial akun digital ke email pembeli
   */
  async sendOrderCredentials({ to, orderId, productName, variantName, credentials, totalAmount }) {
    const subject = `[${this.storeName}] Pesanan #${orderId} Sukses - Akun ${productName}`;
    
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0b0f17; color: #f1f5f9; padding: 24px; border-radius: 16px; border: 1px solid #1e293b;">
        <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #1e293b;">
          <h2 style="color: #38bdf8; margin: 0;">${this.storeName}</h2>
          <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Bukti Pembelian & Akun Digital</p>
        </div>

        <div style="padding: 20px 0;">
          <p>Halo kak, terima kasih sudah berbelanja!</p>
          <p>Pesanan Anda <strong>#${orderId}</strong> telah terbayar lunas. Berikut adalah rincian produk dan akun Anda:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #131b2e; border-radius: 8px; overflow: hidden;">
            <tr>
              <td style="padding: 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Produk:</td>
              <td style="padding: 12px; font-weight: bold; border-bottom: 1px solid #1e293b;">${productName}</td>
            </tr>
            <tr>
              <td style="padding: 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Varian:</td>
              <td style="padding: 12px; font-weight: bold; border-bottom: 1px solid #1e293b;">${variantName}</td>
            </tr>
            <tr>
              <td style="padding: 12px; color: #94a3b8;">Total Dibayar:</td>
              <td style="padding: 12px; font-weight: bold; color: #34d399;">Rp ${totalAmount.toLocaleString('id-ID')}</td>
            </tr>
          </table>

          <div style="background: #1e293b; border-left: 4px solid #38bdf8; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <div style="font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Kredensial / Akun Siap Pakai:</div>
            <pre style="background: #0f172a; padding: 12px; border-radius: 6px; font-size: 14px; color: #f8fafc; white-space: pre-wrap; word-break: break-all; margin: 0;">${credentials}</pre>
          </div>

          <p style="font-size: 13px; color: #94a3b8; line-height: 1.6;">
            💡 <strong>Penting:</strong> Simpan email ini sebagai bukti garansi. Jangan ubah data profil/email jika memilih akun sharing. Hubungi layanan admin jika terdapat kendala.
          </p>
        </div>

        <div style="text-align: center; padding-top: 16px; border-top: 1px solid #1e293b; color: #64748b; font-size: 12px;">
          &copy; ${new Date().getFullYear()} ${this.storeName}. Pengiriman otomatis 24/7.
        </div>
      </div>
    `;

    return this._dispatchEmail({ to, subject, html: htmlContent, previewCreds: credentials });
  }

  async _dispatchEmail({ to, subject, html, previewCreds }) {
    // 1. Coba Resend API jika key ada
    if (this.resendKey) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.resendKey}`
          },
          body: JSON.stringify({
            from: `${this.storeName} <${this.senderEmail}>`,
            to: [to],
            subject: subject,
            html: html
          })
        });
        if (resp.ok) {
          console.log(`[Mailer Resend] Email sukses dikirim ke ${to}`);
          return true;
        }
      } catch (err) {
        console.error('[Mailer Resend Error]:', err.message);
      }
    }

    // 2. Coba SMTP Nodemailer jika host ada
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: `"${this.storeName}" <${this.senderEmail}>`,
          to: to,
          subject: subject,
          html: html
        });
        console.log(`[Mailer SMTP] Email sukses dikirim ke ${to}`);
        return true;
      } catch (err) {
        console.error('[Mailer SMTP Error]:', err.message);
      }
    }

    // 3. Fallback Dev Mode / Logger (Bagus untuk uji coba lokal tanpa setup SMTP dulu)
    console.log(`\n================== [SIMULASI EMAIL TERKIRIM] ==================`);
    console.log(`Kepada: ${to}`);
    console.log(`Subjek: ${subject}`);
    console.log(`Detail Akun:\n${previewCreds}`);
    console.log(`=================================================================\n`);
    return true;
  }
}

module.exports = new Mailer();
