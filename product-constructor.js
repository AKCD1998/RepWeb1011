class Rx1011Product {
  constructor(companyId, productName, genericName, strength, dosageForm, routeOfAdministration, packSize, price, reportType, limitedQtyperBill,manufacturer) {
    this.companyId = companyId;
    this.productName = productName;
    this.genericName = genericName;
    this.strength = strength;
    this.dosageForm = dosageForm;
    this.routeOfAdministration = routeOfAdministration;
    this.packSize = packSize;
    this.price = price;
    this.reportType = reportType;
    this.limitedQtyperBill = limitedQtyperBill;
    this.manufacturer = manufacturer;
  }
}

class StockItem extends Rx1011Product {
  constructor(
    companyId, productName, genericName, strength, dosageForm, routeOfAdministration, packSize, price, reportType, limitedQtyperBill,
    branchId, batchNumber, qtyOnHand
  ) {
    super(companyId, productName, genericName, strength, dosageForm, routeOfAdministration, packSize, price, reportType, limitedQtyperBill);
    this.branchId = branchId;     // "001" | "003" | "004"
    this.batchNumber = batchNumber;
    this.qtyOnHand = qtyOnHand;
  }
}


export default Rx1011Product;