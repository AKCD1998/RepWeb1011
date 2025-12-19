document.addEventListener('includes:done', () => {
  // ===== overlay roots (your modals ARE the overlays) =====
  const npModal = document.getElementById('myDbModal');
  const nrMain  = document.getElementById('modal-nR-main');
  const nrRcv   = document.getElementById('modal-nR-receive');
  const nrTrf   = document.getElementById('modal-nR-transfer');

  // ===== open buttons =====
  document.getElementById('btnAddNewNp')?.addEventListener('click', () => open(npModal));
  document.getElementById('btnAddNewNr')?.addEventListener('click', () => open(nrMain));

  // inside nrMain
  document.querySelector('.btn-nR-received')?.addEventListener('click', () => open(nrRcv));
  document.querySelector('.btn-nR-transferred')?.addEventListener('click', () => open(nrTrf));

  function open(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('hidden');
    modalEl.setAttribute('aria-hidden', 'false');
  }

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
  [npModal, nrMain, nrRcv, nrTrf].forEach(wireModal);

  // ✅ ESC closes topmost
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (nrRcv && !nrRcv.classList.contains('hidden')) return close(nrRcv);
    if (nrTrf && !nrTrf.classList.contains('hidden')) return close(nrTrf);
    if (nrMain && !nrMain.classList.contains('hidden')) return close(nrMain);
    if (npModal && !npModal.classList.contains('hidden')) return close(npModal);
  });

  console.log('✅ modal system wired:', { npModal, nrMain, nrRcv, nrTrf });
});
