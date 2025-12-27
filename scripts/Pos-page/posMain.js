const products = [
  { barcode: '9999900046489', companyCode: 'IC-000508', name: 'เภสัช อนาแลป 50 มก.', price: 45.00, qtyPerUnit: 1, unit: 'แผง' },
]


// ==============================================
// ฟังก์ชันค้นหาผลิตภัณฑ์ตามบาร์โค้ด
// ==================================================

function productLookup(barcode) {
  // กำหนดให้ codeNumber คือค่า barcode จาก products
  const codeNumber = Number(barcode.trim().slice(-13));
  const foundProduct = products.find(item => item.barcode === codeNumber.toString());
  return foundProduct || null;
}

document.addEventListener('includes:done', () => {
  const numberInput = document.getElementById('barcode-input-field');
  if (!numberInput) {
    console.error('barcode-input-field not found');
    return;
  }

  numberInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const inputBarcode = numberInput.value;
      const showProduct = productLookup(inputBarcode);
      console.log(showProduct ? showProduct : 'Product not found');
      numberInput.value = ''; 
    }
  });
});


// ==============================================
// กำหนด เลข multiplier ไปใส่ในช่อง multchip
// ==============================================1

