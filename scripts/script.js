import products from "./product-oop.js";

// script ที่หาจาก googleมาเพื่อแปลง excel เป็น csv
    // เพิ่ม event listener ให้กับ elementId fileInput เมื่อมีการเปลี่ยนแปลงไฟล์จากการเลือกไฟล์ จะเรียกใช้ฟังก์ชัน handleFile
    document.getElementById('fileInput').addEventListener('change', handleFile, false);
    document.querySelector('.startProcessing').addEventListener('click', processFile, false);
    document.getElementById('productId').innerText = "";
    document.getElementById('productName').innerText = "";
    document.getElementById('productMaker').innerText = "";

    // helper function to handle file input change event
    //เมื่อเราเลือกไฟล์ files จะเป็น array ของไฟล์ที่เราเลือก
    function handleFile(e) {
      const files = e.target.files;
      if (files.length === 0) return;
    }

    // helper function to process the file
    function processFile(e) {
      // หยุดการ submit form ปกติ
      e.preventDefault();

      // ดึงไฟล์จาก elementId fileInput
      const fileInput = document.getElementById('fileInput');
      const files = fileInput.files;
      
      // หาไฟล์ไม่เจอ ก็ไม่ต้องทำอะไร
      if (files.length === 0) return;

      // อ่านไฟล์แรกที่เจอ Array index = 0
      const file = files[0];

      // sheetjs method to read file
      const reader = new FileReader();

      reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const csvOutput = XLSX.utils.sheet_to_csv(worksheet);

        console.log("CSV output:", csvOutput);

        const csvWorkbook = XLSX.read(csvOutput, { type: 'string' });
        const csvWorksheet = csvWorkbook.Sheets[csvWorkbook.SheetNames[0]];

        const grid = XLSX.utils.sheet_to_json(csvWorksheet, { header: 1, defval: "" });

        const resultsCsvArray = [];
        // loop through each row in the grid
        for (let i = 0 ; i < grid.length; i++) {
          const hit = extractDataAndQtyDispensed(grid[i]);
          if (hit) {
            resultsCsvArray.push([hit.date, hit.quantity]);     
          }
        }
        console.log("date + quantity(แผง):", resultsCsvArray);

        // extract company IDs from the csv output
        const companyIds = extractCompanyIds(csvOutput);
        // companyId ตัวแรกที่ถูก push เข้าไปใน array
        const firstId = companyIds[0] ?? "";
        // แสดงผล company ID ตัวแรกในหน้า HTML
        document.getElementById('productId').innerText = firstId;

        // get product's info from the company IDs
        const productsInfo = getProductsByIds(companyIds);
        console.log("products info:", productsInfo);

        document.getElementById('productName').innerText = productsInfo[0]?.product?.productName ?? "ไม่พบชื่อสินค้า";
        document.getElementById('productMaker').innerText = productsInfo[0]?.product?.manufacturer ?? "ไม่พบผู้ผลิตสินค้า";
        document.getElementById('productRepType').innerText = productsInfo[0]?.product?.reportType ?? "ไม่พบประเภทการรายงานสินค้า";
        


        
        /*
        // call helper function to download the csv file และอารกิวเมนต์เป็นชนิดของไฟล์ และ ชื่อไฟล์
        downloadCSV(csvOutput, 'converted_file.csv');
        เก็บไว้ก่อนเพราะยังไม่ต้องการดาวน์โหลดไฟล์ตอนนี้ แต่แค่อยากจะเปลี่ยนไฟล์
        */
      
      };

      reader.readAsArrayBuffer(file);
    }



    // helper function to parse number from string 
    //เอาไว้หาจำนวนแผงที่จ่ายจริง ในแต่ละช่วงเวลานั้น
    function parseNumber(str) {
      const trimmedString = String(str).trim().replace(/^"|"$/g, ""); // remove quotes
      if (!trimmedString) return null; // handle empty strings
      const numb = Number(trimmedString.replace(/,/g, '')); // remove commas and convert to number
      return Number.isFinite(numb) ? numb : null; // return null for non-numeric values
    }

    // helper function to find date in a row
    function findDateInRow(row) {
      const re = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      for (const cell of row) {
        const value = String(cell ?? "").trim();
        if (re.test(value)) return value;
      }
      return null;
    }



    // helper function to extract date and QtyDispensed from a row
    function extractDataAndQtyDispensed(row) {
      // หา index ของคอลัมน์ที่มีคำว่า 'แผง' (QtyDispensed)
      const QtyDispIndex = row.findIndex(cell => String(cell).trim().toLowerCase() === 'แผง');
      if (QtyDispIndex <= 0) return null;
    
      // ดึงค่าจำนวนแผงที่จ่ายโดยอ้างอิงจาก index ที่หาคำว่าแผงเจอแล้ว - 1 
      // เพราะค่าจำนวนแผงจะอยู่ก่อนหน้าคำว่า แผง
      const quantity = parseNumber(row[QtyDispIndex - 1]);
      const dateStr = findDateInRow(row);

      if (!dateStr || quantity === null) return null;
      return { date: dateStr, quantity: quantity };
    
    }


    // extract the company IDs from a csv string
    // regex pattern to match company IDs 
    // 6300xxxxxx or IC-xxxxxx
    const COMPANY_ID_RE = /\b(?:630\d{6}|IC-\d{6})\b/g;
    const productByIdMap = new Map(products.map(p => [p.companyId, p]));

    // helper function to extract company IDs from csv output
    function extractCompanyIds(csvOutput) {
      // ids จะเป็น array ของ company IDs ที่เป็น regex condition ที่เจอใน csvOutput 
      const ids = csvOutput.match(COMPANY_ID_RE) || [];
      // เอาเฉพาะค่าไม่ซ้ำกันด้วย Set แล้วแปลงกลับเป็น array
      const uniqueIds = Array.from(new Set(ids));
      // แสดงผล company IDs ที่เจอในหน้า HTML
      document.getElementById('productId').innerText = uniqueIds.join(', ');
      
      // เอาค่าที่ได้ไปใช้ต่อใน.....
      /*
        const companyIds = extractCompanyIds(csvOutput);
        const firstId = companyIds[0] ?? "";
        document.getElementById('productId').innerText = firstId;
        */ 
      return uniqueIds;

    }






    // helper function to get products by their company IDs
    function getProductsByIds(ids) {



      // return ที่ได้ไปใช้ต่อใน....

      /*
        const productsInfo = getProductsByIds(companyIds);
        console.log("products info:", productsInfo);
        document.getElementById('productName').innerText = productsInfo[0]?.product?.productName ?? "ไม่พบชื่อสินค้า";
      */

      return ids.map(id => ({
        id,
        product: productByIdMap.get(id) ?? null
      }));
    }




    
    /*
    //helper function to download csv file เก็บไว้ก่อน เดี๋ยวค่อยใช้
    function downloadCSV(csvString, fileName) {
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      // สร้างลิงก์ดาวน์โหลดไฟล์ CSV และคลิกเพื่อดาวน์โหลดไฟล์
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }*/



      

      // ========== HANDLING index.html's button menu active state ==========

      document.addEventListener('includes:done', () => {

      const tabButtons = document.querySelectorAll('.item0-grid [data-tab]');
      const sections   = document.querySelectorAll('[data-section]');

      //console.log('sections found:', sections.length, [...sections].map(s => s.dataset.section));

      //console.log('tabButtons count:', tabButtons.length);
      tabButtons.forEach(b => console.log('button:', b.textContent.trim(), 'data-tab=', b.dataset.tab));

      

      function activateTab(tabName) {
        //console.log('activateTab called with:', tabName);

        const target = document.querySelector(`[data-section="${tabName}"]`);
        //console.log('target section found?', !!target, target);

        // button glow state only one button at a time
        tabButtons.forEach(btn => {
          btn.classList.toggle('is-active', btn.dataset.tab === tabName);
        });

        // sections : show/hide based on active tab
        sections.forEach(section => {
          const shouldHide = section.dataset.section !== tabName;
          section.classList.toggle('hidden', shouldHide);
        });
      }

      // wiring onclick event to each button
      tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          //console.log('clicked:', btn.dataset.tab, btn);
          activateTab(btn.dataset.tab);
        });
      });

      // set default active tab to 'report'
      activateTab('report');
    });

            

    document.getElementById('loginForm').addEventListener('submit', function(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const messageArea = document.getElementById('message');

    // Replace with your actual back-end login API endpoint
    const apiEndpoint = 'https://api.example.com/login';

    fetch(apiEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username, password: password }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.accessToken) {
            // Store the JWT securely (e.g., in localStorage)
            localStorage.setItem('jwt', data.accessToken);
            messageArea.style.color = 'green';
            messageArea.textContent = 'Login successful! Redirecting...';
            // Redirect to a protected page (e.g., index.html)
            window.location.href = 'index.html'; 
        } else {
            messageArea.textContent = data.message || 'Login failed';
        }
    })
    .catch(error => {
        console.error('Error:', error);
        messageArea.textContent = 'An error occurred. Please try again.';
    });
});
