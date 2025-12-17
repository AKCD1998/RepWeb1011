// ====== โค้ดสำหรับโหลด HTML ของ modal ไปใส่ <div dta-include=".../rx-drug-record-modal.html"></div> ======//

document.querySelectorAll('[data-include]').forEach(el => {
  const url = el.getAttribute('data-include');
  fetch(url)
    .then(res => res.text())
    .then(html => {
      el.innerHTML = html;

      // ตรงนี้ค่อยผูก event modal หลังจาก html โหลดเสร็จ
      const modal = document.getElementById('myModal');

      //ปุ่มยืนยันการทำรายการในหน้า rx-drug-record.html กดแล้วให้แสดง modal
      const btn   = document.getElementById('confirmBtn');
      //ปุ่มยกเลิกใน modal
      const modalCancelBtn = document.getElementById('modalCancelBtn');
      
    
      //ปุ่มปิด modal (x) มุมขวาบน
      const span  = modal.querySelector('.close');

      btn.onclick  = () => modal.style.display = 'block';
      span.onclick = () => modal.style.display = 'none';
      modalCancelBtn.onclick = () => modal.style.display = 'none';
      window.onclick = (event) => {
        if (event.target === modal) modal.style.display = 'none';
      };
    })
    .catch(err => {
      console.error('Failed to load include:', url, err);
    });
});