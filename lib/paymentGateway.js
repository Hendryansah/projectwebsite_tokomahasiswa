const QRCode = require('qrcode');
const crypto = require('crypto');

class PaymentGateway {
  constructor() {
    this.provider = process.env.GATEWAY_PROVIDER || 'simulator'; // 'simulator', 'pakasir', 'tripay'
    this.pakasirApiKey = process.env.PAKASIR_API_KEY || '';
    this.pakasirProjectId = process.env.PAKASIR_PROJECT_ID || '';
    this.pakasirWebhookSecret = process.env.PAKASIR_WEBHOOK_SECRET || '';
    this.tripayApiKey = process.env.TRIPAY_API_KEY || '';
    this.tripayPrivateKey = process.env.TRIPAY_PRIVATE_KEY || '';
    this.tripayMerchantCode = process.env.TRIPAY_MERCHANT_CODE || '';
    // String QRIS Statis Merchant GoPay milik Anda (NMID: ID1026613986334)
    this.gopayQrisString = process.env.GOPAY_QRIS_STRING || '00020101021126610014COM.GO-JEK.WWW01189360091435793651690210G5793651690303UMI51440014ID.CO.QRIS.WWW0215ID10266139863340303UMI5204573253033605802ID5925MUHAMMAD ILHAM HENDRYANSA6006BEKASI61051751062070703A016304483C';
  }

  /**
   * Menghitung Checksum CRC16-CCITT (Standar ISO/IEC 13239 QRIS EMVCo)
   */
  calculateCRC16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Mengubah QRIS Statis GoPay menjadi QRIS Dinamis dengan nominal otomatis
   */
  convertGopayToDynamic(staticQr, amount) {
    // 1. Buang 4 karakter CRC lama di belakang (6304XXXX)
    let qris = staticQr.slice(0, -4);

    // 2. Ubah Tag 01: dari '11' (Statis) menjadi '12' (Dinamis)
    qris = qris.replace('010211', '010212');

    // 3. Buat Tag 54 (Transaction Amount)
    const amtStr = String(amount);
    const amtTag = '54' + String(amtStr.length).padStart(2, '0') + amtStr;

    // 4. Sisipkan Tag 54 tepat sebelum Tag 58 (5802ID)
    const pos58 = qris.indexOf('5802ID');
    if (pos58 !== -1) {
      qris = qris.slice(0, pos58) + amtTag + qris.slice(pos58);
    }

    // 5. Hitung ulang Checksum CRC16 baru
    const newCrc = this.calculateCRC16(qris);
    return qris + newCrc;
  }

  /**
   * Membuat tagihan QRIS baru (untuk Top-Up Saldo atau Direct Buy Produk)
   */
  async createQrisInvoice({ orderId, amount, customerEmail, customerName }) {
    if (this.provider === 'gopay') {
      return this._createGopayDynamicInvoice({ orderId, amount });
    }

    if (this.provider === 'pakasir' && this.pakasirApiKey) {
      return this._createPakasirInvoice({ orderId, amount, customerEmail, customerName });
    }

    if (this.provider === 'tripay' && this.tripayApiKey) {
      return this._createTripayInvoice({ orderId, amount, customerEmail, customerName });
    }

    // Default jika memilih gopay atau simulator
    return this._createGopayDynamicInvoice({ orderId, amount });
  }

  /**
   * QRIS Dinamis Resmi Merchant GoPay Anda (NMID: ID1026613986334)
   * Uang langsung masuk ke GoPay Merchant / Rekening BCA Anda!
   */
  async _createGopayDynamicInvoice({ orderId, amount }) {
    const dynamicPayload = this.convertGopayToDynamic(this.gopayQrisString, amount);

    const qrDataUrl = await QRCode.toDataURL(dynamicPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 340,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    return {
      provider: 'gopay',
      ref: orderId,
      amount,
      merchantName: 'MUHAMMAD ILHAM HENDRYANSAH',
      nmid: 'ID1026613986334',
      qrisString: dynamicPayload,
      qrisImage: qrDataUrl,
      checkoutUrl: null,
      isSimulated: false
    };
  }

  /**
   * Simulator QRIS: Membuat QR Code visual asli berstandar EMVCo / QRIS dummy
   */
  async _createSimulatorQris({ orderId, amount }) {
    // String payload QRIS standar
    const payload = `00020101021226670016ID.CO.STORE.WWW01189360099900000000010215${orderId}51440014ID.LINKAJA.WWW0215${orderId}52045499530336054${amount}5802ID5914STORE PREMIUM6007JAKARTA61051234062220118${orderId}6304ABCD`;
    
    // Generate QR Code Base64 Data URL
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    return {
      provider: 'simulator',
      ref: orderId,
      amount,
      qrisString: payload,
      qrisImage: qrDataUrl,
      checkoutUrl: null,
      isSimulated: true
    };
  }

  /**
   * Integrasi Resmi Pakasir (Dynamic QRIS)
   */
  async _createPakasirInvoice({ orderId, amount, customerEmail, customerName }) {
    try {
      const resp = await fetch('https://api.pakasir.com/v1/transaction/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.pakasirApiKey}`
        },
        body: JSON.stringify({
          project_id: this.pakasirProjectId,
          order_id: orderId,
          amount: amount,
          payment_method: 'qris',
          customer_email: customerEmail,
          customer_name: customerName || 'Pelanggan Store'
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Gagal membuat QRIS di Pakasir');
      }

      let qrDataUrl = data.qr_image || null;
      if (!qrDataUrl && data.qr_string) {
        qrDataUrl = await QRCode.toDataURL(data.qr_string);
      }

      return {
        provider: 'pakasir',
        ref: orderId,
        gatewayRef: data.payment_id || data.id,
        amount: amount,
        qrisString: data.qr_string,
        qrisImage: qrDataUrl,
        checkoutUrl: data.payment_url || null,
        isSimulated: false
      };
    } catch (err) {
      console.error('[Gateway Pakasir Error]:', err.message);
      // Fallback ke simulator jika API gagal agar web tidak crash
      return this._createSimulatorQris({ orderId, amount });
    }
  }

  /**
   * Validasi HMAC Signature Webhook dari Pakasir
   */
  verifyPakasirSignature(orderId, status, signature) {
    if (!this.pakasirWebhookSecret) return true; // dev mode bypass
    const expected = crypto
      .createHmac('sha256', this.pakasirWebhookSecret)
      .update(orderId + status)
      .digest('hex');
    return signature === expected;
  }
}

module.exports = new PaymentGateway();
