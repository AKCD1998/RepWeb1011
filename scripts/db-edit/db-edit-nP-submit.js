import { getApiBase } from '../api-base.js';

document.addEventListener('includes:done', () => {
  const form = document.getElementById('npForm');
  const saveBtn = document.getElementById('modalSaveBtn');
  if (!form) return;

  const API_BASE = getApiBase();

  const readList = (selector) => {
    const list = form.querySelector(selector);
    if (!list) return [];
    return [...list.querySelectorAll('li span')]
      .map((span) => span.textContent.trim())
      .filter(Boolean);
  };

  const getManufacturer = () => {
    const select = form.querySelector('select[name="manufacturer"]');
    if (!select) return '';
    if (select.value === 'Other') {
      return (form.querySelector('#custom-manu-input')?.value || '').trim();
    }
    return select.value.trim();
  };

  const clearLists = () => {
    ['#pack-list', '#route-list', '#repType-list'].forEach((selector) => {
      const list = form.querySelector(selector);
      if (list) list.innerHTML = '';
    });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const companyId = form.elements.companyId?.value.trim();
    const productName = form.elements.productName?.value.trim();
    const genericName = form.elements.genericName?.value.trim();
    const strengthValue = form.elements.strengthValue?.value;
    const strengthUnit = form.elements.strengthUnit?.value;
    const dosageForm = form.elements.dosageForm?.value;
    const price = form.elements.price?.value;
    const limitedQtyperBill = form.elements.limitedQtyperBill?.value;
    const otherQty = form.elements.otherQty?.value;
    const barcode = form.elements.barcode?.value.trim();

    if (!companyId || !productName || !price) {
      console.error('Missing required fields');
      return;
    }

    const payload = {
      companyId,
      productName,
      genericName: genericName || null,
      strengthValue: strengthValue ? Number(strengthValue) : null,
      strengthUnit: strengthUnit || null,
      packSizes: readList('#pack-list'),
      routes: readList('#route-list'),
      dosageForm: dosageForm || null,
      price: Number(price),
      reportTypes: readList('#repType-list'),
      limitedQtyperBill: limitedQtyperBill || null,
      otherQty: otherQty ? Number(otherQty) : null,
      manufacturer: getManufacturer() || null,
      barcode: barcode || null,
    };

    try {
      if (saveBtn) saveBtn.disabled = true;
      const res = await fetch(`${API_BASE}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
      }

      const data = await res.json();
      console.log('Saved product:', data);
      form.reset();
      clearLists();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
});
