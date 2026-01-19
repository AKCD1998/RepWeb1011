
// ผูก element สำหรับ หัวข้อรายงานที่เกี่ยวข้อง (report type) ใน modal nP 
document.addEventListener('includes:done', () => {
  const select = document.getElementById('repType-select');
  const customInput = document.getElementById('custom-repType-input');
  const addBtn = document.getElementById('add-repType-btn');
  const list = document.getElementById('repType-list');

  if (!select || !customInput || !addBtn || !list) return;

  // show/hide custom input
  function toggleCustomInput() {
    if (select.value === 'Other') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
      customInput.value = '';
    }
  }

  // add item
  function addRepType() {
    let text = '';

    if (select.value === 'Other') {
      text = customInput.value.trim();
    } else {
      text = select.value.trim();
    }

    if (!text) return;

    // กันซ้ำ (optional)
    const exists = [...list.querySelectorAll('li span')]
      .some(span => span.textContent.trim() === text);
    if (exists) return;

    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(text)}</span>
      <button class="delete-btn" type="button">Delete</button>
    `;

    li.querySelector('.delete-btn').addEventListener('click', () => li.remove());

    list.appendChild(li);

    // reset
    select.value = '';
    customInput.value = '';
    customInput.style.display = 'none';
  }

  // helper กัน text ทำให้ HTML พัง (ปลอดภัยขึ้น)
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  // events
  select.addEventListener('change', toggleCustomInput);
  addBtn.addEventListener('click', addRepType);

  // กด Enter ในช่อง custom แล้ว add ได้เลย
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addRepType();
  });
});



//========ผูก element สำหรับหัวข้อ manufacturer ใน modal nP=========/ 
document.addEventListener('includes:done', () => {
    //ไว้ใช้กับพวก input ที่ไม่มี id เช่นพวก selectors 
  const manuSelect = document.querySelector('select[name="manufacturer"]');
  const manuCustomInput = document.getElementById('custom-manu-input');
  const manuAddBtn = document.getElementById('add-custom-manu-btn');

  // ตรวจสอบว่าทุก element มีอยู่จริง ถ้าไม่เจอให้หยุดทำงาน
  if (!manuSelect || !manuCustomInput || !manuAddBtn) return;

  // ค่าคงที่สำหรับตัวเลือก "Other"
  const OTHER_VALUE = 'Other';

  // ถ้าค่าในอาร์กิวเมนต์เป็น true ให้แสดง UI สำหรับกรอกข้อมูลผู้ผลิตเอง
  // ถ้าเป็น false ให้ซ่อน UI นั้น
  function showCustomManuUI(showManu) {
    manuCustomInput.style.display = showManu ? 'block' : 'none';
    manuAddBtn.style.display = showManu ? 'inline-block' : 'none';
    if (showManu) manuCustomInput.focus();
  }

  // ตัวกำหนดว่า ถ้ามีการเปลี่ยนแปลงในช่อง select เป็น "Other" หรือไม่
  // ถ้าใช้ อาร์กิวเมนต์ showManu เป็น true เพื่อแสดง UI กรอกข้อมูลเอง
  // ถ้าไม่ใช่ ให้ซ่อน UI นั้น และล้างค่าที่กรอกไว้
  manuSelect.addEventListener('change', () => {
    if (manuSelect.value === OTHER_VALUE) {
      showCustomManuUI(true);
    } else {
      showCustomManuUI(false);
      manuCustomInput.value = '';
    }
  });

  // เมื่อกดปุ่มเพิ่มผู้ผลิต
  manuAddBtn.addEventListener('click', () => {
    // ค่าที่อยู่ในช่องกรอกข้อมูลผู้ผลิตที่ถูกตัดช่องว่างด้านหน้า-หลังออก
    const manuText = manuCustomInput.value.trim();
    // ถ้าไม่มีค่าอะไร ให้หยุดทำงาน
    if (!manuText) return;

    // ตรวจสอบว่ามีตัวเลือกที่มีข้อความตรงกับค่าที่กรอกไว้หรือไม่
    const optionExists = Array.from(manuSelect.options)
      .some(opt => opt.text.trim() === manuText);

      // ถ้าไม่มีตัวเลือกที่ตรงกัน ให้สร้างตัวเลือกใหม่และเพิ่มเข้าไปใน select
      // จะได้ไม่ต้องมานั่งพิมพ์ใหม่ทุกครั้ง
    if (!optionExists) {
      const newOpt = document.createElement('option');
      newOpt.value = manuText;
      newOpt.text  = manuText;

    // แทรกตัวเลือกใหม่ก่อนตัวเลือก "Other" ถ้ามี
      const otherOpt = Array.from(manuSelect.options)
        .find(opt => opt.value === OTHER_VALUE);

        // ถ้าเจอ ให้แทรกก่อนหน้า ถ้าไม่เจอ ให้เพิ่มไว้ท้ายสุด
      if (otherOpt) manuSelect.insertBefore(newOpt, otherOpt);
      else manuSelect.appendChild(newOpt);
    }

    // เลือกตัวเลือกที่ตรงกับค่าที่กรอกไว้
    const matchOpt = Array.from(manuSelect.options)
      .find(opt => opt.text.trim() === manuText);

      // ถ้าเจอ ให้ตั้งค่า select เป็นค่านั้น
    if (matchOpt) manuSelect.value = matchOpt.value;

    // ล้างค่าที่กรอกไว้ และซ่อน UI กรอกข้อมูลเอง
    manuCustomInput.value = '';
    showCustomManuUI(false);
  });

  // กด Enter ในช่องกรอกข้อมูลผู้ผลิต ก็เหมือนกับกดปุ่มเพิ่มผู้ผลิต
  manuCustomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      manuAddBtn.click();
    }
  });

  // ซ่อนตั้งแต่เริ่ม (สำคัญมาก)
  showCustomManuUI(false);
});



// ====================AutoComplete generic drug================================//
// ===== generic drug autocomplete data input==========//
// ====================================================//

// ข้อมูลตัวอย่างสำหรับ autocomplete ชื่อสามัญทางยา ถ้ามีเพิ่มใส่ตรงนี้ได้เลย
const genericDrugAutocompleteData = [
  { label: 'Brompheniramine', value: 'brompheniramine' },
  { label: 'Carbinoxamine', value: 'carbinoxamine' },
  { label: 'Chlorpheniramine', value: 'chlorpheniramine' },
  { label: 'Cyproheptadine', value: 'cyproheptadine' },
  { label: 'Dexchlorpheniramine', value: 'dexchlorpheniramine' },
  { label: 'Dimenhydrinate', value: 'dimenhydrinate' },
  { label: 'Diphenhydramine', value: 'diphenhydramine' },
  { label: 'Doxylamine', value: 'doxylamine' },
  { label: 'Hydroxyzine', value: 'hydroxyzine' },
  { label: 'Promethazine', value: 'promethazine' },
  { label: 'Triprolidine', value: 'triprolidine' },
  { label: 'Cyclosporine',   value: 'cyclosporine' },
  { label: 'Tacrolimus',     value: 'tacrolimus' },
  { label: 'Methotrexate',   value: 'methotrexate' },
  { label: 'Doxorubicin',    value: 'doxorubicin' },
  { label: 'Morphine',       value: 'morphine' },
  { label: 'Fentanyl',       value: 'fentanyl' },
  { label: 'Lamivudine',     value: 'lamivudine' },
  { label: 'Oseltamivir',    value: 'oseltamivir' },
  { label: 'Amlodipine',     value: 'amlodipine' },
  { label: 'Losartan',       value: 'losartan' },
  { label: 'Insulin',        value: 'insulin' },
  { label: 'Metformin',      value: 'metformin' },
  { label: 'Prednisolone',   value: 'prednisolone' },
  { label: 'Dexamethasone',  value: 'dexamethasone' },
  { label: 'Warfarin',       value: 'warfarin' },
  { label: 'Rivaroxaban',    value: 'rivaroxaban' },
  { label: 'Atorvastatin',   value: 'atorvastatin' },
  { label: 'Simvastatin',    value: 'simvastatin' },

];


// ====== map ปุ่มต่างๆ กับ element ======//
document.addEventListener('includes:done', () => {
    const genericDrugInput = document.getElementById('genericInput');
    const genericDrugList = document.getElementById('genericList');

    // ถ้าหาไม่ก็จบ
    if (!genericDrugInput || !genericDrugList) return;

    //ตำแหน่งของไอเท็มที่กำลังโดนไฮไลต์อยู่เวลาที่เลือกรายการ ซึ่งเป็นรายการ autocomplete จากอารเรย์ข้างบนนู่น
    //0-เริ่มต้นที่ -1 หมายถึงยังไม่มีไอเท็มไหนถูกเลือกเพราะเด๊่ยวเราค่อผูกปุ่มหรือเอาเม้าส์ไปเลือกมันทีหลัง
    let activeIndex = -1;

    // สร้างอารเรย์ไว้เก็บไอเท็มที่แสดงในรายการ autocomplete
    // เป็นรายการที่กรองมาจาก genericDrugAutocompleteData ตามที่ผู้ใช้พิมพ์ เดี๋ยวฟังก์ชั่นนี้จะเขียนต่อข้างล่าง
    let currentItems = []; 

    // ฟังก์ชันช่วยทำให้สตริงเป็นมาตรฐานเดียวกัน (lowercase + trim) = normalize string => norm s ไง
    //ตัวหัวท้าย ทำให้เป็นพิมพ์เล็กทั้งหมดเวลาเทียบกัน
    const norm = s => (s || '').toLowerCase().trim();


    //================================================================
    //================== ฟังก์ชัน render druglist =======================
    //================================================================

    // จำอารเรย์ข้างบนได้มั้ย เราจะเอาอาร์กิวเมนต์ items ไปใส่ตรงนั้น
    // q คือ ค่าที่ผู้ใช้พิมพ์เข้ามาในช่อง input
    function genericDrugRender(items, q) {
        currentItems = items; // อัปเดตอารเรย์ไอเท็มปัจจุบัน
        activeIndex = -1; // รีเซ็ตดัชนีที่ใช้งานอยู่

        //ถ้ายังไม่มีใครพิมพ์อะไรเลย druglist จะซ่อนตัว ทั้งรายการ และ ตัวโครง html ของมันด้วย
        if(!items.length) {
            genericDrugList.hidden = true;
            genericDrugList.innerHTML = '';
            return;
        }

        // สร้างโครง HTML สำหรับรายการ autocomplete เป็น ตัว item ที่ถูก loop ด้วย .map คือวนทุก item แล้วกลายเป็น array ของ string html ใหม่
        // แล้วเอามาต่อกันเป็น string เดียวด้วย .join('')
        // ในแต่ละ item เราจะเน้นคำที่ผู้ใช้พิมพ์เข้ามา (q) ด้วย span ที่มีคลาส ac__muted
        // data-index เก็บดัชนีของไอเท็มในอารเรย์ items ไว้ เพื่อใช้ตอนคลิกเลือกไอเท็ม
        // หรือง่ายๆก็คือ มันจะทำให้รู้ว่าเราเลือกไอเท็มไหนจากรายการ autocomplete นั่นเอง
        // ยากชิบหาย 
        genericDrugList.innerHTML = items.map((item, index) => {
            // ค่านี้คือ ค่า label ของ ไอเท็มปัจจุบัน
            const genericSafeLabel = item.label;
            // ทำให้ q เป็นมาตรฐานเดียวกัน
            // q คือ ค่าที่ผู้ใช้พิมพ์เข้ามาในช่อง input
            const nq = norm(q);
            // หาตำแหน่งที่คำที่พิมพ์เข้ามา (nq) ปรากฏใน label ของไอเท็มนี้ (label ก็โดน norm ด้วย เพื่อให้เทียบกันได้)
            const i = norm(genericSafeLabel).indexOf(nq);
            // สร้าง html สำหรับไอเท็มนี้
            let html = genericSafeLabel;
            if (nq && i >= 0) {
                // ถ้าพบคำที่พิมพ์ใน label ให้เน้นคำที่พบด้วย span
                html = genericSafeLabel.slice(0, i) +
                    '<span class="ac__muted">' + genericSafeLabel.slice(i, i + nq.length) + '</span>' + 
                    genericSafeLabel.slice(i + nq.length);
            }
            // ห่อไอเท็มด้วย div ที่มีคลาส ac__item และ data-index
            // ผลที่ได้คือตัวที่เลือกใน autocomplete จะมี data-index เพื่อบอกตำแหน่งของมันในอารเรย์ itemsและจะมี css 
            // เรืองแสงตอนเลือกด้วย
            return `<div class="ac__item" data-index="${index}">${html}</div>`;
        }).join('');

        // แสดงรายการ autocomplete
        genericDrugList.hidden = false;
    }

    //================================================================
    //================== ฟังก์ชันกรอง druglist =======================
    //================================================================

    // ฟังก์ชันกรองข้อมูล genericDrugAutocompleteData ตามค่าที่ผู้ใช้พิมพ์เข้ามา
    // ถ้าตัวที่ user พิมพ์มาแล้วไม่ตรงกับอะไรเลยก็ส่งมาเป็น อาร์เรย์ว่าง
    function genericFilterData(q) {
        const nq = norm(q);
        if (!nq) return [];
        // กรองข้อมูลโดยดูว่า label มีคำที่พิมพ์เข้ามา (nq) อยู่ในนั้นมั้ย
        return genericDrugAutocompleteData
            .filter(item => norm(item.label).includes(nq))
            .slice(0, 10); // จำกัดผลลัพธ์สูงสุด 10 รายการ
        }


    //================================================================
    //==== ฟังก์ชันจัดการการเลือกไอเท็มไฮไลท์หนึ่งเดียวตอนผู้ใช้เลื่อนหา ===========
    //================================================================
    function setGenericActive(index) {
        //ตั้งให้ nodes เป็นทุกตัวที่อยู่ใน druglist ตอนนีั้ (ที่กำหนดไว้คือ 10 ตัว ข้างบนนู่นน)
        const nodes = genericDrugList.querySelectorAll('.ac__item');
        // เอาคลาส is-active ออกจากทุกตัวก่อน เพื่อให้ต่อไปมีจะมีแค่ตัวเดียวที่โดนไฮไลต์
        nodes.forEach(n => n.classList.remove('is-active'));
        // ให้เพิ่มคลาส is-active ให้กับไอเท็มที่ index ตรงกับอาร์กิวเมนต์ที่ส่งมา
        if (index >= 0 && index < nodes.length) {
            nodes[index].classList.add('is-active');
            // เลื่อนหน้าให้ไอเท็มที่เลือกอยู่ในมุมมองเสมอ ให้มัน scroll ตามดูตัวที่ถูกไฮไบต์อันนั้นไง
            nodes[index].scrollIntoView({ block: 'nearest' });
            activeIndex = index;
        }
    }


    //================================================================
    //============= ฟังก์ชันเลือกไอเท็มจากรายการ autocomplete ===========
    //================================================================
    function genericChooseItem(index) {
        const gnrItm = currentItems[index];
        if (!gnrItm) return;
        // ตั้งค่าช่อง input เป็น label ของไอเท็มที่เลือก
        genericDrugInput.value = gnrItm.label;
        // เก็บค่าที่เลือกไว้ใน dataset เผื่อจะได้ใช้ต่อ
        genericDrugInput.dataset.value = gnrItm.value;
        // ซ่อนรายการ autocomplete หลังผู้ใช้เลือกไอเท็มแล้ว
        genericDrugList.hidden = true;
    }

    //================================================================
    //================== ผูก event ต่างๆ =============================
    //================================================================
    genericDrugInput.addEventListener('input', () => {
        const items = genericFilterData(genericDrugInput.value);
        genericDrugRender(items, genericDrugInput.value);
    });

    genericDrugInput.addEventListener('keydown', (e) => {
        if (genericDrugList.hidden) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                // ถาม chatgpt เถอะ อันนี้อธิบายเห็นภาพมาก
                setGenericActive(Math.min(activeIndex + 1, currentItems.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setGenericActive(Math.max(activeIndex - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            genericChooseItem(activeIndex);
        } else if  (e.key === 'Escape') {
            genericDrugList.hidden = true;
        }
    });

    genericDrugList.addEventListener('click', (e) => {
        const itemEl = e.target.closest('.ac__item');
        if (!itemEl) return;
        genericChooseItem(Number(itemEl.dataset.index));
    });

    document.addEventListener('click', (e) => {
        if(!e.target.closest('.genericNameAutocomplete')) genericDrugList.hidden = true;
        });
});



// ====================PACK SIZE=======================//
// ============== pack size data input ===============//
// ====================================================//

// ผูก element สำหรับ Pack size (เลือกได้หลายรายการ) ใน modal nP
document.addEventListener('includes:done', () => {
  const packSelect = document.getElementById('pack-select');
  const packCustomInput = document.getElementById('custom-pack-input');
  const packAddBtn = document.getElementById('add-pack-btn');
  const list = document.getElementById('pack-list');

  if (!packSelect || !packCustomInput || !packAddBtn || !list) return;

  function toggleCustomInput() {
    if (packSelect.value === 'Other') {
      packCustomInput.style.display = 'block';
      packCustomInput.focus();
    } else {
      packCustomInput.style.display = 'none';
      packCustomInput.value = '';
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function addPack() {
    let text = '';

    if (packSelect.value === 'Other') {
      text = packCustomInput.value.trim();
    } else {
      // ✅ pack size เราอยากเก็บ “ข้อความที่เห็น” มากกว่า value โค้ดๆ
      text = packSelect.options[packSelect.selectedIndex]?.textContent.trim() || '';
    }

    if (!text) return;

    // กันซ้ำ
    const exists = [...list.querySelectorAll('li span')]
      .some(span => span.textContent.trim() === text);
    if (exists) return;

    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(text)}</span>
      <button class="delete-btn" type="button">Delete</button>
    `;
    li.querySelector('.delete-btn').addEventListener('click', () => li.remove());
    list.appendChild(li);

    // reset
    packSelect.value = '';
    packCustomInput.value = '';
    packCustomInput.style.display = 'none';
  }

  packSelect.addEventListener('change', toggleCustomInput);
  packAddBtn.addEventListener('click', addPack);

  packCustomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPack();
  });
});

// ====================ROUTE OF ADMINISTRATION=======================//
// ============== route data input (multi) ===============//
document.addEventListener('includes:done', () => {
  const routeSelect = document.getElementById('route-select');
  const routeCustomInput = document.getElementById('custom-route-input');
  const routeAddBtn = document.getElementById('add-route-btn');
  const list = document.getElementById('route-list');

  if (!routeSelect || !routeCustomInput || !routeAddBtn || !list) return;

  function toggleCustomInput() {
    if (routeSelect.value === 'Other') {
      routeCustomInput.style.display = 'block';
      routeCustomInput.focus();
    } else {
      routeCustomInput.style.display = 'none';
      routeCustomInput.value = '';
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function addRoute() {
    let text = '';

    if (routeSelect.value === 'Other') {
      text = routeCustomInput.value.trim();
    } else {
      text = routeSelect.options[routeSelect.selectedIndex]?.textContent.trim() || '';
    }

    if (!text) return;

    const exists = [...list.querySelectorAll('li span')]
      .some(span => span.textContent.trim() === text);
    if (exists) return;

    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(text)}</span>
      <button class="delete-btn" type="button">Delete</button>
    `;
    li.querySelector('.delete-btn').addEventListener('click', () => li.remove());
    list.appendChild(li);

    routeSelect.value = '';
    routeCustomInput.value = '';
    routeCustomInput.style.display = 'none';
  }

  routeSelect.addEventListener('change', toggleCustomInput);
  routeAddBtn.addEventListener('click', addRoute);

  routeCustomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addRoute();
  });
});
