# X-STORE: Platform E-Commerce Produk Digital & Sistem Saldo Otomatis

Platform toko daring (*digital goods store*) dengan sistem pengiriman akun instan 24/7 dan dompet internal (*Internal Wallet / Saldo*), terinspirasi dari arsitektur Xavierastore namun dengan tampilan antarmuka yang bersih, modern, dan profesional.

---

## 🚀 Cara Menjalankan Proyek di Komputer Anda

1. **Buka Terminal / Command Prompt / PowerShell** di folder ini:
   ```bash
   cd "I:\project website"
   ```

2. **Jalankan Server**:
   ```bash
   node server.js
   ```

3. **Buka di Browser**:
   Buka alamat berikut di browser Anda:
   👉 **http://localhost:3000**

---

## 🔑 Di Mana Saja API Key yang Perlu Diubah?

Semua pengaturan API Key dan konfigurasi layanan eksternal tersimpan rapi di dalam file **`.env`** di direktori utama:
File: `I:\project website\.env`

Berikut adalah daftar variabel dan penjelasannya:

| Variabel di `.env` | Tempat Mendaftar / Penjelasan |
| :--- | :--- |
| `GATEWAY_PROVIDER` | Pilih `simulator` (mode uji coba bawaan), `pakasir`, atau `tripay`. |
| `PAKASIR_API_KEY` | Dapatkan di **[dashboard.pakasir.com](https://pakasir.com)** pada menu Developer API. |
| `PAKASIR_PROJECT_ID` | ID Proyek toko Anda di Pakasir. |
| `PAKASIR_WEBHOOK_SECRET` | Secret key untuk memverifikasi keaslian webhook saat ada notifikasi uang masuk. |
| `TRIPAY_API_KEY` | Dapatkan di **[tripay.co.id](https://tripay.co.id)** jika menggunakan gateway Tripay. |
| `RESEND_API_KEY` | Dapatkan di **[resend.com](https://resend.com)** (gratis 3.000 email/bulan) untuk kirim kredensial ke email pembeli. |
| `SMTP_HOST`, `SMTP_PASS` | Alternatif jika ingin kirim email via SMTP Gmail / cPanel pribadi. |
| `JWT_SECRET` | Kunci acak untuk mengenkripsi sesi login member. |

---

## 🛠️ Fitur Utama & Alur Kerja Sistem

### 1. Mode Uji Coba Bawaan (Developer Simulator Mode)
Secara default, `GATEWAY_PROVIDER=simulator` sudah aktif.
- Saat Anda klik "Beli" atau "Isi Saldo", QRIS visual asli akan langsung muncul di layar.
- Tersedia tombol hijau **⚡ Simulasi Bayar Berhasil (Klik di Sini)** di dalam modal QRIS.
- Begitu diklik, backend langsung memverifikasi transaksi, stok akun otomatis keluar, dan saldo otomatis bertambah layaknya transaksi sungguhan!

### 2. Pengiriman Akun Instan (Zero-Touch Delivery)
- Begitu pembayaran terverifikasi (baik via Webhook resmi maupun simulasi), sistem otomatis:
  1. Mengambil 1 akun siap pakai dari database stok (`account_stocks`).
  2. Menandai akun tersebut sebagai `is_sold = 1` agar tidak bisa dibeli orang lain (*anti-double selling*).
  3. Memunculkan akun di modal layar pembeli lengkap dengan tombol 1-klik salin.
  4. Mengirimkan salinan kredensial ke email pembeli.

### 3. Sistem Saldo & Mutasi (Internal Wallet)
- Pengguna yang telah mendaftar/login memiliki dompet saldo.
- Pengguna dapat mengisi saldo kapan saja via QRIS.
- Saat saldo mencukupi, pengguna dapat membeli produk dengan opsi **💰 Potong Saldo (Instan 1-Klik)** tanpa perlu repot scan QRIS lagi.
- Seluruh riwayat transaksi uang masuk dan keluar dicatat di tabel audit **`saldo_logs`**.

### 4. Database SQLite (WAL Mode & ACID)
- Menggunakan database berkas lokal `store.db` via `better-sqlite3`.
- Mendukung transaksi atomik (`BEGIN ... COMMIT`) yang menjamin tidak akan terjadi *race condition*.
- Telah diisi (*seeded*) dengan data produk populer: Canva Pro, Spotify, Netflix 4K, CapCut Pro, ChatGPT Plus, YouTube Premium, Disney+, dan Gemini AI.
