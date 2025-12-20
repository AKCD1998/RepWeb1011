document.addEventListener('includes:done', () => {
  // ===== overlay roots (your modals ARE the overlays) =====
  const posModal = document.getElementById('posMyModal');
  const posMainPage = document.getElementById('pos-main-page');
  const npModal = document.getElementById('myDbModal');
  const nrMain  = document.getElementById('modal-nR-main');
  const nrRcv   = document.getElementById('modal-nR-receive');
  const nrTrf   = document.getElementById('modal-nR-transfer');

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

  console.log('✅ modal system wired:', { posModal, npModal, nrMain, nrRcv, nrTrf });
});
