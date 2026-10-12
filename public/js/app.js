// STATE MANAGEMENT
let ALL_PRODUCTS = [];
let CURRENT_CATEGORY = 'Semua';
let SEARCH_QUERY = '';
let CURRENT_USER = null;
let SELECTED_PRODUCT = null;
let SELECTED_VARIANT = null;
let ACTIVE_POLL_INTERVAL = null;
let CURRENT_REF_ID = null;

// DOM Elements
const $ = (id) => document.getElementById(id);

// Format Rupiah
function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

// Toast Notification
function showToast(message) {
  const toast = $('toastNotification');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// Inisialisasi Aplikasi saat Load
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadProducts();
  setupEventListeners();
});

// 1. Cek Sesi Login User
async function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    updateNavUser(null);
    return;
  }

  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      CURRENT_USER = data.user;
      updateNavUser(CURRENT_USER);
    } else {
      localStorage.removeItem('token');
      updateNavUser(null);
    }
  } catch (err) {
    console.error('Gagal verifikasi sesi:', err);
    updateNavUser(null);
  }
}

function updateNavUser(user) {
  if (user) {
    $('userSaldo').textContent = formatRupiah(user.saldo);
    $('saldoWrap').style.display = 'flex';
    $('authBtn').style.display = 'none';
    $('userBtn').style.display = 'inline-flex';
    $('userNameDisplay').textContent = user.name.split(' ')[0];
  } else {
    $('saldoWrap').style.display = 'none';
    $('authBtn').style.display = 'inline-flex';
    $('userBtn').style.display = 'none';
  }
}

// 2. Mengambil Produk dari Server
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (data.success) {
      ALL_PRODUCTS = data.products;
      renderProducts();
    }
  } catch (err) {
    console.error('Gagal mengambil produk:', err);
    $('productsGrid').innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#94a3b8;">Gagal memuat produk toko.</p>';
  }
}

// 3. Render Produk ke Grid Etalase
function renderProducts() {
  const grid = $('productsGrid');
  const filtered = ALL_PRODUCTS.filter((p) => {
    const matchCat = CURRENT_CATEGORY === 'Semua' || p.category.toLowerCase() === CURRENT_CATEGORY.toLowerCase();
    const matchSearch = p.name.toLowerCase().includes(SEARCH_QUERY.toLowerCase()) || 
                        p.description.toLowerCase().includes(SEARCH_QUERY.toLowerCase());
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding: 40px; color:#94a3b8;">Tidak ada produk yang sesuai dengan pencarian.</p>';
    return;
  }

  grid.innerHTML = filtered.map((p) => `
    <div class="product-card" onclick="openCheckoutModal('${p.id}')">
      <div class="card-top">
        <img src="${p.image || 'https://via.placeholder.com/80'}" alt="${p.name}" class="card-thumb" onerror="this.src='https://via.placeholder.com/80?text=${p.name[0]}'"/>
        <div class="card-title-wrap">
          <div class="card-title">${p.name}</div>
          <span class="card-badge">${p.badge || 'Ready'}</span>
        </div>
      </div>
      <p class="card-desc">${p.description}</p>
      <div class="card-footer">
        <div class="price-wrap">
          <span class="price-label">Mulai dari</span>
          <span class="price-val">${formatRupiah(p.startingPrice)}</span>
        </div>
        <button class="btn btn-primary" style="padding: 7px 12px; font-size: 0.82rem;">
          Pilih Paket
        </button>
      </div>
    </div>
  `).join('');
}

// 4. Buka Modal Pembelian / Checkout
function openCheckoutModal(productId) {
  SELECTED_PRODUCT = ALL_PRODUCTS.find((p) => p.id === productId);
  if (!SELECTED_PRODUCT) return;

  $('modalProductTitle').textContent = SELECTED_PRODUCT.name;
  
  // Render Varian
  const vList = $('variantList');
  vList.innerHTML = SELECTED_PRODUCT.variants.map((v, idx) => `
    <div class="variant-item ${idx === 0 ? 'selected' : ''}" onclick="selectVariant('${v.id}')" id="v_${v.id}">
      <div>
        <div class="v-name">${v.name}</div>
        <div style="font-size: 0.75rem; color: #10b981;">Stok: ${v.stock_count} akun ready</div>
      </div>
      <div class="v-price">${formatRupiah(v.price)}</div>
    </div>
  `).join('');

  SELECTED_VARIANT = SELECTED_PRODUCT.variants[0] || null;
  updateCheckoutTotal();

  // Prefill email jika user sudah login
  if (CURRENT_USER) {
    $('buyerEmailInput').value = CURRENT_USER.email;
  }

  openModal('checkoutModal');
}

function selectVariant(variantId) {
  document.querySelectorAll('.variant-item').forEach((el) => el.classList.remove('selected'));
  $(`v_${variantId}`).classList.add('selected');
  SELECTED_VARIANT = SELECTED_PRODUCT.variants.find((v) => v.id === variantId);
  updateCheckoutTotal();
}

function updateCheckoutTotal() {
  if (!SELECTED_VARIANT) return;
  $('orderTotalDisplay').textContent = formatRupiah(SELECTED_VARIANT.price);
  
  const useSaldoRadio = $('payMethodSaldo');
  if (CURRENT_USER && CURRENT_USER.saldo >= SELECTED_VARIANT.price) {
    useSaldoRadio.disabled = false;
    $('saldoLabelDesc').textContent = `Saldo Anda: ${formatRupiah(CURRENT_USER.saldo)} (Cukup)`;
  } else {
    useSaldoRadio.disabled = true;
    $('payMethodQris').checked = true;
    $('saldoLabelDesc').textContent = CURRENT_USER ? `Saldo tidak cukup (${formatRupiah(CURRENT_USER.saldo)})` : 'Wajib login untuk pakai saldo';
  }
}

// 5. Eksekusi Pembelian
async function submitOrder() {
  const email = $('buyerEmailInput').value.trim();
  if (!email || !email.includes('@')) {
    alert('Masukkan alamat email yang valid untuk pengiriman akun!');
    return;
  }

  const payMethod = $('payMethodSaldo').checked ? 'saldo' : 'qris';
  const submitBtn = $('btnSubmitOrder');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const res = await fetch('/api/orders/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {})
      },
      body: JSON.stringify({
        variantId: SELECTED_VARIANT.id,
        buyerEmail: email,
        paymentMethod: payMethod
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memproses pesanan.');

    closeModal('checkoutModal');

    // JIKA BAYAR PAKAI SALDO (LUNAS LANGSUNG)
    if (data.paid) {
      if (CURRENT_USER) {
        CURRENT_USER.saldo = data.newSaldo;
        updateNavUser(CURRENT_USER);
      }
      showDeliveredAccount(data.orderId, data.credentials);
      showToast('🎉 Pembelian sukses! Akun berhasil diterima.');
      loadProducts();
    } 
    // JIKA BAYAR PAKAI QRIS GATEWAY
    else {
      showQrisModal(data.orderId, data.amount, data.qrisImage, 'order');
    }
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Bayar Sekarang';
  }
}

// 6. Modal QRIS & Polling Status Real-Time
function showQrisModal(refId, amount, qrisImage, mode) {
  CURRENT_REF_ID = refId;
  $('qrisImageEl').src = qrisImage;
  $('qrisNominalText').textContent = formatRupiah(amount);
  $('qrisRefText').textContent = refId;
  $('qrisStatusText').textContent = 'Menunggu pembayaran via QRIS (BCA, DANA, Gopay, OVO, dll)...';

  openModal('qrisModal');

  // Mulai Polling Otomatis tiap 2 Detik
  if (ACTIVE_POLL_INTERVAL) clearInterval(ACTIVE_POLL_INTERVAL);
  ACTIVE_POLL_INTERVAL = setInterval(() => checkPaymentStatus(refId, mode), 2000);
}

async function checkPaymentStatus(refId, mode) {
  try {
    const endpoint = mode === 'order' ? `/api/orders/${refId}/check` : `/api/topup/${refId}/check`;
    const res = await fetch(endpoint);
    const data = await res.json();

    if (data.status === 'paid') {
      clearInterval(ACTIVE_POLL_INTERVAL);
      closeModal('qrisModal');

      if (mode === 'order') {
        showDeliveredAccount(data.orderId, data.credentials);
        showToast('🎉 Pembayaran diterima! Akun digital telah keluar.');
        loadProducts();
      } else {
        // Mode Topup
        if (CURRENT_USER) {
          CURRENT_USER.saldo = data.saldo;
          updateNavUser(CURRENT_USER);
        }
        showToast('💰 Top up berhasil! Saldo akun telah bertambah.');
      }
    }
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

// Cek status manual saat tombol di modal ditekan
async function manualCheckStatus() {
  if (!CURRENT_REF_ID) return;
  showToast('🔍 Memeriksa status transfer ke server...');
  const mode = CURRENT_REF_ID.startsWith('ORD-') ? 'order' : 'topup';
  await checkPaymentStatus(CURRENT_REF_ID, mode);
}

// 7. Modal Kredensial Akun yang Dikirim
function showDeliveredAccount(orderId, creds) {
  $('deliveredOrderId').textContent = '#' + orderId;
  $('deliveredCredsContent').textContent = creds;
  openModal('deliveryModal');
}

function copyCredentials() {
  const text = $('deliveredCredsContent').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Akun berhasil disalin ke clipboard!');
  });
}

// 8. Top Up Saldo Modal & Eksekusi
function openTopupModal() {
  if (!CURRENT_USER) {
    openModal('authModal');
    return;
  }
  $('topupAmountInput').value = '';
  openModal('topupModal');
}

function setTopupAmount(amount) {
  $('topupAmountInput').value = amount;
}

async function submitTopup() {
  const amount = Number($('topupAmountInput').value);
  if (!amount || amount < 5000) {
    alert('Nominal top up minimal Rp 5.000!');
    return;
  }

  const btn = $('btnSubmitTopup');
  btn.disabled = true;
  btn.textContent = 'Membuat QRIS...';

  try {
    const res = await fetch('/api/topup/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ amount })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal membuat tagihan top-up');

    closeModal('topupModal');
    showQrisModal(data.topupId, data.amount, data.qrisImage, 'topup');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lanjut Bayar QRIS';
  }
}

// 9. Riwayat Pesanan & Mutasi Saldo
async function openHistoryModal() {
  if (!CURRENT_USER) {
    openModal('authModal');
    return;
  }

  try {
    const [resOrders, resLogs] = await Promise.all([
      fetch('/api/me/orders', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
      fetch('/api/me/saldo-logs', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    ]);

    const dataOrders = await resOrders.json();
    const dataLogs = await resLogs.json();

    // Render Orders
    const ordersWrap = $('historyOrdersList');
    if (dataOrders.orders && dataOrders.orders.length > 0) {
      ordersWrap.innerHTML = dataOrders.orders.map((o) => `
        <div style="background: #090d16; border: 1px solid #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; font-weight: bold; font-size: 0.9rem;">
            <span>${o.product_name} - ${o.variant_name}</span>
            <span style="color:#38bdf8;">${formatRupiah(o.amount)}</span>
          </div>
          <div style="font-size: 0.78rem; color: #94a3b8; margin: 4px 0;">ID: #${o.id} • ${new Date(o.created_at).toLocaleDateString('id-ID')}</div>
          ${o.status === 'paid' ? `
            <button class="btn btn-outline" style="padding: 4px 10px; font-size: 0.75rem; margin-top: 6px;" onclick="showDeliveredAccount('${o.id}', \`${encodeURIComponent(o.delivered_credentials || '')}\`)">
              Lihat Kredensial Akun
            </button>
          ` : `<span style="color:#f59e0b; font-size:0.75rem;">Menunggu Bayar</span>`}
        </div>
      `).join('');
    } else {
      ordersWrap.innerHTML = '<p style="color:#94a3b8; font-size:0.85rem;">Belum ada riwayat pesanan.</p>';
    }

    // Render Logs
    const logsWrap = $('historyLogsList');
    if (dataLogs.logs && dataLogs.logs.length > 0) {
      logsWrap.innerHTML = dataLogs.logs.map((l) => `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #1e293b; padding: 8px 0; font-size:0.85rem;">
          <div>
            <div style="font-weight:600;">${l.note}</div>
            <div style="font-size:0.75rem; color:#64748b;">${new Date(l.created_at).toLocaleDateString('id-ID')}</div>
          </div>
          <div style="font-weight:700; color: ${l.amount > 0 ? '#10b981' : '#f43f5e'};">
            ${l.amount > 0 ? '+' : ''}${formatRupiah(l.amount)}
          </div>
        </div>
      `).join('');
    } else {
      logsWrap.innerHTML = '<p style="color:#94a3b8; font-size:0.85rem;">Belum ada mutasi saldo.</p>';
    }

    openModal('historyModal');
  } catch (err) {
    alert('Gagal memuat riwayat: ' + err.message);
  }
}

// 10. Login & Register
async function handleAuthSubmit(type) {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const name = $('authName').value.trim();

  const endpoint = type === 'login' ? '/api/auth/login' : '/api/auth/register';
  const body = type === 'login' ? { email, password } : { name, email, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Autentikasi gagal');

    localStorage.setItem('token', data.token);
    CURRENT_USER = data.user;
    updateNavUser(CURRENT_USER);
    closeModal('authModal');
    showToast(`Selamat datang kembali, ${CURRENT_USER.name}!`);
  } catch (err) {
    alert(err.message);
  }
}

function logout() {
  localStorage.removeItem('token');
  CURRENT_USER = null;
  updateNavUser(null);
  closeModal('historyModal');
  showToast('Berhasil keluar dari akun.');
}

// Modal Helpers
function openModal(id) {
  $(id).classList.add('open');
}

function closeModal(id) {
  $(id).classList.remove('open');
  if (id === 'qrisModal' && ACTIVE_POLL_INTERVAL) {
    clearInterval(ACTIVE_POLL_INTERVAL);
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // Category tabs
  document.querySelectorAll('.cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      CURRENT_CATEGORY = btn.getAttribute('data-cat');
      renderProducts();
    });
  });

  // Search input
  $('searchInput').addEventListener('input', (e) => {
    SEARCH_QUERY = e.target.value;
    renderProducts();
  });
}
