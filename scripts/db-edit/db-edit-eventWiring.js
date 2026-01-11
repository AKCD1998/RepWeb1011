document.addEventListener('includes:done', () => {
  // ===== overlay roots (your modals ARE the overlays) =====
  const posModal = document.getElementById('posMyModal');
  const posMainPage = document.getElementById('pos-main-page');
  const npModal = document.getElementById('myDbModal');
  const nrMain  = document.getElementById('modal-nR-main');
  const nrRcv   = document.getElementById('modal-nR-receive');
  const nrTrf   = document.getElementById('modal-nR-transfer');
  const productsTableBody = document.getElementById('productsTableBody');
  const API_BASE = 'http://localhost:3001';

  // ===== open buttons =====
  document.getElementById('btnAddNewNp')?.addEventListener('click', () => open(npModal));
  document.getElementById('btnAddNewNr')?.addEventListener('click', () => open(nrMain));
  document.getElementById('pos-confirmBtn')?.addEventListener('click', () => {
    console.log('clicked pos-confirmBtn');
    open(posModal);
  });

  // inside nrMain
  document.querySelector('.btn-nR-received')?.addEventListener('click', () => open(nrRcv));
  document.querySelector('.btn-nR-transferred')?.addEventListener('click', () => open(nrTrf));


// ฟังก์ชันเปิด modal โดยอาร์กิวเมนต์เป็น element ของ modal ที่ต้องการเปิด-ปิด
  function open(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('hidden');
    modalEl.setAttribute('aria-hidden', 'false');
  }

// ฟังก์ชันปิด modal โดยอาร์กิวเมนต์เป็น element ของ modal ที่ต้องการเปิด-ปิด
  function close(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    modalEl.setAttribute('aria-hidden', 'true');
  }

  function wireModal(modalEl) {
    if (!modalEl) return;

    // ✅ close buttons inside this modal (✕, Cancel, etc.)
    modalEl.querySelectorAll('[data-close], .modal__x').forEach(btn => {
      btn.addEventListener('click', () => close(modalEl));
    });

    // ✅ click backdrop (ONLY if click hits the overlay root itself)
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close(modalEl);
    });
  }

  // wire each modal once
  [posModal, npModal, nrMain, nrRcv, nrTrf].forEach(wireModal);

  // ✅ ESC closes topmost
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (nrRcv && !nrRcv.classList.contains('hidden')) return close(nrRcv);
    if (nrTrf && !nrTrf.classList.contains('hidden')) return close(nrTrf);
    if (nrMain && !nrMain.classList.contains('hidden')) return close(nrMain);
    if (npModal && !npModal.classList.contains('hidden')) return close(npModal);
    if (posModal && !posModal.classList.contains('hidden')) return close(posModal);
  });

  async function loadProductsTable() {
    if (!productsTableBody) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/products/list`);
      if (!res.ok) {
        throw new Error(`failed to load products (${res.status})`);
      }
      const products = await res.json();
      productsTableBody.innerHTML = '';

      if (!Array.isArray(products) || products.length === 0) {
        productsTableBody.innerHTML =
          '<tr><td class="col-name" colspan="5">ไม่มีข้อมูลสินค้า</td></tr>';
        return;
      }

      for (const product of products) {
        const row = document.createElement('tr');
        const price =
          product.price_baht === null || product.price_baht === undefined
            ? ''
            : Number(product.price_baht).toFixed(2);

        row.innerHTML = `
          <td class="col-actions">
            <button class="kebab" aria-label="Row menu"><span aria-hidden="true">⋮</span></button>
          </td>
          <td class="col-itemid">${product.id ?? ''}</td>
          <td class="col-name">${product.brand_name ?? ''}</td>
          <td class="col-code">${product.product_code ?? ''}</td>
          <td class="col-price">${price}</td>
        `;
        productsTableBody.appendChild(row);
      }
    } catch (err) {
      console.error(err);
      productsTableBody.innerHTML =
        '<tr><td class="col-name" colspan="5">โหลดข้อมูลไม่สำเร็จ</td></tr>';
    }
  }

  loadProductsTable();

  console.log('✅ modal system wired:', { posModal, npModal, nrMain, nrRcv, nrTrf });
});
