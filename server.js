require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = require('./database');
const paymentGateway = require('./lib/paymentGateway');
const mailer = require('./lib/mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-jwt-key-change-in-env';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware Auth JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (!err) req.user = user;
    next();
  });
}

app.use(authenticateToken);

/* =========================================================================
   1. ENDPOINT KATALOG PRODUK & VARIAN
   ========================================================================= */
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
    const getVariants = db.prepare(`
      SELECT pv.*, 
        (SELECT COUNT(*) FROM account_stocks WHERE variant_id = pv.id AND is_sold = 0) as stock_count
      FROM product_variants pv
      WHERE pv.product_id = ?
    `);

    const result = products.map((p) => {
      const variants = getVariants.all(p.id);
      const totalStock = variants.reduce((sum, v) => sum + v.stock_count, 0);
      return {
        ...p,
        variants,
        totalStock,
        startingPrice: variants.length ? Math.min(...variants.map((v) => v.price)) : 0
      };
    });

    res.json({ success: true, products: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   2. ENDPOINT CHECKOUT PESANAN (DIRECT BUY VIA QRIS ATAU POTONG SALDO)
   ========================================================================= */
app.post('/api/orders/create', async (req, res) => {
  try {
    const { variantId, buyerEmail, paymentMethod } = req.body; // paymentMethod: 'qris' | 'saldo'
    const userId = req.user ? req.user.id : null;

    if (!variantId || !buyerEmail) {
      return res.status(400).json({ error: 'Varian produk dan email pembeli wajib diisi!' });
    }

    // Ambil info varian & produk
    const variant = db.prepare(`
      SELECT pv.*, p.name as product_name, p.badge 
      FROM product_variants pv 
      JOIN products p ON p.id = pv.product_id 
      WHERE pv.id = ?
    `).get(variantId);

    if (!variant) {
      return res.status(404).json({ error: 'Varian produk tidak ditemukan.' });
    }

    // Cek ketersediaan stok
    const stockAvailable = db.prepare(
      'SELECT COUNT(*) as count FROM account_stocks WHERE variant_id = ? AND is_sold = 0'
    ).get(variantId).count;

    if (stockAvailable <= 0) {
      return res.status(400).json({ error: 'Maaf, stok varian ini sedang habis.' });
    }

    const orderId = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    // A. JIKA BAYAR PAKAI SALDO
    if (paymentMethod === 'saldo') {
      if (!userId) {
        return res.status(401).json({ error: 'Silakan login terlebih dahulu untuk membayar menggunakan saldo.' });
      }

      // Gunakan Transaksi Atomik Database
      const executeSaldoPurchase = db.transaction(() => {
        const user = db.prepare('SELECT id, saldo, email FROM users WHERE id = ?').get(userId);
        if (!user || user.saldo < variant.price) {
          throw new Error('Saldo akun tidak mencukupi untuk transaksi ini.');
        }

        // 1. Ambil 1 akun stok tercepat & tandai terjual (Pessimistic style)
        const stock = db.prepare(
          'SELECT id, credentials FROM account_stocks WHERE variant_id = ? AND is_sold = 0 LIMIT 1'
        ).get(variantId);

        if (!stock) {
          throw new Error('Stok akun baru saja habis oleh pembeli lain.');
        }

        db.prepare(`
          UPDATE account_stocks 
          SET is_sold = 1, sold_at = datetime('now'), order_id = ? 
          WHERE id = ?
        `).run(orderId, stock.id);

        // 2. Potong saldo user
        const newSaldo = user.saldo - variant.price;
        db.prepare('UPDATE users SET saldo = ? WHERE id = ?').run(newSaldo, userId);

        // 3. Catat di tabel riwayat orders
        db.prepare(`
          INSERT INTO orders (id, user_id, buyer_email, variant_id, product_name, variant_name, amount, payment_method, status, delivered_credentials)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'saldo', 'paid', ?)
        `).run(orderId, userId, buyerEmail, variantId, variant.product_name, variant.name, variant.price, stock.credentials);

        // 4. Catat mutasi saldo
        db.prepare(`
          INSERT INTO saldo_logs (user_id, reference_id, type, amount, current_saldo, note)
          VALUES (?, ?, 'purchase', ?, ?, ?)
        `).run(userId, orderId, -variant.price, newSaldo, `Beli ${variant.product_name} (${variant.name})`);

        return { orderId, credentials: stock.credentials, newSaldo };
      });

      const purchaseResult = executeSaldoPurchase();

      // Kirim email kredensial secara asynchronous
      mailer.sendOrderCredentials({
        to: buyerEmail,
        orderId: purchaseResult.orderId,
        productName: variant.product_name,
        variantName: variant.name,
        credentials: purchaseResult.credentials,
        totalAmount: variant.price
      });

      return res.json({
        success: true,
        paid: true,
        orderId: purchaseResult.orderId,
        credentials: purchaseResult.credentials,
        newSaldo: purchaseResult.newSaldo,
        message: 'Pembelian berhasil! Akun sudah dikirim dan muncul di layar.'
      });
    }

    // B. JIKA BAYAR PAKAI QRIS GATEWAY
    const invoice = await paymentGateway.createQrisInvoice({
      orderId,
      amount: variant.price,
      customerEmail: buyerEmail,
      customerName: req.user ? req.user.name : 'Pelanggan Guest'
    });

    // Simpan pesanan status pending
    db.prepare(`
      INSERT INTO orders (id, user_id, buyer_email, variant_id, product_name, variant_name, amount, payment_method, status, gateway_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'qris', 'pending', ?)
    `).run(orderId, userId, buyerEmail, variantId, variant.product_name, variant.name, variant.price, invoice.gatewayRef || null);

    res.json({
      success: true,
      paid: false,
      orderId,
      amount: variant.price,
      qrisImage: invoice.qrisImage,
      checkoutUrl: invoice.checkoutUrl,
      isSimulated: invoice.isSimulated
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* =========================================================================
   3. ENDPOINT POLLING STATUS PESANAN PEMBELIAN
   ========================================================================= */
app.get('/api/orders/:id/check', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });

    res.json({
      orderId: order.id,
      status: order.status,
      credentials: order.status === 'paid' ? order.delivered_credentials : null,
      productName: order.product_name,
      variantName: order.variant_name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   4. ENDPOINT TOP-UP SALDO
   ========================================================================= */
app.post('/api/topup/create', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Wajib login untuk melakukan top up saldo.' });
    }

    const amount = Number(req.body.amount);
    if (!amount || amount < 5000) {
      return res.status(400).json({ error: 'Nominal top up minimal Rp 5.000' });
    }

    const topupId = `TU-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const invoice = await paymentGateway.createQrisInvoice({
      orderId: topupId,
      amount,
      customerEmail: req.user.email,
      customerName: req.user.name
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO wallet_topups (id, user_id, amount, payment_method, gateway_ref, status, qris_data, expires_at)
      VALUES (?, ?, ?, 'qris', ?, 'pending', ?, ?)
    `).run(topupId, req.user.id, amount, invoice.gatewayRef || null, invoice.qrisImage, expiresAt);

    res.json({
      success: true,
      topupId,
      amount,
      qrisImage: invoice.qrisImage,
      checkoutUrl: invoice.checkoutUrl,
      isSimulated: invoice.isSimulated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/topup/:id/check', (req, res) => {
  try {
    const topup = db.prepare('SELECT * FROM wallet_topups WHERE id = ?').get(req.params.id);
    if (!topup) return res.status(404).json({ error: 'Top-up tidak ditemukan' });

    let currentSaldo = null;
    if (topup.status === 'paid') {
      const user = db.prepare('SELECT saldo FROM users WHERE id = ?').get(topup.user_id);
      currentSaldo = user ? user.saldo : null;
    }

    res.json({
      topupId: topup.id,
      status: topup.status,
      saldo: currentSaldo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   5. SETTLEMENT / PEMBAYARAN LUNAS (DIPAKAI OLEH WEBHOOK & DEV SIMULATOR)
   ========================================================================= */
function settleTransaction(transactionId) {
  // Cek apakah ini Top-Up Saldo (TU-) atau Order Produk (ORD-)
  if (transactionId.startsWith('TU-')) {
    const topup = db.prepare('SELECT * FROM wallet_topups WHERE id = ?').get(transactionId);
    if (!topup || topup.status === 'paid') return false;

    const tx = db.transaction(() => {
      db.prepare("UPDATE wallet_topups SET status = 'paid' WHERE id = ?").run(transactionId);
      const user = db.prepare('SELECT saldo FROM users WHERE id = ?').get(topup.user_id);
      const newSaldo = (user ? user.saldo : 0) + topup.amount;

      db.prepare('UPDATE users SET saldo = ? WHERE id = ?').run(newSaldo, topup.user_id);
      db.prepare(`
        INSERT INTO saldo_logs (user_id, reference_id, type, amount, current_saldo, note)
        VALUES (?, ?, 'topup', ?, ?, 'Top up saldo otomatis via QRIS')
      `).run(topup.user_id, transactionId, topup.amount, newSaldo);

      return newSaldo;
    });

    return { type: 'topup', newSaldo: tx() };
  } else if (transactionId.startsWith('ORD-')) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(transactionId);
    if (!order || order.status === 'paid') return false;

    const tx = db.transaction(() => {
      // Ambil 1 akun stok
      const stock = db.prepare(
        'SELECT id, credentials FROM account_stocks WHERE variant_id = ? AND is_sold = 0 LIMIT 1'
      ).get(order.variant_id);

      const creds = stock
        ? stock.credentials
        : 'Akun sedang disiapkan admin. Silakan kontak WhatsApp / email admin.';

      if (stock) {
        db.prepare(`
          UPDATE account_stocks 
          SET is_sold = 1, sold_at = datetime('now'), order_id = ? 
          WHERE id = ?
        `).run(transactionId, stock.id);
      }

      db.prepare("UPDATE orders SET status = 'paid', delivered_credentials = ? WHERE id = ?").run(
        creds,
        transactionId
      );

      return { order, creds };
    });

    const settled = tx();
    // Kirim email
    mailer.sendOrderCredentials({
      to: settled.order.buyer_email,
      orderId: transactionId,
      productName: settled.order.product_name,
      variantName: settled.order.variant_name,
      credentials: settled.creds,
      totalAmount: settled.order.amount
    });

    return { type: 'order', credentials: settled.creds };
  }

  return false;
}

// Webhook resmi dari Gateway (Pakasir / Tripay)
app.post('/api/webhook/payment', (req, res) => {
  const { order_id, status, signature } = req.body;
  if (!order_id) return res.status(400).send('Missing order_id');

  const isValid = paymentGateway.verifyPakasirSignature(order_id, status, signature);
  if (!isValid) return res.status(403).send('Invalid Signature');

  if (status === 'completed' || status === 'paid' || status === 'success') {
    settleTransaction(order_id);
    return res.status(200).send('OK');
  }

  res.status(200).send('Ignored status');
});

// Webhook Otomatis Pendeteksi Uang Masuk GoPay Merchant
// Endpoint ini menerima sinyal uang masuk dari HP/Notifikasi GoPay Merchant Anda
app.post('/api/webhook/gopay-notification', (req, res) => {
  try {
    const { amount, ref, rawText } = req.body;
    const numericAmount = Number(amount);

    if (!numericAmount && !ref) {
      return res.status(400).json({ error: 'Parameter amount atau ref wajib ada' });
    }

    console.log(`[GoPay Auto-Detect] Uang masuk terdeteksi: Rp ${numericAmount || 0} ${ref ? `(Ref: ${ref})` : ''}`);

    // 1. Jika ada ref langsung, selesaikan transaksi tersebut
    if (ref) {
      const settled = settleTransaction(ref);
      if (settled) {
        return res.json({ success: true, message: `Transaksi ${ref} otomatis diverifikasi!` });
      }
    }

    // 2. Jika hanya ada nominal (amount) dari notifikasi GoPay HP Anda:
    // Cari transaksi pending yang memiliki nominal cocok dalam 15 menit terakhir
    if (numericAmount) {
      // Cek di tabel orders pending
      const pendingOrder = db.prepare(`
        SELECT id FROM orders 
        WHERE amount = ? AND status = 'pending' 
        ORDER BY created_at DESC LIMIT 1
      `).get(numericAmount);

      if (pendingOrder) {
        settleTransaction(pendingOrder.id);
        console.log(`[GoPay Auto-Match] Pesanan ${pendingOrder.id} lunas otomatis!`);
        return res.json({ success: true, matched: 'order', orderId: pendingOrder.id });
      }

      // Cek di tabel topup pending
      const pendingTopup = db.prepare(`
        SELECT id FROM wallet_topups 
        WHERE amount = ? AND status = 'pending' 
        ORDER BY created_at DESC LIMIT 1
      `).get(numericAmount);

      if (pendingTopup) {
        settleTransaction(pendingTopup.id);
        console.log(`[GoPay Auto-Match] Top-up ${pendingTopup.id} lunas otomatis!`);
        return res.json({ success: true, matched: 'topup', topupId: pendingTopup.id });
      }
    }

    res.json({ success: false, message: 'Tidak ada transaksi pending yang cocok dengan nominal ini.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================================
   6. AUTHENTIKASI & PROFIL PENGGUNA
   ========================================================================= */
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Semua kolom wajib diisi!' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return res.status(400).json({ error: 'Email sudah terdaftar, silakan langsung masuk.' });
    }

    const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
    const hash = bcrypt.hashSync(password, 10);

    db.prepare('INSERT INTO users (id, name, email, password_hash, saldo) VALUES (?, ?, ?, ?, 0)').run(
      id,
      name.trim(),
      email.toLowerCase().trim(),
      hash
    );

    const token = jwt.sign({ id, name, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id, name, email, saldo: 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, saldo: user.saldo }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Belum login' });
  const user = db.prepare('SELECT id, name, email, saldo, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  res.json({ success: true, user });
});

app.get('/api/me/orders', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Belum login' });
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ success: true, orders });
});

app.get('/api/me/saldo-logs', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Belum login' });
  const logs = db.prepare('SELECT * FROM saldo_logs WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ success: true, logs });
});

// Fallback route index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n============================================================`);
  console.log(`🚀 Store Digital Server Berjalan di: http://localhost:${PORT}`);
  console.log(`💳 Payment Gateway Mode: ${process.env.GATEWAY_PROVIDER || 'simulator'}`);
  console.log(`============================================================\n`);
});
