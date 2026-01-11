const products = [
  { barcode: '9999900046489', companyCode: 'IC-000508', name: 'เภสัช อนาแลป 50 มก.', price: 45.00, qtyPerUnit: 1, unit: 'แผง' },
]

const cart = new Map();
const cartOrder = [];

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
  const itemsBody = document.getElementById('items');
  const grandTotal = document.getElementById('grand');
  if (!numberInput) {
    console.error('barcode-input-field not found');
    return;
  }
  if (!itemsBody) {
    console.error('items not found');
    return;
  }

  const toMoney = value => Number(value || 0).toFixed(2);

  function renderRow(item, index) {
    const row = document.createElement('div');
    row.dataset.name = item.name;
    row.innerHTML = `
      <div class="item-index">${index}</div>
      <div class="item-barcode">${item.barcode}</div>
      <div class="item-name">${item.name}</div>
      <div class="item-company">${item.companyCode}</div>
      <div class="item-price">${toMoney(item.price)}</div>
      <div class="item-qty">${item.qty}</div>
      <div class="item-sum">${toMoney(item.qty * item.price)}</div>
      <div class="item-note">
        <button class="item-delete" type="button" data-name="${item.name}" aria-label="Delete item">
          <svg class="icon-trash" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Zm-1 12h12a2 2 0 0 0 2-2V8H4v11a2 2 0 0 0 2 2Z"></path>
          </svg>
        </button>
      </div>
    `;
    return row;
  }

  function updateRow(row, item) {
    const qtyEl = row.querySelector('.item-qty');
    const sumEl = row.querySelector('.item-sum');
    if (qtyEl) qtyEl.textContent = item.qty;
    if (sumEl) sumEl.textContent = toMoney(item.qty * item.price);
  }

  function updateGrandTotal() {
    if (!grandTotal) return;
    let sum = 0;
    cart.forEach(item => {
      sum += item.qty * item.price;
    });
    grandTotal.textContent = toMoney(sum);
  }

  function refreshRowNumbers() {
    const rows = itemsBody.querySelectorAll('div[data-name]');
    rows.forEach((row, idx) => {
      const indexEl = row.querySelector('.item-index');
      if (indexEl) indexEl.textContent = idx + 1;
    });
  }

  function addToCart(product) {
    const key = product.name.trim();
    const existing = cart.get(key);
    if (existing) {
      existing.qty += 1;
      const row = itemsBody.querySelector(`[data-name="${CSS.escape(key)}"]`);
      if (row) updateRow(row, existing);
    } else {
      const item = { ...product, qty: 1 };
      cart.set(key, item);
      cartOrder.push(key);
      const row = renderRow(item, cartOrder.length);
      itemsBody.appendChild(row);
    }
    updateGrandTotal();
  }

  itemsBody.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.item-delete');
    if (!deleteBtn) return;
    const name = deleteBtn.dataset.name;
    if (!name) return;

    cart.delete(name);
    const index = cartOrder.indexOf(name);
    if (index >= 0) cartOrder.splice(index, 1);

    const row = itemsBody.querySelector(`[data-name="${CSS.escape(name)}"]`);
    if (row) row.remove();

    refreshRowNumbers();
    updateGrandTotal();
  });

  numberInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const inputBarcode = numberInput.value;
      const showProduct = productLookup(inputBarcode);
      if (showProduct) addToCart(showProduct);
      else console.log('Product not found');
      numberInput.value = ''; 
    }
  });
});


// ==============================================
// กำหนด เลข multiplier ไปใส่ในช่อง multchip
// ==============================================1


