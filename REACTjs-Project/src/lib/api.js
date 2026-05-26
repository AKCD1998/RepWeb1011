import { authApiClient } from "./authApi";
import { normalizeDateOnlyInput } from "./dateOnly";

async function requestJson(config) {
  const response = await authApiClient.request(config);
  if (response.status === 204) return null;
  return response.data;
}

function normalizeBangkokDateTimeInput(value) {
  const text = String(value ?? "").trim();
  if (!text) return value;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    return text;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)) {
    return `${text}+07:00`;
  }
  return text;
}

function buildStockOnHandParams(filters = {}) {
  const params = {};
  const branchCode = String(filters?.branchCode || "").trim();
  const productId = String(filters?.productId || "").trim();

  if (branchCode) {
    params.branchCode = branchCode;
  }
  if (productId) {
    params.productId = productId;
  }

  return Object.keys(params).length ? params : undefined;
}

function buildMovementWriteRequestPayload(payload = {}) {
  const movementType = String(payload.movementType || "").trim().toUpperCase();
  const productId = String(payload.productId || "").trim();
  const qty = Number(payload.qty);
  const unitLevelId = String(payload.unitLevelId ?? payload.unit_level_id ?? "").trim();
  const unitLabel = String(payload.unitLabel || payload.unit || "").trim();
  const fromLocationId = String(payload.from_location_id ?? payload.fromLocationId ?? "").trim();
  const toLocationId = String(payload.to_location_id ?? payload.toLocationId ?? "").trim();
  const lotId = String(payload.lotId ?? payload.lot_id ?? "").trim();
  const lotNo = String(payload.lotNo ?? payload.lot_no ?? "").trim();
  const expDate = normalizeDateOnlyInput(payload.expDate ?? payload.exp_date);
  const mfgDate = normalizeDateOnlyInput(payload.mfgDate ?? payload.mfg_date);
  const manufacturer = String(payload.manufacturer ?? payload.manufacturerName ?? "").trim();

  if (!movementType) {
    throw new Error("movementType is required");
  }
  if (!productId) {
    throw new Error("productId is required");
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("qty must be a positive number");
  }
  if (!unitLevelId && !unitLabel) {
    throw new Error("unitLevelId or unitLabel is required");
  }
  if (!lotId && !lotNo) {
    throw new Error("lotNo is required");
  }
  if (!lotId && !expDate) {
    throw new Error("expDate is required");
  }

  const occurredAt = normalizeBangkokDateTimeInput(payload.occurredAt);
  const note = String(payload.note || "").trim() || null;
  const requestPayload = {
    movementType,
    productId,
    qty,
    lotNo,
    expDate,
    occurredAt,
    note,
  };

  if (lotId) {
    requestPayload.lot_id = lotId;
  }
  if (unitLevelId) {
    requestPayload.unit_level_id = unitLevelId;
  }
  if (unitLabel) {
    requestPayload.unitLabel = unitLabel;
  }
  if (mfgDate) {
    requestPayload.mfgDate = mfgDate;
  }
  if (manufacturer) {
    requestPayload.manufacturer = manufacturer;
  }
  if (fromLocationId) {
    requestPayload.from_location_id = fromLocationId;
  }
  if (toLocationId) {
    requestPayload.to_location_id = toLocationId;
  }

  return requestPayload;
}

function buildIncidentItemsPayload(items = []) {
  return Array.isArray(items)
    ? items.map((item) => ({
        productId: String(item?.productId ?? item?.product_id ?? "").trim(),
        lotId: String(item?.lotId ?? item?.lot_id ?? "").trim() || null,
        qty: Number(item?.qty),
        unitLevelId: String(item?.unitLevelId ?? item?.unit_level_id ?? "").trim() || null,
        unitLabel: String(
          item?.unitLabel ?? item?.unit_label ?? item?.unitLabelSnapshot ?? item?.unit_label_snapshot ?? ""
        ).trim() || null,
        lotNoSnapshot: String(
          item?.lotNoSnapshot ?? item?.lot_no_snapshot ?? item?.lotNo ?? item?.lot_no ?? ""
        ).trim() || null,
        expDateSnapshot:
          normalizeDateOnlyInput(item?.expDateSnapshot ?? item?.exp_date_snapshot) || null,
        note: String(item?.note ?? item?.noteText ?? item?.note_text ?? "").trim() || null,
      }))
    : [];
}

function buildIncidentResolutionActionsPayload(actions = []) {
  return Array.isArray(actions)
    ? actions.map((action) => ({
        actionType: String(action?.actionType ?? action?.action_type ?? "").trim().toUpperCase(),
        movementId: String(action?.movementId ?? action?.movement_id ?? "").trim() || null,
        newLotId: String(action?.newLotId ?? action?.new_lot_id ?? "").trim() || null,
        productId: String(action?.productId ?? action?.product_id ?? "").trim(),
        lotId: String(action?.lotId ?? action?.lot_id ?? "").trim() || null,
        qty: Number(action?.qty),
        unitLevelId: String(action?.unitLevelId ?? action?.unit_level_id ?? "").trim() || null,
        unitLabel: String(
          action?.unitLabel ?? action?.unit_label ?? action?.unitLabelSnapshot ?? action?.unit_label_snapshot ?? ""
        ).trim() || null,
        lotNoSnapshot: String(
          action?.lotNoSnapshot ?? action?.lot_no_snapshot ?? action?.lotNo ?? action?.lot_no ?? ""
        ).trim() || null,
        expDateSnapshot:
          normalizeDateOnlyInput(action?.expDateSnapshot ?? action?.exp_date_snapshot) || null,
        note: String(action?.note ?? action?.noteText ?? action?.note_text ?? "").trim() || null,
      }))
    : [];
}

function buildIncidentResolutionPatientPayload(patient = {}) {
  const source = patient && typeof patient === "object" ? patient : {};
  const pid = String(source?.pid ?? "").trim();
  const fullName = String(source?.fullName ?? source?.full_name ?? source?.name ?? "").trim();
  const englishName = String(source?.englishName ?? source?.english_name ?? "").trim();
  const birthDate =
    normalizeDateOnlyInput(source?.birthDate ?? source?.birth_date) || null;
  const sex = String(source?.sex ?? "").trim();
  const cardIssuePlace = String(source?.cardIssuePlace ?? source?.card_issue_place ?? "").trim();
  const cardIssuedDate =
    normalizeDateOnlyInput(source?.cardIssuedDate ?? source?.card_issued_date) || null;
  const cardExpiryDate =
    normalizeDateOnlyInput(source?.cardExpiryDate ?? source?.card_expiry_date) || null;
  const addressText = String(
    source?.addressText ?? source?.address_text ?? source?.address_raw_text ?? ""
  ).trim();

  if (
    !pid &&
    !fullName &&
    !englishName &&
    !birthDate &&
    !sex &&
    !cardIssuePlace &&
    !cardIssuedDate &&
    !cardExpiryDate &&
    !addressText
  ) {
    return undefined;
  }

  return {
    pid: pid || undefined,
    fullName: fullName || undefined,
    englishName: englishName || undefined,
    birthDate: birthDate || undefined,
    sex: sex || undefined,
    cardIssuePlace: cardIssuePlace || undefined,
    cardIssuedDate: cardIssuedDate || undefined,
    cardExpiryDate: cardExpiryDate || undefined,
    addressText: addressText || undefined,
  };
}

export const productsApi = {
  list(search = "") {
    const value = String(search || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/products",
      params: value ? { search: value } : undefined,
    });
  },
  unitLevels(productId, options = {}) {
    const id = String(productId || "").trim();
    if (!id) {
      return Promise.resolve({ items: [] });
    }

    const params = {};
    const lotId = String(options?.lotId || options?.lot_id || "").trim();
    const lotNo = String(options?.lotNo || options?.lot_no || "").trim();
    const expDate = normalizeDateOnlyInput(options?.expDate || options?.exp_date);

    if (lotId) {
      params.lotId = lotId;
    }
    if (lotNo) {
      params.lotNo = lotNo;
    }
    if (expDate) {
      params.expDate = expDate;
    }

    return requestJson({
      method: "GET",
      url: `/api/products/${encodeURIComponent(id)}/unit-levels`,
      params: Object.keys(params).length ? params : undefined,
    });
  },
  lotWhitelists(productId) {
    const id = String(productId || "").trim();
    if (!id) {
      return Promise.resolve({ productId: "", unitLevels: [], lots: [] });
    }

    return requestJson({
      method: "GET",
      url: `/api/products/${encodeURIComponent(id)}/lot-whitelists`,
    });
  },
  updateLotWhitelist(productId, lotId, payload = {}) {
    const id = String(productId || "").trim();
    const normalizedLotId = String(lotId || "").trim();
    if (!id) {
      throw new Error("productId is required");
    }
    if (!normalizedLotId) {
      throw new Error("lotId is required");
    }

    return requestJson({
      method: "PUT",
      url: `/api/products/${encodeURIComponent(id)}/lots/${encodeURIComponent(normalizedLotId)}/whitelist`,
      data: {
        allowedUnitLevelIds: Array.isArray(payload?.allowedUnitLevelIds)
          ? payload.allowedUnitLevelIds
          : [],
        defaultUnitLevelId: String(payload?.defaultUnitLevelId || "").trim() || null,
      },
    });
  },
  updateLotMetadata(productId, lotId, payload = {}) {
    const id = String(productId || "").trim();
    const normalizedLotId = String(lotId || "").trim();
    const lotNo = String(payload?.lotNo ?? payload?.lot_no ?? "").trim();
    const mfgDate = normalizeDateOnlyInput(payload?.mfgDate ?? payload?.mfg_date) || null;
    const expDate = normalizeDateOnlyInput(payload?.expDate ?? payload?.exp_date);
    const reason = String(payload?.reason ?? payload?.reasonText ?? payload?.reason_text ?? "").trim();

    if (!id) {
      throw new Error("productId is required");
    }
    if (!normalizedLotId) {
      throw new Error("lotId is required");
    }
    if (!lotNo) {
      throw new Error("lotNo is required");
    }
    if (!expDate) {
      throw new Error("expDate is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    return requestJson({
      method: "PUT",
      url: `/api/products/${encodeURIComponent(id)}/lots/${encodeURIComponent(normalizedLotId)}/metadata`,
      data: {
        lotNo,
        mfgDate,
        expDate,
        reason,
      },
    });
  },
  normalizeLot(productId, payload = {}) {
    const id = String(productId || "").trim();
    const sourceLotId = String(payload?.sourceLotId ?? payload?.source_lot_id ?? "").trim();
    const targetLotId = String(payload?.targetLotId ?? payload?.target_lot_id ?? "").trim();
    const targetLotNo = String(payload?.targetLotNo ?? payload?.target_lot_no ?? "").trim();
    const targetMfgDate = normalizeDateOnlyInput(
      payload?.targetMfgDate ?? payload?.target_mfg_date ?? payload?.mfgDate ?? payload?.mfg_date
    ) || null;
    const targetExpDate = normalizeDateOnlyInput(
      payload?.targetExpDate ?? payload?.target_exp_date ?? payload?.expDate ?? payload?.exp_date
    );
    const reason = String(payload?.reason ?? payload?.reasonText ?? payload?.reason_text ?? "").trim();

    if (!id) {
      throw new Error("productId is required");
    }
    if (!sourceLotId) {
      throw new Error("sourceLotId is required");
    }
    if (!targetLotNo) {
      throw new Error("targetLotNo is required");
    }
    if (!targetExpDate) {
      throw new Error("targetExpDate is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    return requestJson({
      method: "POST",
      url: `/api/products/${encodeURIComponent(id)}/lots/normalize`,
      data: {
        sourceLotId,
        targetLotId: targetLotId || undefined,
        targetLotNo,
        targetMfgDate,
        targetExpDate,
        reason,
      },
    });
  },
  reportGroups() {
    return requestJson({
      method: "GET",
      url: "/api/products/report-groups",
    });
  },
  genericNames() {
    return requestJson({
      method: "GET",
      url: "/api/products/generic-names",
    });
  },
  activeIngredients(search = "") {
    const value = String(search || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/active-ingredients",
      params: value ? { q: value } : undefined,
    });
  },
  unitTypes(search = "") {
    const value = String(search || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/products/unit-types",
      params: value ? { q: value } : undefined,
    });
  },
  create(payload) {
    return requestJson({
      method: "POST",
      url: "/api/products",
      data: payload,
    });
  },
  update(id, payload) {
    return requestJson({
      method: "PUT",
      url: `/api/products/${id}`,
      data: payload,
    });
  },
  remove(id) {
    return requestJson({
      method: "DELETE",
      url: `/api/products/${id}`,
    });
  },
};

export const INVENTORY_CHANGED_EVENT = "inventory:changed";

function emitInventoryChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INVENTORY_CHANGED_EVENT));
}

export const inventoryApi = {
  async createMovement(payload = {}) {
    const requestPayload = buildMovementWriteRequestPayload(payload);
    const response = await requestJson({
      method: "POST",
      url: "/api/inventory/movements",
      data: requestPayload,
    });
    emitInventoryChanged();
    return response;
  },
  async createMovementBatch(movements = []) {
    const list = Array.isArray(movements) ? movements : [];
    if (!list.length) {
      throw new Error("movements must contain at least one item");
    }

    const requestPayload = list.map((movement) => buildMovementWriteRequestPayload(movement));
    const response = await requestJson({
      method: "POST",
      url: "/api/inventory/movements/batch",
      data: {
        movements: requestPayload,
      },
    });
    emitInventoryChanged();
    return response;
  },
  updateMovementOccurredAtCorrection(id, payload = {}) {
    const movementId = String(id || "").trim();
    const correctedOccurredAt = normalizeBangkokDateTimeInput(
      String(payload.correctedOccurredAt ?? payload.corrected_occurred_at ?? payload.occurredAt ?? "").trim()
    );
    const reason = String(payload.reason ?? payload.reasonText ?? payload.reason_text ?? "").trim();

    if (!movementId) {
      throw new Error("movement id is required");
    }
    if (!correctedOccurredAt) {
      throw new Error("correctedOccurredAt is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    return requestJson({
      method: "PATCH",
      url: `/api/inventory/movements/${encodeURIComponent(movementId)}/occurred-at-correction`,
      data: {
        correctedOccurredAt,
        reason,
      },
    });
  },
  async deleteMovement(id, payload = {}) {
    const movementId = String(id || "").trim();
    const reason = String(payload.reason ?? payload.reasonText ?? payload.reason_text ?? "").trim();

    if (!movementId) {
      throw new Error("movement id is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    const response = await requestJson({
      method: "DELETE",
      url: `/api/inventory/movements/${encodeURIComponent(movementId)}`,
      data: {
        reason,
      },
    });
    emitInventoryChanged();
    return response;
  },
  receive(payload) {
    return requestJson({
      method: "POST",
      url: "/api/inventory/receive",
      data: payload,
    });
  },
  transfer(payload) {
    return requestJson({
      method: "POST",
      url: "/api/inventory/transfer",
      data: payload,
    });
  },
  listTransferRequests({ status, limit, location_id } = {}) {
    const params = {};
    if (status) {
      params.status = String(status).trim();
    }
    if (location_id) {
      params.location_id = String(location_id).trim();
    }
    if (limit !== undefined && limit !== null && Number.isFinite(Number(limit))) {
      params.limit = String(Math.min(Math.max(Math.floor(Number(limit)), 1), 100));
    }

    return requestJson({
      method: "GET",
      url: "/api/inventory/transfer-requests",
      params: Object.keys(params).length ? params : undefined,
      suppressUnauthorizedEvent: true,
    });
  },
  async acceptTransferRequest(id, payload = {}) {
    const requestId = String(id || "").trim();
    if (!requestId) {
      throw new Error("transfer request id is required");
    }

    const response = await requestJson({
      method: "POST",
      url: `/api/inventory/transfer-requests/${encodeURIComponent(requestId)}/accept`,
      data: {
        note: String(payload.note ?? payload.decisionNote ?? "").trim() || undefined,
      },
    });
    emitInventoryChanged();
    return response;
  },
  async rejectTransferRequest(id, payload = {}) {
    const requestId = String(id || "").trim();
    const reason = String(payload.reason ?? payload.decisionNote ?? "").trim();
    if (!requestId) {
      throw new Error("transfer request id is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    const response = await requestJson({
      method: "POST",
      url: `/api/inventory/transfer-requests/${encodeURIComponent(requestId)}/reject`,
      data: { reason },
    });
    emitInventoryChanged();
    return response;
  },
  listStockOnHand(filters = {}) {
    return requestJson({
      method: "GET",
      url: "/api/stock/on-hand",
      params: buildStockOnHandParams(filters),
    });
  },
  stockOnHand(branchCode = "") {
    return requestJson({
      method: "GET",
      url: "/api/stock/on-hand",
      params: buildStockOnHandParams({ branchCode }),
    });
  },
  deliverSearchProducts(branchCode = "") {
    const safeBranchCode = String(branchCode || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/stock/deliver-search-products",
      params: safeBranchCode ? { branchCode: safeBranchCode } : undefined,
    });
  },
  movements(filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });
    return requestJson({
      method: "GET",
      url: "/api/movements",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  listMovements({ location_id, limit, fromDate, toDate, productId, movementType } = {}) {
    const params = {};
    if (location_id) {
      params.location_id = String(location_id).trim();
    }
    if (productId) {
      params.productId = String(productId).trim();
    }
    if (movementType) {
      params.movementType = String(movementType).trim().toUpperCase();
    }
    if (fromDate) {
      params.fromDate = String(fromDate).trim();
    }
    if (toDate) {
      params.toDate = String(toDate).trim();
    }
    if (limit !== undefined && limit !== null && Number.isFinite(Number(limit))) {
      params.limit = String(Math.min(Math.max(Math.floor(Number(limit)), 1), 1000));
    }

    return requestJson({
      method: "GET",
      url: "/api/movements",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  listLocations({ includeInactive, locationType } = {}) {
    const params = {};
    if (includeInactive !== undefined) {
      params.includeInactive = includeInactive ? "true" : "false";
    }
    if (locationType) {
      params.locationType = String(locationType).trim();
    }

    return requestJson({
      method: "GET",
      url: "/api/locations",
      params: Object.keys(params).length ? params : undefined,
    });
  },
};

export const dispenseApi = {
  create(payload) {
    return requestJson({
      method: "POST",
      url: "/api/dispense",
      data: payload,
    });
  },
  history(filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });
    return requestJson({
      method: "GET",
      url: "/api/dispense/history",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  byPid(pid, filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });
    return requestJson({
      method: "GET",
      url: `/api/patients/${encodeURIComponent(pid)}/dispense`,
      params: Object.keys(params).length ? params : undefined,
    });
  },
};

export const deliveriesApi = {
  returnProduct(payload) {
    return requestJson({
      method: "POST",
      url: "/api/deliveries/return",
      data: payload,
    });
  },
};

export const reportsApi = {
  organicDispenseLedger(filters = {}) {
    const params = {};
    const branchCode = String(filters?.branchCode || "").trim();
    const productId = String(filters?.productId || "").trim();
    const reportGroupCode = String(filters?.reportGroupCode || "").trim().toUpperCase();
    const lotId = String(filters?.lotId || "").trim();
    const dateFrom = String(filters?.dateFrom || "").trim();
    const dateTo = String(filters?.dateTo || "").trim();

    if (!productId) {
      throw new Error("productId is required");
    }

    params.productId = productId;
    if (branchCode) {
      params.branchCode = branchCode;
    }
    if (reportGroupCode) {
      params.reportGroupCode = reportGroupCode;
    }
    if (lotId) {
      params.lotId = lotId;
    }
    if (dateFrom) {
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      params.dateTo = dateTo;
    }

    return requestJson({
      method: "GET",
      url: "/api/reports/organic-dispense-ledger",
      params,
    });
  },
  organicDispenseLedgerActivityProducts(filters = {}) {
    const params = {};
    const branchCode = String(filters?.branchCode || "").trim();
    const reportGroupCode = String(filters?.reportGroupCode || "").trim().toUpperCase();
    const dateFrom = String(filters?.dateFrom || "").trim();
    const dateTo = String(filters?.dateTo || "").trim();

    if (branchCode) {
      params.branchCode = branchCode;
    }
    if (reportGroupCode) {
      params.reportGroupCode = reportGroupCode;
    }
    if (dateFrom) {
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      params.dateTo = dateTo;
    }

    return requestJson({
      method: "GET",
      url: "/api/reports/organic-dispense-ledger/activity-products",
      params,
    });
  },
};

export const incidentsApi = {
  getIncident(id) {
    const incidentId = String(id || "").trim();
    if (!incidentId) {
      throw new Error("incident id is required");
    }

    return requestJson({
      method: "GET",
      url: `/api/incidents/${encodeURIComponent(incidentId)}`,
    });
  },
};

export const adminApi = {
  getDispenseMovement(id) {
    const movementId = String(id || "").trim();
    if (!movementId) {
      throw new Error("movement id is required");
    }

    return requestJson({
      method: "GET",
      url: `/api/admin/dispense-movements/${encodeURIComponent(movementId)}`,
    });
  },
  correctDispenseMovementLot(id, payload = {}) {
    const movementId = String(id || "").trim();
    const newLotId = String(payload?.newLotId ?? payload?.new_lot_id ?? "").trim();
    const reason = String(payload?.reason ?? payload?.reasonText ?? payload?.reason_text ?? "").trim();
    if (!movementId) {
      throw new Error("movement id is required");
    }
    if (!newLotId) {
      throw new Error("newLotId is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    return requestJson({
      method: "PATCH",
      url: `/api/admin/dispense-movements/${encodeURIComponent(movementId)}/correct-lot`,
      data: {
        newLotId,
        reason,
      },
    });
  },
  databaseSchema() {
    return requestJson({
      method: "GET",
      url: "/api/admin/db/schema",
    });
  },
  tableRows(tableName, options = {}) {
    const name = String(tableName || "").trim();
    if (!name) {
      throw new Error("tableName is required");
    }

    const params = {};
    const limit = Number(options?.limit);
    const offset = Number(options?.offset);
    const orderBy = String(options?.orderBy || "").trim();
    const order = String(options?.order || "").trim().toUpperCase();
    if (Number.isFinite(limit)) params.limit = String(limit);
    if (Number.isFinite(offset)) params.offset = String(offset);
    if (orderBy) params.orderBy = orderBy;
    if (order) params.order = order;

    return requestJson({
      method: "GET",
      url: `/api/admin/db/tables/${encodeURIComponent(name)}/rows`,
      params: Object.keys(params).length ? params : undefined,
    });
  },
  executeSql(sql) {
    const text = String(sql ?? "").trim();
    if (!text) {
      throw new Error("sql is required");
    }

    return requestJson({
      method: "POST",
      url: "/api/admin/sql/execute",
      data: { sql: text },
    });
  },
  listIncidents(filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });

    return requestJson({
      method: "GET",
      url: "/api/admin/incidents",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  listPatients(filters = {}) {
    const params = {};
    const search = String(filters?.q ?? filters?.search ?? "").trim();
    const limit = Number(filters?.limit);
    const offset = Number(filters?.offset);

    if (search) {
      params.q = search;
    }
    if (Number.isFinite(limit)) {
      params.limit = String(limit);
    }
    if (Number.isFinite(offset)) {
      params.offset = String(offset);
    }

    return requestJson({
      method: "GET",
      url: "/api/admin/patients",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  getIncident(id) {
    const incidentId = String(id || "").trim();
    if (!incidentId) {
      throw new Error("incident id is required");
    }

    return requestJson({
      method: "GET",
      url: `/api/admin/incidents/${encodeURIComponent(incidentId)}`,
    });
  },
  createIncident(payload = {}) {
    const incidentType = String(payload?.incidentType ?? payload?.incident_type ?? "").trim();
    const incidentReason = String(payload?.incidentReason ?? payload?.incident_reason ?? "").trim();
    const incidentDescription = String(
      payload?.incidentDescription ?? payload?.incident_description ?? ""
    ).trim();
    const branchCode = String(payload?.branchCode ?? payload?.branch_code ?? "").trim();
    const branchId = String(payload?.branchId ?? payload?.branch_id ?? "").trim();
    const happenedAt = normalizeBangkokDateTimeInput(payload?.happenedAt ?? payload?.happened_at);
    const status = String(payload?.status ?? "").trim().toUpperCase();
    const note = String(payload?.note ?? payload?.noteText ?? payload?.note_text ?? "").trim();
    const smartcardSessionId = String(
      payload?.smartcardSessionId ?? payload?.smartcard_session_id ?? ""
    ).trim();
    const dispenseAttemptId = String(
      payload?.dispenseAttemptId ?? payload?.dispense_attempt_id ?? ""
    ).trim();
    const items = buildIncidentItemsPayload(payload?.items);
    const resolutionActions = buildIncidentResolutionActionsPayload(
      payload?.resolutionActions ?? payload?.resolution_actions
    );
    const resolutionPatient = buildIncidentResolutionPatientPayload(
      payload?.resolutionPatient ?? payload?.resolution_patient
    );

    if (!incidentType) {
      throw new Error("incidentType is required");
    }
    if (!incidentReason) {
      throw new Error("incidentReason is required");
    }
    if (!incidentDescription) {
      throw new Error("incidentDescription is required");
    }
    if (!branchCode && !branchId) {
      throw new Error("branchCode or branchId is required");
    }
    if (!happenedAt) {
      throw new Error("happenedAt is required");
    }

    return requestJson({
      method: "POST",
      url: "/api/admin/incidents",
      data: {
        incidentType,
        incidentReason,
        incidentDescription,
        branchCode: branchCode || undefined,
        branchId: branchId || undefined,
        happenedAt,
        status: status || undefined,
        note: note || undefined,
        smartcardSessionId: smartcardSessionId || undefined,
        dispenseAttemptId: dispenseAttemptId || undefined,
        items,
        resolutionActions,
        resolutionPatient,
      },
    });
  },
  applyIncidentResolution(id, payload = {}) {
    const incidentId = String(id || "").trim();
    if (!incidentId) {
      throw new Error("incident id is required");
    }

    const resolutionActions = buildIncidentResolutionActionsPayload(
      payload?.resolutionActions ?? payload?.resolution_actions
    );
    if (!resolutionActions.length) {
      throw new Error("resolutionActions must contain at least one item");
    }

    const resolutionPatient = buildIncidentResolutionPatientPayload(
      payload?.resolutionPatient ?? payload?.resolution_patient
    );

    return requestJson({
      method: "POST",
      url: `/api/admin/incidents/${encodeURIComponent(incidentId)}/resolution`,
      data: {
        resolutionActions,
        resolutionPatient,
      },
    });
  },
  updateIncidentStatus(id, payload = {}) {
    const incidentId = String(id || "").trim();
    const status = String(payload?.status ?? "").trim().toUpperCase();
    if (!incidentId) {
      throw new Error("incident id is required");
    }
    if (!status) {
      throw new Error("status is required");
    }

    return requestJson({
      method: "PATCH",
      url: `/api/admin/incidents/${encodeURIComponent(incidentId)}/status`,
      data: { status },
    });
  },
  updateIncident(id, payload = {}) {
    const incidentId = String(id || "").trim();
    const reason = String(payload?.reason ?? payload?.reasonText ?? payload?.reason_text ?? "").trim();
    if (!incidentId) {
      throw new Error("incident id is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    const data = { reason };
    if (payload?.incidentType !== undefined || payload?.incident_type !== undefined) {
      data.incidentType = String(payload?.incidentType ?? payload?.incident_type ?? "").trim();
    }
    if (payload?.incidentReason !== undefined || payload?.incident_reason !== undefined) {
      data.incidentReason = String(payload?.incidentReason ?? payload?.incident_reason ?? "").trim();
    }
    if (payload?.incidentDescription !== undefined || payload?.incident_description !== undefined) {
      data.incidentDescription = String(
        payload?.incidentDescription ?? payload?.incident_description ?? ""
      ).trim();
    }
    if (payload?.happenedAt !== undefined || payload?.happened_at !== undefined) {
      data.happenedAt = normalizeBangkokDateTimeInput(payload?.happenedAt ?? payload?.happened_at);
    }
    if (payload?.status !== undefined) {
      data.status = String(payload?.status ?? "").trim().toUpperCase();
    }
    if (
      payload?.note !== undefined ||
      payload?.noteText !== undefined ||
      payload?.note_text !== undefined
    ) {
      data.note = String(payload?.note ?? payload?.noteText ?? payload?.note_text ?? "").trim();
    }

    return requestJson({
      method: "PATCH",
      url: `/api/admin/incidents/${encodeURIComponent(incidentId)}`,
      data,
    });
  },
  deleteIncident(id, payload = {}) {
    const incidentId = String(id || "").trim();
    const reason = String(payload?.reason ?? payload?.reasonText ?? payload?.reason_text ?? "").trim();
    if (!incidentId) {
      throw new Error("incident id is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    return requestJson({
      method: "DELETE",
      url: `/api/admin/incidents/${encodeURIComponent(incidentId)}`,
      data: { reason },
    });
  },
};
