document.addEventListener('includes:done', () => {
  // ===== modal elements (KEEP your names, but select the REAL overlays) =====
  const dbEditNpModal = document.getElementById('db-edit-nP-modal');        // ✅ overlay root inside nP include
  const dbEditNrModal = document.getElementById('modal-nR-main');    // ✅ overlay root inside nR include

  // ===== second-layer overlays =====
  const nrReceiveModal  = document.getElementById('slot-nR-rcv-sec-modal');   // ✅ overlay root inside nR-receive include
  const nrTransferModal = document.getElementById('slot-nR-trfr-sec-modal');  // ✅ overlay root inside nR-transfer include

  // ===== button elements (as you wrote) =====
  const openNpBtn = document.getElementById('btnAddNew');
  const openNrBtn = document.querySelector('.addTile-nR');

  // these buttons exist inside nR main modal content (after include)
  const openNrRcvModal = document.querySelector('.btn-nR-received');
  const openNrTrfModal = document.querySelector('.btn-nR-transferred');

  // cancel/exit: don’t hardcode IDs; close by data-close is cleaner
  const exitBtnNp = document.querySelector('#myDbModal [data-close], #myDbModal .modal__x');
  const exitBtnNr = document.querySelector('#modal-nR-main [data-close], #modal-nR-main .modal__x');

  console.log({
    openNpBtn, openNrBtn,
    dbEditNpModal, dbEditNrModal,
    openNrRcvModal, openNrTrfModal,
    nrReceiveModal, nrTransferModal
  });

  // ===== event listeners =====
  openNpBtn?.addEventListener('click', () => dbEditNpModal?.classList.remove('hidden'));
  openNrBtn?.addEventListener('click', () => dbEditNrModal?.classList.remove('hidden'));

  // open layer-2 modals on top of layer-1
  openNrRcvModal?.addEventListener('click', () => nrReceiveModal?.classList.remove('hidden'));
  openNrTrfModal?.addEventListener('click', () => nrTransferModal?.classList.remove('hidden'));

  // close buttons (your original style)
  exitBtnNp?.addEventListener('click', () => dbEditNpModal?.classList.add('hidden'));
  exitBtnNr?.addEventListener('click', () => dbEditNrModal?.classList.add('hidden'));

  // OPTIONAL: Esc closes topmost (super useful)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (nrReceiveModal && !nrReceiveModal.classList.contains('hidden')) return nrReceiveModal.classList.add('hidden');
    if (nrTransferModal && !nrTransferModal.classList.contains('hidden')) return nrTransferModal.classList.add('hidden');
    if (dbEditNrModal && !dbEditNrModal.classList.contains('hidden')) return dbEditNrModal.classList.add('hidden');
    if (dbEditNpModal && !dbEditNpModal.classList.contains('hidden')) return dbEditNpModal.classList.add('hidden');
  });
});


