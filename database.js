const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'store.db');
const db = new Database(dbPath);

// Aktifkan WAL mode untuk performa konkurensi tinggi & ACID
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  // 1. Tabel Users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      role TEXT DEFAULT 'customer',
      saldo INTEGER DEFAULT 0 CHECK (saldo >= 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📦',
      image TEXT,
      badge TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      strike_price INTEGER,
      is_invite INTEGER DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account_stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id TEXT NOT NULL,
      credentials TEXT NOT NULL,
      is_sold INTEGER DEFAULT 0,
      sold_at DATETIME,
      order_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      buyer_email TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      delivered_credentials TEXT,
      gateway_ref TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS wallet_topups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payment_method TEXT DEFAULT 'qris',
      gateway_ref TEXT,
      status TEXT DEFAULT 'pending',
      qris_data TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saldo_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      reference_id TEXT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      current_saldo INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Seed sample data produk jika masih kosong
  const count = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (count === 0) {
    seedInitialProducts();
  }
}

function seedInitialProducts() {
  const seedProducts = [
    {
      id: 'p_canva',
      name: 'Canva Pro Premium',
      slug: 'canva-pro-premium',
      category: 'Editing',
      description: 'Akses penuh ke semua template, font, dan elemen premium Canva. Proses instan langsung aktif.',
      icon: '🎨',
      image: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=200&auto=format&fit=crop&q=80',
      badge: 'Terlaris 🔥',
      variants: [
        { id: 'v_canva_1m_inv', name: 'Member 1 Bulan (Invite Email Pribadi)', price: 1500, strike_price: 15000, is_invite: 1 },
        { id: 'v_canva_1y_inv', name: 'Member 1 Tahun (Invite Email Pribadi)', price: 8000, strike_price: 150000, is_invite: 1 },
        { id: 'v_canva_life_inv', name: 'Member Lifetime (Invite Email Pribadi)', price: 15000, strike_price: 350000, is_invite: 1 }
      ]
    },
    {
      id: 'p_spotify',
      name: 'Spotify Premium Individual',
      slug: 'spotify-premium',
      category: 'Musik',
      description: 'Dengarkan jutaan lagu tanpa iklan, download offline, dan kualitas audio maksimal.',
      icon: '🎵',
      image: 'https://images.unsplash.com/photo-1614680376593-902f749f7ffc?w=200&auto=format&fit=crop&q=80',
      badge: 'Garansi 25 Hari',
      variants: [
        { id: 'v_spot_1m_priv', name: 'Private 1 Bulan (Akun Siap Pakai)', price: 14500, strike_price: 49000, is_invite: 0 },
        { id: 'v_spot_fam_1m', name: 'Famplan 1 Bulan (Email Seller)', price: 12000, strike_price: 69000, is_invite: 0 },
        { id: 'v_spot_fam_3m', name: 'Famplan 3 Bulan (Email Seller)', price: 35000, strike_price: 150000, is_invite: 0 }
      ]
    },
    {
      id: 'p_netflix',
      name: 'Netflix Premium Ultra HD 4K',
      slug: 'netflix-premium',
      category: 'Streaming',
      description: 'Nonton film & series favorit dengan kualitas 4K HDR. Tersedia opsi Sharing 1 Profile dan Private.',
      icon: '🍿',
      image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=200&auto=format&fit=crop&q=80',
      badge: 'Best Quality 4K',
      variants: [
        { id: 'v_nflx_1u1p_1m', name: '1 User 1 Profile (Sharing 1 Bulan)', price: 23000, strike_price: 45000, is_invite: 0 },
        { id: 'v_nflx_2u1p_1m', name: '2 User 1 Profile (Sharing 1 Bulan)', price: 16000, strike_price: 35000, is_invite: 0 },
        { id: 'v_nflx_priv_1m', name: 'Private Full 5 Profile (1 Bulan)', price: 155000, strike_price: 186000, is_invite: 0 }
      ]
    },
    {
      id: 'p_capcut',
      name: 'CapCut Pro Video Editor',
      slug: 'capcut-pro',
      category: 'Editing',
      description: 'Ekspor tanpa watermark, akses semua efek pro, template eksklusif, dan auto caption cerdas.',
      icon: '🎬',
      image: 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=200&auto=format&fit=crop&q=80',
      badge: 'Creator Choice',
      variants: [
        { id: 'v_capcut_7d', name: 'CapCut Pro 7 Hari (Akun Siap Pakai)', price: 3500, strike_price: 25000, is_invite: 0 },
        { id: 'v_capcut_1m', name: 'CapCut Pro 1 Bulan (Akun Siap Pakai)', price: 21500, strike_price: 65000, is_invite: 0 }
      ]
    },
    {
      id: 'p_chatgpt',
      name: 'ChatGPT Plus / Team',
      slug: 'chatgpt-plus',
      category: 'AI & Produktivitas',
      description: 'Akses model GPT-4o tanpa antre, analisis data, pembuatan gambar DALL-E, dan custom GPTs.',
      icon: '🤖',
      image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200&auto=format&fit=crop&q=80',
      badge: 'AI Flagship',
      variants: [
        { id: 'v_gpt_go_1m', name: 'ChatGPT Go Sharing 1 Bulan', price: 15000, strike_price: 35000, is_invite: 0 },
        { id: 'v_gpt_priv_1m', name: 'ChatGPT Private 1 Bulan (Full Akses)', price: 85000, strike_price: 320000, is_invite: 0 }
      ]
    },
    {
      id: 'p_youtube',
      name: 'YouTube Premium & Music',
      slug: 'youtube-premium',
      category: 'Streaming',
      description: 'Bebas iklan, putar di latar belakang saat layar mati, dan akses YouTube Music Premium.',
      icon: '▶️',
      image: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=200&auto=format&fit=crop&q=80',
      badge: 'Bebas Iklan',
      variants: [
        { id: 'v_yt_fam_1m', name: 'Famplan 1 Bulan (Invite Email Pribadi)', price: 4000, strike_price: 18000, is_invite: 1 },
        { id: 'v_yt_ind_1m', name: 'Indplan 1 Bulan (Akun Siap Pakai)', price: 15000, strike_price: 35000, is_invite: 0 },
        { id: 'v_yt_ind_3m', name: 'Indplan 3 Bulan (Akun Siap Pakai)', price: 25000, strike_price: 90000, is_invite: 0 }
      ]
    },
    {
      id: 'p_disney',
      name: 'Disney+ Hotstar Premium',
      slug: 'disney-plus-hotstar',
      category: 'Streaming',
      description: 'Akses film Marvel, Star Wars, Pixar, Disney, dan serial lokal terlengkap.',
      icon: '✨',
      image: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=200&auto=format&fit=crop&q=80',
      badge: 'Family Movie',
      variants: [
        { id: 'v_disney_shar_1m', name: 'Sharing Standar 1 Bulan', price: 23000, strike_price: 45000, is_invite: 0 },
        { id: 'v_disney_priv_1m', name: 'Private Standar 1 Bulan', price: 39000, strike_price: 79000, is_invite: 0 }
      ]
    },
    {
      id: 'p_gemini',
      name: 'Google Gemini Advanced + 2TB',
      slug: 'google-gemini-ai',
      category: 'AI & Produktivitas',
      description: 'Model Gemini 1.5 Pro multimodal + Google One Cloud Storage 2TB aktif 1 Tahun.',
      icon: '✨',
      image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
      badge: '2TB Cloud Bonus',
      variants: [
        { id: 'v_gemini_inv_1y', name: 'Gemini AI + 2TB GDrive Invite 1 Tahun', price: 18000, strike_price: 45000, is_invite: 1 },
        { id: 'v_gemini_head_1y', name: 'Gemini AI + 2TB Head/Owner 1 Tahun', price: 42000, strike_price: 350000, is_invite: 0 }
      ]
    }
  ];

  const insertProduct = db.prepare(`
    INSERT INTO products (id, name, slug, category, description, icon, image, badge)
    VALUES (@id, @name, @slug, @category, @description, @icon, @image, @badge)
  `);

  const insertVariant = db.prepare(`
    INSERT INTO product_variants (id, product_id, name, price, strike_price, is_invite)
    VALUES (@id, @product_id, @name, @price, @strike_price, @is_invite)
  `);

  const insertStock = db.prepare(`
    INSERT INTO account_stocks (variant_id, credentials)
    VALUES (?, ?)
  `);

  const tx = db.transaction(() => {
    for (const p of seedProducts) {
      insertProduct.run({
        id: p.id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        description: p.description,
        icon: p.icon,
        image: p.image,
        badge: p.badge
      });

      for (const v of p.variants) {
        insertVariant.run({
          id: v.id,
          product_id: p.id,
          name: v.name,
          price: v.price,
          strike_price: v.strike_price,
          is_invite: v.is_invite
        });

        // Masukkan contoh stok akun siap kirim (3 akun per varian)
        if (!v.is_invite) {
          for (let i = 1; i <= 5; i++) {
            insertStock.run(
              v.id,
              `email: premium_${v.id}_user${i}@store.id\npass: PassXv${1000 + i}#\nnotes: Mohon tidak ganti profile orang lain ya!`
            );
          }
        } else {
          // Produk invite: link undangan / petunjuk
          for (let i = 1; i <= 10; i++) {
            insertStock.run(
              v.id,
              `link_invite: https://invite.store.id/join/${v.id}?token=tok_${Math.random().toString(36).substring(2, 10)}\npetunjuk: Klik link invite di atas menggunakan email Anda sendiri untuk aktivasi instan.`
            );
          }
        }
      }
    }
  });

  tx();
  console.log('[DB] Seeding awal produk dan stok akun berhasil!');
}

initDatabase();

module.exports = db;
