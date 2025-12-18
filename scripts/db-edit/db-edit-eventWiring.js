document.addEventListener('includes:done', () => {
  const dbEditModal = document.getElementById('db-edit-modal'); // wrapper ใน index
  const openBtn = document.getElementById('btnAddNew');   // อยู่ใน main db-edit ที่ถูก include ให้ไปอยู่ใน index.html
  const cancelBtn = document.getElementById('modalCancelBtn'); // อยู่ใน modal include
  const exitBtn = document.querySelector('#db-edit-modal .modal__x'); // อยู่ใน modal include

  
  console.log({ openBtn, cancelBtn, dbEditModal, exitBtn });

  openBtn?.addEventListener('click', () => dbEditModal.classList.remove('hidden'));
  cancelBtn?.addEventListener('click', () => dbEditModal.classList.add('hidden'));
  exitBtn?.addEventListener('click', () => dbEditModal.classList.add('hidden'));
});