// อะไรก็ตามที่ index.html มี <div data-include="..."> 
// javascript ตัวนี้จะทำการโหลดไฟล์ HTML ที่ระบุมาแทรกในตำแหน่งนั้น
// 18/12/2025 มีการ load & render HTML จาก ../html/edit-db/edit-db-main.html => หน้าแรกของ database editor
// 18/12/2025 มีการ load & render HTML จาก ../html/edit-db/edit-db-nP-modal.html => modal (new Product) ของ database editor

async function includeHTML() {
  const elements = [...document.querySelectorAll('[data-include]')];

  await Promise.all(elements.map(async (el) => {
    const file = el.getAttribute('data-include');
    const res = await fetch(file);
    if (!res.ok) throw new Error('Page not found: ' + file);
    el.innerHTML = await res.text();
    el.removeAttribute('data-include');
  }));

  document.dispatchEvent(new Event('includes:done'));
}

document.addEventListener('DOMContentLoaded', includeHTML);
