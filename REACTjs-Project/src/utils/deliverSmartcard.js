import mqtt from "mqtt";

export const SMARTCARD_DEFAULTS = {
  brokerUrl: "ws://localhost:10884/mqtt",
  topic: "moph/ict/mqtt",
  connectTimeout: 5000,
  keepalive: 30,
  reconnectPeriod: 3000,
};

export const SMARTCARD_STATES = {
  WAITING: "WAITING",
  CARD_ENTERED: "CARD_ENTERED",
  READING: "READING",
  DATA_RETRIEVED: "DATA_RETRIEVED",
  CARD_REMOVED: "CARD_REMOVED",
  ERROR: "ERROR",
  UNKNOWN_EVENT: "UNKNOWN_EVENT",
};

const GENDER_MAP = {
  "1": "ชาย",
  "2": "หญิง",
  male: "ชาย",
  female: "หญิง",
  m: "ชาย",
  f: "หญิง",
  ชาย: "ชาย",
  หญิง: "หญิง",
};

export function startSmartcardListener({
  brokerUrl = SMARTCARD_DEFAULTS.brokerUrl,
  topic = SMARTCARD_DEFAULTS.topic,
  onStatusChange = () => {},
  onCardData = () => {},
} = {}) {
  const resolvedBrokerUrl = toCleanText(brokerUrl) || SMARTCARD_DEFAULTS.brokerUrl;
  const resolvedTopic = toCleanText(topic) || SMARTCARD_DEFAULTS.topic;
  const clientId = `rx1011-smartcard-${Math.random().toString(16).slice(2, 10)}`;
  let client = null;
  let wasManuallyClosed = false;

  try {
    console.info("[deliver-smartcard] connecting", {
      brokerUrl: resolvedBrokerUrl,
      topic: resolvedTopic,
      clientId,
    });

    onStatusChange({
      tone: "info",
      message: `กำลังเชื่อมต่อ smartcard bridge ที่ ${resolvedBrokerUrl}`,
    });

    client = mqtt.connect(resolvedBrokerUrl, {
      clientId,
      clean: true,
      connectTimeout: SMARTCARD_DEFAULTS.connectTimeout,
      keepalive: SMARTCARD_DEFAULTS.keepalive,
      reconnectPeriod: SMARTCARD_DEFAULTS.reconnectPeriod,
      resubscribe: true,
    });
  } catch (error) {
    const message = `เริ่ม smartcard listener ไม่สำเร็จ: ${
      error?.message || "Unknown error"
    }`;
    console.error("[deliver-smartcard] startup error", error);
    onStatusChange({
      tone: "error",
      message,
    });
    return () => {};
  }

  client.on("reconnect", () => {
    if (wasManuallyClosed) return;
    console.info("[deliver-smartcard] reconnecting", {
      brokerUrl: resolvedBrokerUrl,
      topic: resolvedTopic,
    });
    onStatusChange({
      tone: "warn",
      message: `กำลังลองเชื่อมต่อ smartcard bridge ใหม่ที่ ${resolvedBrokerUrl}`,
    });
  });

  client.on("connect", () => {
    console.info("[deliver-smartcard] connected", {
      brokerUrl: resolvedBrokerUrl,
      topic: resolvedTopic,
    });

    onStatusChange({
      tone: "info",
      message: `เชื่อมต่อ smartcard bridge แล้ว กำลัง subscribe ${resolvedTopic}`,
    });

    client.subscribe(resolvedTopic, (error) => {
      if (error) {
        console.error("[deliver-smartcard] subscribe failed", error);
        onStatusChange({
          tone: "error",
          message: `เชื่อมต่อได้แต่ subscribe ${resolvedTopic} ไม่สำเร็จ: ${
            error?.message || "Unknown error"
          }`,
        });
        return;
      }

      onStatusChange({
        tone: "info",
        message:
          "Smartcard listener พร้อมใช้งาน กำลังรอเสียบบัตรประชาชน",
      });
    });
  });

  client.on("message", (receivedTopic, payload) => {
    const rawText = payload ? payload.toString() : "";
    const normalized = normalizeSmartcardPayload(rawText, { topic: receivedTopic });

    if (normalized.parseError) {
      console.warn("[deliver-smartcard] payload parse warning", {
        topic: receivedTopic,
        error: normalized.parseError,
        rawText,
      });
    } else {
      console.debug("[deliver-smartcard] payload received", {
        topic: receivedTopic,
        state: normalized.state,
        fields: normalized.fields,
      });
    }

    switch (normalized.state) {
      case SMARTCARD_STATES.CARD_ENTERED:
        onStatusChange({
          tone: "info",
          message: "ตรวจพบบัตรแล้ว กำลังรอข้อมูลผู้ถือบัตร",
        });
        return;
      case SMARTCARD_STATES.READING:
        onStatusChange({
          tone: "info",
          message: "Smartcard reader กำลังอ่านข้อมูลบัตร",
        });
        return;
      case SMARTCARD_STATES.CARD_REMOVED:
        onStatusChange({
          tone: "warn",
          message: "ตรวจพบการถอดบัตร ระบบคงข้อความในช่องหมายเหตุไว้",
        });
        return;
      case SMARTCARD_STATES.ERROR:
        onStatusChange({
          tone: "error",
          message: normalized.parseError
            ? `ได้รับ payload ที่ parse ไม่สำเร็จ: ${normalized.parseError}`
            : "ได้รับ event ลักษณะผิดพลาดจาก smartcard bridge",
        });
        return;
      default:
        break;
    }

    if (
      normalized.state === SMARTCARD_STATES.DATA_RETRIEVED &&
      hasMeaningfulCardData(normalized.fields)
    ) {
      onCardData(normalized);
      return;
    }

    if (normalized.state === SMARTCARD_STATES.UNKNOWN_EVENT) {
      onStatusChange({
        tone: "warn",
        message: "ได้รับ payload จาก smartcard bridge แต่ยังไม่ตรงรูปแบบที่รองรับ",
      });
    }
  });

  client.on("offline", () => {
    if (wasManuallyClosed) return;
    console.warn("[deliver-smartcard] offline", { brokerUrl: resolvedBrokerUrl });
    onStatusChange({
      tone: "warn",
      message: `smartcard bridge ที่ ${resolvedBrokerUrl} offline หรือเข้าถึงไม่ได้`,
    });
  });

  client.on("close", () => {
    console.info("[deliver-smartcard] connection closed", {
      brokerUrl: resolvedBrokerUrl,
      manual: wasManuallyClosed,
    });
    onStatusChange({
      tone: wasManuallyClosed ? "info" : "warn",
      message: wasManuallyClosed
        ? "ปิด smartcard listener แล้ว"
        : "smartcard bridge ปิดการเชื่อมต่อ ระบบจะลองเชื่อมต่อใหม่อัตโนมัติ",
    });
  });

  client.on("error", (error) => {
    console.error("[deliver-smartcard] mqtt error", error);
    onStatusChange({
      tone: "error",
      message: `เชื่อมต่อ smartcard bridge ไม่สำเร็จ: ${
        error?.message || "Unknown error"
      }`,
    });
  });

  return () => {
    wasManuallyClosed = true;
    if (!client) return;
    client.end(true);
    client = null;
  };
}

export function buildDeliverNotesFromCard(fields = {}) {
  const primaryName = toCleanText(fields.thaiName || fields.fullName || fields.englishName);
  const englishName = toCleanText(fields.englishName);
  const birthDate = normalizeSmartcardDate(fields.birthDate);
  const gender = normalizeGender(fields.gender);
  const address = toCleanText(fields.address);
  const lines = [
    buildNoteLine("ชื่อผู้รับมอบยา", primaryName),
    buildNoteLine("เลขประจำตัวประชาชน", fields.cid),
    englishName && englishName !== primaryName
      ? buildNoteLine("ชื่อภาษาอังกฤษ", englishName)
      : "",
    buildNoteLine("วันเกิด", birthDate),
    buildNoteLine("เพศ", gender),
    buildNoteLine("ที่อยู่", address),
  ].filter(Boolean);

  return lines.join("\n");
}

export function hasMeaningfulCardData(fields = {}) {
  return Boolean(
    toCleanText(fields.cid) ||
      toCleanText(fields.fullName) ||
      toCleanText(fields.thaiName) ||
      toCleanText(fields.englishName) ||
      toCleanText(fields.birthDate) ||
      toCleanText(fields.address)
  );
}

export function normalizeSmartcardPayload(input, metadata = {}) {
  const rawText = typeof input === "string" ? input : safeStringify(input);
  const parseAttempt = tryParseJson(rawText);
  const parsed =
    typeof input === "object" && input !== null ? input : parseAttempt.value;
  const entries = collectEntries(parsed);
  const fields = extractCardFields(entries);
  const eventLabel =
    cleanFieldValue(
      findScalarValue(entries, ["event", "type", "status", "action", "state"])
    ) || "";
  const detailLabel = cleanFieldValue(
    findScalarValue(entries, ["message", "detail", "description", "error"])
  );
  const fallbackText = [eventLabel, detailLabel, rawText].filter(Boolean).join(" | ");

  return {
    topic: toCleanText(metadata.topic),
    rawText,
    parsed,
    parseError: parseAttempt.error,
    state: inferNormalizedState(fallbackText, fields),
    eventLabel: eventLabel || detailLabel || SMARTCARD_STATES.UNKNOWN_EVENT,
    fields,
  };
}

function tryParseJson(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!looksLikeJson(trimmed)) {
    return { value: null, error: "" };
  }

  try {
    return { value: JSON.parse(trimmed), error: "" };
  } catch (error) {
    return { value: null, error: `JSON parse failed: ${error.message}` };
  }
}

function collectEntries(value, depth = 0, entries = []) {
  if (!value || depth > 4 || entries.length > 160) {
    return entries;
  }

  if (Array.isArray(value)) {
    value.slice(0, 16).forEach((item) => collectEntries(item, depth + 1, entries));
    return entries;
  }

  if (!isPlainObject(value)) {
    return entries;
  }

  Object.entries(value).forEach(([key, entryValue]) => {
    entries.push({ key, normalizedKey: normalizeKey(key), value: entryValue });
    if (isPlainObject(entryValue) || Array.isArray(entryValue)) {
      collectEntries(entryValue, depth + 1, entries);
    }
  });

  return entries;
}

function extractCardFields(entries) {
  const cid = cleanFieldValue(
    findScalarValue(entries, [
      "cid",
      "pid",
      "citizen_id",
      "citizenid",
      "card_id",
      "cardid",
    ])
  );
  const thaiName = cleanFieldValue(
    findScalarValue(entries, [
      "th_fullname",
      "thai_fullname",
      "thai_name",
      "name_th",
      "fullname_th",
    ])
  );
  const englishName = cleanFieldValue(
    findScalarValue(entries, [
      "en_fullname",
      "english_fullname",
      "english_name",
      "name_en",
      "fullname_en",
    ])
  );
  const explicitFullName = cleanFieldValue(
    findScalarValue(entries, ["fullname", "full_name", "name"])
  );
  const derivedNames = deriveNames(
    cleanFieldValue(
      findScalarValue(entries, [
        "first_name",
        "firstname",
        "given_name",
        "givenname",
      ])
    ),
    cleanFieldValue(
      findScalarValue(entries, [
        "last_name",
        "lastname",
        "surname",
        "family_name",
        "familyname",
      ])
    ),
    explicitFullName || englishName || thaiName
  );

  return {
    cid,
    firstName: derivedNames.firstName,
    lastName: derivedNames.lastName,
    fullName: explicitFullName || thaiName || englishName || derivedNames.fullName,
    thaiName,
    englishName,
    birthDate: cleanFieldValue(
      findScalarValue(entries, [
        "dob",
        "birth_date",
        "birthdate",
        "date_of_birth",
        "dateofbirth",
      ])
    ),
    gender: cleanFieldValue(findScalarValue(entries, ["gender", "sex"])),
    issueDate: cleanFieldValue(
      findScalarValue(entries, [
        "issue_date",
        "issuedate",
        "date_of_issue",
        "dateofissue",
      ])
    ),
    expireDate: cleanFieldValue(
      findScalarValue(entries, [
        "expire_date",
        "expiry_date",
        "expiredate",
        "expirydate",
        "date_of_expiry",
      ])
    ),
    issuer: cleanFieldValue(findScalarValue(entries, ["issuer", "card_issuer", "cardissuer"])),
    address: cleanFieldValue(findScalarValue(entries, ["address", "full_address", "addr"])),
  };
}

function findScalarValue(entries, aliases) {
  const normalizedAliases = aliases.map(normalizeKey);

  for (const alias of normalizedAliases) {
    const match = entries.find(
      (entry) => entry.normalizedKey === alias && isScalar(entry.value)
    );
    if (match && cleanFieldValue(match.value)) {
      return match.value;
    }
  }

  return "";
}

function inferNormalizedState(text, fields) {
  const haystack = String(text || "").toLowerCase();
  const hasFields = hasMeaningfulCardData(fields);

  if (/(error|exception|failed|failure|disconnect error)/.test(haystack)) {
    return SMARTCARD_STATES.ERROR;
  }
  if (/(card_removed|card_exited|card_exit|card removed|card exit|removed|disconnect)/.test(haystack)) {
    return SMARTCARD_STATES.CARD_REMOVED;
  }
  if (/(data_retrieved|image_retrieved|data retrieved|read complete|card data)/.test(haystack) || hasFields) {
    return SMARTCARD_STATES.DATA_RETRIEVED;
  }
  if (/(reading|read card|select applet|retrieving|processing)/.test(haystack)) {
    return SMARTCARD_STATES.READING;
  }
  if (/(card_entered|card entered|card insert|inserted)/.test(haystack)) {
    return SMARTCARD_STATES.CARD_ENTERED;
  }
  if (/(waiting|wait for card|wait card|jsmartcard_starting|ready)/.test(haystack)) {
    return SMARTCARD_STATES.WAITING;
  }
  return SMARTCARD_STATES.UNKNOWN_EVENT;
}

function deriveNames(firstName, lastName, fullName) {
  if (firstName || lastName) {
    return {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" ").trim(),
    };
  }

  const cleanedFullName = cleanFieldValue(fullName);
  if (!cleanedFullName) {
    return { firstName: "", lastName: "", fullName: "" };
  }

  const tokens = cleanedFullName.split(" ").filter(Boolean);
  if (!tokens.length) {
    return { firstName: "", lastName: "", fullName: cleanedFullName };
  }

  return {
    firstName: tokens[0] || "",
    lastName: tokens.slice(1).join(" ") || "",
    fullName: cleanedFullName,
  };
}

function normalizeSmartcardDate(value) {
  const cleaned = toCleanText(value);
  if (!cleaned) return "";

  if (/^\d{8}$/.test(cleaned)) {
    let year = Number(cleaned.slice(0, 4));
    const month = cleaned.slice(4, 6);
    const day = cleaned.slice(6, 8);
    if (year > 2400) {
      year -= 543;
    }
    return `${String(year).padStart(4, "0")}-${month}-${day}`;
  }

  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return cleaned;
}

function normalizeGender(value) {
  const cleaned = toCleanText(value);
  if (!cleaned) return "";
  return GENDER_MAP[cleaned.toLowerCase()] || cleaned;
}

function buildNoteLine(label, value) {
  const cleanedValue = toCleanText(value);
  if (!cleanedValue) return "";
  return `${label}: ${cleanedValue}`;
}

function looksLikeJson(value) {
  return /^[\[{]/.test(String(value || "").trim());
}

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
}

function isScalar(value) {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value)
  );
}

function normalizeKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function cleanFieldValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => Number.isFinite(entry))) {
      return value.map((entry) => String.fromCharCode(entry)).join("").trim();
    }
    return value.map(cleanFieldValue).join(" ").replace(/\s+/g, " ").trim();
  }
  if (typeof value === "object") {
    return safeStringify(value);
  }
  return String(value).replace(/#+/g, " ").replace(/\s+/g, " ").trim();
}

function safeStringify(value, spacing = 2) {
  try {
    return JSON.stringify(value, null, spacing);
  } catch (_error) {
    return String(value);
  }
}

function toCleanText(value) {
  return String(value || "").trim();
}
