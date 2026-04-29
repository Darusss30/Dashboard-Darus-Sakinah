const CONFIG = {
  apiUrl: String(window.DARUS_DASHBOARD_CONFIG?.apiUrl || "").trim(),
  employeeApiUrl: String(window.DARUS_DASHBOARD_CONFIG?.employeeApiUrl || "").trim(),
  scoreApiUrl: String(window.DARUS_DASHBOARD_CONFIG?.scoreApiUrl || "").trim(),
  attendanceApiUrl: String(window.DARUS_DASHBOARD_CONFIG?.attendanceApiUrl || "").trim(),
  dataPath: String(window.DARUS_DASHBOARD_CONFIG?.dataPath || "./dashboard-data.json").trim() || "./dashboard-data.json",
};

const MONTH_ORDER = {
  januari: 0,
  februari: 1,
  maret: 2,
  april: 3,
  mei: 4,
  juni: 5,
  juli: 6,
  agustus: 7,
  september: 8,
  oktober: 9,
  november: 10,
  desember: 11,
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DEFAULT_ATTENDANCE_START_MINUTES = 7 * 60;
const DEFAULT_ATTENDANCE_END_MINUTES = 17 * 60;
const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
let filtersBound = false;
let currentDashboardModel = null;

function normalizeText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function toNumber(value) {
  if (!hasValue(value)) return null;
  let text = String(value).trim().replace(/\s+/g, "");
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  text = text.replace(/[^0-9.-]/g, "");
  const result = Number(text);
  return Number.isFinite(result) ? result : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateLabel(dateKey) {
  if (!dateKey) return "-";
  const match = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const parsed = Number(value);
  return Number.isInteger(parsed) || digits === 0
    ? String(Math.round(parsed))
    : numberFormat.format(Number(parsed.toFixed(digits)));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${percentFormat.format(value)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uniqueBy(items, keySelector) {
  const map = new Map();
  for (const item of items) {
    const key = keySelector(item);
    if (key) map.set(key, item);
  }
  return [...map.values()];
}

function getPersonKey(row) {
  const phone = normalizeText(row.phone || row["Nomer HP"] || row["Nomor HP"] || row.nomor_hp || "", "");
  const name = normalizeText(row.name || row.Nama || row.nama || "", "");
  const division = normalizeText(row.division || row.Divisi || row.divisi || "", "");
  return phone || [normalizeKey(name), normalizeKey(division)].filter(Boolean).join("|");
}

function isEmployee(row) {
  return normalizeKey(row.access || row.Akses || row.akses || "") === "karyawan";
}

function isDirectoryMember(row) {
  const division = normalizeText(row.division || row.Divisi || row.divisi || "", "");
  const subDivision = normalizeText(row.subDivision || row["Sub Divisi"] || row.sub_divisi || row["Sub Division"] || "", "");
  const title = normalizeText(row.title || row.Jabatan || row.jabatan || "", "");
  return isActiveEmployee(row) && Boolean(division || subDivision || title);
}

function isActiveEmployee(row) {
  const status = normalizeKey(
    row.employmentStatus ||
      row["Status Karyawan"] ||
      row["Status Aktif"] ||
      row.status_karyawan ||
      row.status_aktif ||
      row.status ||
      row.Status ||
      "aktif",
  );
  return !status.includes("nonaktif") &&
    !status.includes("resign") &&
    !status.includes("keluar") &&
    !status.includes("inactive");
}

function capitalizeMonth(monthName) {
  const source = normalizeKey(monthName);
  if (!source) return "-";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function resolvePeriod(row) {
  if (hasValue(row.period)) {
    const raw = String(row.period).trim();
    const match = raw.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      return {
        periodKey: raw,
        periodIndex: (year * 12) + monthIndex,
        label: row.monthLabel || `${MONTH_SHORT[monthIndex]} ${year}`,
        shortLabel: row.monthShort || `${MONTH_SHORT[monthIndex]} '${String(year).slice(-2)}`,
      };
    }
  }

  const monthName = normalizeKey(row.month || row.Bulan || row.bulan || "");
  const monthIndex = MONTH_ORDER[monthName];
  const year = Number(String(row.year || row.Tahun || row.tahun || "").trim());
  if (!Number.isFinite(year) || monthIndex === undefined) return null;

  return {
    periodKey: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    periodIndex: (year * 12) + monthIndex,
    label: `${capitalizeMonth(monthName)} ${year}`,
    shortLabel: `${MONTH_SHORT[monthIndex]} '${String(year).slice(-2)}`,
  };
}

function resolveStatusGroup(score, statusLabel) {
  const status = normalizeKey(statusLabel);
  if (status.includes("critical")) return "critical";
  if (status.includes("warning")) return "warning";
  if (status.includes("top")) return "top";
  if (status.includes("solid")) return "solid";
  if (score === null) return "solid";
  if (score >= 85) return "top";
  if (score >= 70) return "solid";
  if (score >= 50) return "warning";
  return "critical";
}

function average(items, selector) {
  const values = items
    .map(selector)
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + Number(value), 0) / values.length).toFixed(2));
}

function groupBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function labelForGroup(group) {
  return {
    top: "Top Talent",
    solid: "Solid",
    warning: "Warning",
    critical: "Critical",
    unscored: "Belum ada score",
  }[group] || "Solid";
}

function toneLabelForPriority(tone) {
  return {
    top: "Quick Win",
    solid: "Monitoring",
    warning: "Perlu Fokus",
    critical: "Urgent",
  }[tone] || "Monitoring";
}

function excelSerialToDateKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(num * 86400000));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function getDateKey(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") return excelSerialToDateKey(value);

  const rawValue = String(value).trim();
  if (!rawValue) return "";

  const isoMatch = rawValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) return `${isoMatch[1]}-${pad2(isoMatch[2])}-${pad2(isoMatch[3])}`;

  const indoMatch = rawValue.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (indoMatch) return `${indoMatch[3]}-${pad2(indoMatch[2])}-${pad2(indoMatch[1])}`;

  const parsed = new Date(rawValue);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return "";
}

function attendanceStatusGroup(status) {
  const text = normalizeKey(status);
  if (text.includes("critical") || text.includes("alpa") || text.includes("tidak hadir")) return "critical";
  if (text.includes("warning") || text.includes("telat") || text.includes("terlambat") || text.includes("pulang lebih awal") || text.includes("belum scan") || text.includes("lupa scan")) return "warning";
  if (text.includes("izin") || text.includes("sakit") || text.includes("cuti") || text.includes("wfh") || text.includes("proyek")) return "solid";
  return "top";
}

function parseTimeToMinutes(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function formatDisplayTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return text || "-";
  return `${Number(match[1])}:${match[2]}`;
}

function parseAttendanceRawText(rawStatus) {
  const raw = String(rawStatus ?? "").trim();
  return {
    raw,
    normalized: normalizeKey(raw),
    singleScanTime: raw.match(/scan tunggal\s+(\d{1,2}:\d{2})/i)?.[1] || "",
    scanInTime: raw.match(/masuk\s+(\d{1,2}:\d{2})/i)?.[1] || "",
    scanOutTime: raw.match(/pulang\s+(\d{1,2}:\d{2})/i)?.[1] || "",
    lateMinutes: toNumber(raw.match(/telat\s+(\d+)\s*menit/i)?.[1]),
    overtimeMinutes: toNumber(raw.match(/lembur\s+(\d+)\s*menit/i)?.[1]),
    isSingleScan: /scan tunggal/i.test(raw),
    isTwoScan: /2 scan/i.test(raw),
    isAlpha: /alpa/i.test(raw),
  };
}

function resolveAttendanceInsight(rawStatus, scanIn, scanOut, scheduledIn = "", scheduledOut = "") {
  const parsedRaw = parseAttendanceRawText(rawStatus);
  const statusLabel = normalizeText(rawStatus, "Belum ada status");
  const statusText = parsedRaw.normalized;
  const scheduledInMinutes = parseTimeToMinutes(scheduledIn) ?? DEFAULT_ATTENDANCE_START_MINUTES;
  const scheduledOutMinutes = parseTimeToMinutes(scheduledOut) ?? DEFAULT_ATTENDANCE_END_MINUTES;
  const isPermission = ["izin", "sakit", "cuti", "wfh", "proyek", "dinas"].some((keyword) => statusText.includes(keyword));
  const midShiftMinutes = scheduledInMinutes + ((scheduledOutMinutes - scheduledInMinutes) / 2);

  let effectiveScanIn = parseTimeToMinutes(scanIn) !== null ? String(scanIn).trim() : "";
  let effectiveScanOut = parseTimeToMinutes(scanOut) !== null ? String(scanOut).trim() : "";

  if (!effectiveScanIn && parsedRaw.scanInTime) effectiveScanIn = parsedRaw.scanInTime;
  if (!effectiveScanOut && parsedRaw.scanOutTime) effectiveScanOut = parsedRaw.scanOutTime;

  if (parsedRaw.isSingleScan && parsedRaw.singleScanTime) {
    const singleScanMinutes = parseTimeToMinutes(parsedRaw.singleScanTime);
    const forgotScanOut = singleScanMinutes !== null && singleScanMinutes <= midShiftMinutes;
    effectiveScanIn = forgotScanOut ? parsedRaw.singleScanTime : "";
    effectiveScanOut = forgotScanOut ? "" : parsedRaw.singleScanTime;
  }

  const scanInMinutes = parseTimeToMinutes(effectiveScanIn);
  const scanOutMinutes = parseTimeToMinutes(effectiveScanOut);

  if (isPermission) {
    return {
      scanIn: effectiveScanIn || "-",
      scanOut: effectiveScanOut || "-",
      status: statusLabel,
      statusGroup: attendanceStatusGroup(statusLabel),
      isLate: false,
      isEarlyLeave: false,
      isOnTime: false,
      isOvertime: false,
      isPermission: true,
    };
  }

  if (parsedRaw.isAlpha) {
    return {
      scanIn: "-",
      scanOut: "-",
      status: "Alpa",
      statusGroup: "critical",
      isLate: false,
      isEarlyLeave: false,
      isOnTime: false,
      isOvertime: false,
      isPermission: false,
    };
  }

  const shouldDeriveFromScans =
    !statusText ||
    parsedRaw.isSingleScan ||
    parsedRaw.isTwoScan ||
    statusText.includes("fingerprint") ||
    statusText.includes("scan");

  if (!shouldDeriveFromScans) {
    return {
      scanIn: effectiveScanIn || "-",
      scanOut: effectiveScanOut || "-",
      status: statusLabel,
      statusGroup: attendanceStatusGroup(statusLabel),
      isLate: statusText.includes("telat") || statusText.includes("terlambat"),
      isEarlyLeave: statusText.includes("pulang lebih awal"),
      isOnTime: statusText.includes("tepat waktu"),
      isOvertime: statusText.includes("lembur"),
      isPermission: false,
    };
  }

  const isLate = scanInMinutes !== null && scanInMinutes > scheduledInMinutes;
  const isEarlyLeave = scanOutMinutes !== null && scanOutMinutes < scheduledOutMinutes;
  const isOvertime = scanOutMinutes !== null && scanOutMinutes > scheduledOutMinutes;
  const hasExplicitLate = parsedRaw.lateMinutes !== null;
  const hasExplicitOvertime = parsedRaw.overtimeMinutes !== null;
  const lateMinutes = hasExplicitLate
    ? parsedRaw.lateMinutes
    : hasExplicitOvertime
      ? 0
      : (isLate && scanInMinutes !== null ? scanInMinutes - scheduledInMinutes : 0);
  const overtimeMinutes = hasExplicitOvertime
    ? parsedRaw.overtimeMinutes
    : hasExplicitLate
      ? 0
      : (isOvertime && scanOutMinutes !== null ? scanOutMinutes - scheduledOutMinutes : 0);

  if (scanInMinutes !== null && scanOutMinutes !== null) {
    let derivedStatus = "Tepat waktu";
    if (lateMinutes > 0 && overtimeMinutes > 0) {
      derivedStatus = `Terlambat ${formatNumber(lateMinutes, 0)} menit • Lembur ${formatNumber(overtimeMinutes, 0)} menit`;
    } else if (lateMinutes > 0) {
      derivedStatus = `Terlambat ${formatNumber(lateMinutes, 0)} menit`;
    } else if (overtimeMinutes > 0) {
      derivedStatus = `Lembur ${formatNumber(overtimeMinutes, 0)} menit`;
    } else if (isEarlyLeave) {
      derivedStatus = "Pulang lebih awal";
    }

    return {
      scanIn: effectiveScanIn || "-",
      scanOut: effectiveScanOut || "-",
      status: derivedStatus,
      statusGroup: attendanceStatusGroup(derivedStatus),
      isLate: lateMinutes > 0,
      isEarlyLeave,
      isOnTime: !isLate && !isEarlyLeave,
      isOvertime: overtimeMinutes > 0,
      isPermission: false,
    };
  }

  if (scanInMinutes !== null || scanOutMinutes !== null) {
    const singleScanMinutes = scanInMinutes ?? scanOutMinutes;
    const forgotScanOut = singleScanMinutes !== null && singleScanMinutes <= midShiftMinutes;
    const singleLateMinutes = parsedRaw.lateMinutes ?? (forgotScanOut && singleScanMinutes !== null && singleScanMinutes > scheduledInMinutes
      ? singleScanMinutes - scheduledInMinutes
      : 0);
    const derivedStatus = forgotScanOut
      ? (singleLateMinutes > 0 ? `Terlambat ${formatNumber(singleLateMinutes, 0)} menit • Lupa scan pulang` : "Lupa scan pulang")
      : "Lupa scan masuk";

    return {
      scanIn: effectiveScanIn || "-",
      scanOut: effectiveScanOut || "-",
      status: derivedStatus,
      statusGroup: attendanceStatusGroup(derivedStatus),
      isLate: forgotScanOut ? singleLateMinutes > 0 : false,
      isEarlyLeave: false,
      isOnTime: false,
      isOvertime: false,
      isPermission: false,
    };
  }

  return {
    scanIn: effectiveScanIn || "-",
    scanOut: effectiveScanOut || "-",
    status: statusLabel,
    statusGroup: attendanceStatusGroup(statusLabel),
    isLate: false,
    isEarlyLeave: false,
    isOnTime: false,
    isOvertime: false,
    isPermission: false,
  };
}

function normalizeEmployeeRows(rows) {
  return uniqueBy(
    rows
      .filter((row) => isEmployee(row) && isActiveEmployee(row))
      .map((row) => ({
        key: getPersonKey(row),
        userId: normalizeText(row.userId || row["User ID"] || row.user_id || "", ""),
        name: normalizeText(row.name || row.Nama || row.nama),
        phone: normalizeText(row.phone || row["Nomer HP"] || row["Nomor HP"] || row.nomor_hp || "", ""),
        division: normalizeText(row.division || row.Divisi || row.divisi),
        subDivision: normalizeText(row.subDivision || row["Sub Divisi"] || row.sub_divisi || row["Sub Division"] || "", ""),
        title: normalizeText(row.title || row.Jabatan || row.jabatan),
        scheduleIn: normalizeText(row.scheduleIn || row["Jam Masuk"] || row.jam_masuk || row.jamMasuk || "", ""),
        scheduleOut: normalizeText(row.scheduleOut || row["Jam Pulang"] || row.jam_pulang || row.jamPulang || "", ""),
      }))
      .filter((row) => row.key),
    (row) => row.key,
  );
}

function normalizeDirectoryRows(rows) {
  return uniqueBy(
    rows
      .filter((row) => isDirectoryMember(row))
      .map((row) => ({
        key: getPersonKey(row),
        access: normalizeText(row.access || row.Akses || row.akses || "", ""),
        userId: normalizeText(row.userId || row["User ID"] || row.user_id || "", ""),
        name: normalizeText(row.name || row.Nama || row.nama),
        phone: normalizeText(row.phone || row["Nomer HP"] || row["Nomor HP"] || row.nomor_hp || "", ""),
        division: normalizeText(row.division || row.Divisi || row.divisi),
        subDivision: normalizeText(row.subDivision || row["Sub Divisi"] || row.sub_divisi || row["Sub Division"] || "", ""),
        title: normalizeText(row.title || row.Jabatan || row.jabatan),
        scheduleIn: normalizeText(row.scheduleIn || row["Jam Masuk"] || row.jam_masuk || row.jamMasuk || "", ""),
        scheduleOut: normalizeText(row.scheduleOut || row["Jam Pulang"] || row.jam_pulang || row.jamPulang || "", ""),
      }))
      .filter((row) => row.key),
    (row) => row.key,
  );
}

function normalizeScoreRows(rows, employeeMap) {
  const normalized = rows
    .map((row) => {
      const period = resolvePeriod(row);
      const finalScore = toNumber(row.finalScore || row["Final Score"]);
      if (!period || finalScore === null) return null;

      const personKey = getPersonKey(row);
      const employee = employeeMap.get(personKey) || null;
      const statusLabel = normalizeText(row.status || row.Status || "", "");

      return {
        key: `${period.periodKey}|${personKey}`,
        personKey,
        name: normalizeText(row.name || row.Nama || employee?.name || row.nama),
        phone: normalizeText(row.phone || row["Nomer HP"] || row["Nomor HP"] || employee?.phone || "", ""),
        division: normalizeText(row.division || row.Divisi || employee?.division || row.divisi),
        subDivision: normalizeText(row.subDivision || row["Sub Divisi"] || employee?.subDivision || row.sub_divisi || "", ""),
        title: normalizeText(row.title || row.Jabatan || employee?.title || row.jabatan),
        finalScore,
        kpi: toNumber(row.kpi || row.KPI),
        okr: toNumber(row.okr || row.OKR),
        behavior: toNumber(row.behavior || row.Behavior),
        statusLabel,
        group: resolveStatusGroup(finalScore, statusLabel),
        periodKey: period.periodKey,
        periodIndex: period.periodIndex,
        periodLabel: period.label,
        periodShortLabel: period.shortLabel,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.periodIndex - right.periodIndex || left.finalScore - right.finalScore);

  return uniqueBy(normalized, (row) => row.key);
}

function normalizeAttendanceRows(rows, employeeLookup) {
  return rows
    .map((row) => {
      const dateKey = getDateKey(row.date || row.Date || row.Tanggal || row.tanggal || row["Tanggal Input"]);
      if (!dateKey) return null;

      const phone = normalizeText(row.phone || row["Nomer HP"] || row["Nomor HP"] || row.nomor_hp || "", "");
      const userId = normalizeText(row.userId || row["User ID"] || row.user_id || "", "");
      const employee =
        employeeLookup.byKey.get(getPersonKey(row)) ||
        (phone ? employeeLookup.byPhone.get(phone) : null) ||
        (userId ? employeeLookup.byUserId.get(userId) : null) ||
        null;
      const resolvedUserId = normalizeText(userId || employee?.userId || "", "");
      if (!resolvedUserId) return null;

      const rawStatus = row.status || row.Status || row.Keterangan || row.keterangan || "";
      const rawScanIn = normalizeText(row["Scan Masuk"] || row.scan_masuk || "", "-");
      const rawScanOut = normalizeText(row["Scan Pulang"] || row.scan_pulang || "", "-");
      const statusInsight = resolveAttendanceInsight(
        rawStatus,
        rawScanIn,
        rawScanOut,
        employee?.scheduleIn || "",
        employee?.scheduleOut || "",
      );

      return {
        dateKey,
        dateLabel: formatDateLabel(dateKey),
        userId: resolvedUserId,
        name: normalizeText(row.name || row.Nama || row.nama || employee?.name),
        division: normalizeText(row.division || row.Divisi || row.divisi || employee?.division),
        subDivision: normalizeText(row.subDivision || row["Sub Divisi"] || row.sub_divisi || employee?.subDivision || "", ""),
        title: normalizeText(row.title || row.Jabatan || row.jabatan || employee?.title),
        scanIn: formatDisplayTime(statusInsight.scanIn),
        scanOut: formatDisplayTime(statusInsight.scanOut),
        scheduleIn: employee?.scheduleIn || "",
        scheduleOut: employee?.scheduleOut || "",
        status: statusInsight.status,
        statusGroup: statusInsight.statusGroup,
        isLate: statusInsight.isLate,
        isEarlyLeave: statusInsight.isEarlyLeave,
        isOnTime: statusInsight.isOnTime,
        isOvertime: statusInsight.isOvertime,
        isPermission: statusInsight.isPermission,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey) || left.name.localeCompare(right.name, "id-ID"));
}

function buildFallbackData() {
  return {
    company: {
      name: "Darus Sakinah",
      workbook: "HR Darus Sakinah",
      subtitle: "Pantau performa, absensi, dan tindak lanjut karyawan secara ringkas",
    },
    generatedAt: new Date().toISOString(),
    employeeMaster: [
      { Nama: "Aulia Rahman", Divisi: "Operasional", "Sub Divisi": "Distribusi", Jabatan: "Supervisor Gudang", "Nomer HP": "6281111111111", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "07:00", "Jam Pulang": "16:00" },
      { Nama: "Bima Saputra", Divisi: "Operasional", "Sub Divisi": "Distribusi", Jabatan: "Koordinator Shift", "Nomer HP": "6281222222222", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "07:00", "Jam Pulang": "16:00" },
      { Nama: "Citra Mahesa", Divisi: "Marketing", "Sub Divisi": "Digital", Jabatan: "Lead Campaign", "Nomer HP": "6281333333333", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "08:00", "Jam Pulang": "17:00" },
      { Nama: "Dinda Larasati", Divisi: "Marketing", "Sub Divisi": "Partnership", Jabatan: "Partnership Officer", "Nomer HP": "6281444444444", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "08:00", "Jam Pulang": "17:00" },
      { Nama: "Eko Pranata", Divisi: "Keuangan", "Sub Divisi": "Reporting", Jabatan: "Finance Analyst", "Nomer HP": "6281555555555", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "08:00", "Jam Pulang": "17:00" },
      { Nama: "Farah Nabila", Divisi: "Keuangan", "Sub Divisi": "Collection", Jabatan: "Collection Officer", "Nomer HP": "6281666666666", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "08:00", "Jam Pulang": "17:00" },
      { Nama: "Guntur Wijaya", Divisi: "SDM", "Sub Divisi": "Recruitment", Jabatan: "Talent Officer", "Nomer HP": "6281777777777", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "08:00", "Jam Pulang": "17:00" },
      { Nama: "Hana Putri", Divisi: "SDM", "Sub Divisi": "People Ops", Jabatan: "People Support", "Nomer HP": "6281888888888", Akses: "Karyawan", "Status Karyawan": "Aktif", "Jam Masuk": "08:00", "Jam Pulang": "17:00" },
    ],
    scoreRows: [
      { Nama: "Aulia Rahman", Divisi: "Operasional", "Sub Divisi": "Distribusi", Jabatan: "Supervisor Gudang", "Nomer HP": "6281111111111", KPI: 90, OKR: 85, Behavior: 86, "Final Score": 87, Status: "Top Talent", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Bima Saputra", Divisi: "Operasional", "Sub Divisi": "Distribusi", Jabatan: "Koordinator Shift", "Nomer HP": "6281222222222", KPI: 75, OKR: 73, Behavior: 74, "Final Score": 74, Status: "Solid", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Citra Mahesa", Divisi: "Marketing", "Sub Divisi": "Digital", Jabatan: "Lead Campaign", "Nomer HP": "6281333333333", KPI: 87, OKR: 85, Behavior: 84, "Final Score": 85, Status: "Top Talent", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Dinda Larasati", Divisi: "Marketing", "Sub Divisi": "Partnership", Jabatan: "Partnership Officer", "Nomer HP": "6281444444444", KPI: 73, OKR: 71, Behavior: 72, "Final Score": 72, Status: "Solid", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Eko Pranata", Divisi: "Keuangan", "Sub Divisi": "Reporting", Jabatan: "Finance Analyst", "Nomer HP": "6281555555555", KPI: 82, OKR: 79, Behavior: 79, "Final Score": 80, Status: "Solid", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Farah Nabila", Divisi: "Keuangan", "Sub Divisi": "Collection", Jabatan: "Collection Officer", "Nomer HP": "6281666666666", KPI: 64, OKR: 63, Behavior: 62, "Final Score": 63, Status: "Warning", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Guntur Wijaya", Divisi: "SDM", "Sub Divisi": "Recruitment", Jabatan: "Talent Officer", "Nomer HP": "6281777777777", KPI: 71, OKR: 70, Behavior: 69, "Final Score": 70, Status: "Solid", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Hana Putri", Divisi: "SDM", "Sub Divisi": "People Ops", Jabatan: "People Support", "Nomer HP": "6281888888888", KPI: 56, OKR: 54, Behavior: 55, "Final Score": 55, Status: "Warning", Bulan: "Maret", Tahun: 2026 },
      { Nama: "Aulia Rahman", Divisi: "Operasional", "Sub Divisi": "Distribusi", Jabatan: "Supervisor Gudang", "Nomer HP": "6281111111111", KPI: 92, OKR: 89, Behavior: 92, "Final Score": 91, Status: "Top Talent", Bulan: "April", Tahun: 2026 },
      { Nama: "Bima Saputra", Divisi: "Operasional", "Sub Divisi": "Distribusi", Jabatan: "Koordinator Shift", "Nomer HP": "6281222222222", KPI: 76, OKR: 82, Behavior: 77, "Final Score": 78, Status: "Solid", Bulan: "April", Tahun: 2026 },
      { Nama: "Citra Mahesa", Divisi: "Marketing", "Sub Divisi": "Digital", Jabatan: "Lead Campaign", "Nomer HP": "6281333333333", KPI: 90, OKR: 87, Behavior: 86, "Final Score": 88, Status: "Top Talent", Bulan: "April", Tahun: 2026 },
      { Nama: "Dinda Larasati", Divisi: "Marketing", "Sub Divisi": "Partnership", Jabatan: "Partnership Officer", "Nomer HP": "6281444444444", KPI: 71, OKR: 66, Behavior: 70, "Final Score": 69, Status: "Warning", Bulan: "April", Tahun: 2026 },
      { Nama: "Eko Pranata", Divisi: "Keuangan", "Sub Divisi": "Reporting", Jabatan: "Finance Analyst", "Nomer HP": "6281555555555", KPI: 86, OKR: 82, Behavior: 84, "Final Score": 84, Status: "Solid", Bulan: "April", Tahun: 2026 },
      { Nama: "Farah Nabila", Divisi: "Keuangan", "Sub Divisi": "Collection", Jabatan: "Collection Officer", "Nomer HP": "6281666666666", KPI: 60, OKR: 54, Behavior: 61, "Final Score": 58, Status: "Warning", Bulan: "April", Tahun: 2026 },
      { Nama: "Guntur Wijaya", Divisi: "SDM", "Sub Divisi": "Recruitment", Jabatan: "Talent Officer", "Nomer HP": "6281777777777", KPI: 70, OKR: 76, Behavior: 75, "Final Score": 74, Status: "Solid", Bulan: "April", Tahun: 2026 },
      { Nama: "Hana Putri", Divisi: "SDM", "Sub Divisi": "People Ops", Jabatan: "People Support", "Nomer HP": "6281888888888", KPI: 49, OKR: 45, Behavior: 48, "Final Score": 47, Status: "Critical", Bulan: "April", Tahun: 2026 },
    ],
    attendanceRows: [
      { Tanggal: "28/04/2026 06:53", Nama: "Aulia Rahman", Divisi: "Operasional", Jabatan: "Supervisor Gudang", "Scan Masuk": "06:53", "Scan Pulang": "17:06", Status: "Fingerprint | 2 scan" },
      { Tanggal: "28/04/2026 07:19", Nama: "Bima Saputra", Divisi: "Operasional", Jabatan: "Koordinator Shift", "Scan Masuk": "07:19", "Scan Pulang": "17:11", Status: "Fingerprint | 2 scan" },
      { Tanggal: "28/04/2026 06:58", Nama: "Citra Mahesa", Divisi: "Marketing", Jabatan: "Lead Campaign", "Scan Masuk": "06:58", "Scan Pulang": "17:24", Status: "Fingerprint | 2 scan" },
      { Tanggal: "28/04/2026 07:05", Nama: "Dinda Larasati", Divisi: "Marketing", Jabatan: "Partnership Officer", "Scan Masuk": "07:05", "Scan Pulang": "16:31", Status: "Fingerprint | 2 scan" },
      { Tanggal: "28/04/2026 00:00", Nama: "Eko Pranata", Divisi: "Keuangan", Jabatan: "Finance Analyst", "Scan Masuk": "-", "Scan Pulang": "-", Status: "WFH" },
      { Tanggal: "27/04/2026 06:50", Nama: "Farah Nabila", Divisi: "Keuangan", Jabatan: "Collection Officer", "Scan Masuk": "06:50", "Scan Pulang": "17:09", Status: "Fingerprint | 2 scan" },
      { Tanggal: "27/04/2026 07:26", Nama: "Guntur Wijaya", Divisi: "SDM", Jabatan: "Talent Officer", "Scan Masuk": "07:26", "Scan Pulang": "17:15", Status: "Fingerprint | 2 scan" },
      { Tanggal: "27/04/2026 16:42", Nama: "Hana Putri", Divisi: "SDM", Jabatan: "People Support", "Scan Masuk": "16:42", "Scan Pulang": "-", Status: "Fingerprint | 1 scan" }
    ]
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Gagal mengambil data (${response.status})`);
  return response.json();
}

function showToast(message) {
  const toast = document.getElementById("statusToast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

async function resolveRawData() {
  if (window.__DARUS_DASHBOARD_DATA__) {
    return { payload: window.__DARUS_DASHBOARD_DATA__, source: "Injected via window.__DARUS_DASHBOARD_DATA__" };
  }

  if (CONFIG.apiUrl) {
    try {
      const payload = await fetchJson(CONFIG.apiUrl);
      return { payload, source: `Webhook n8n: ${CONFIG.apiUrl}` };
    } catch (error) {
      showToast(`Webhook gagal diakses. Pakai fallback lokal. (${error.message})`);
    }
  }

  if (CONFIG.employeeApiUrl && CONFIG.scoreApiUrl) {
    try {
      const attendancePromise = CONFIG.attendanceApiUrl
        ? fetchJson(CONFIG.attendanceApiUrl).catch((error) => {
            showToast(`Webhook absensi belum aktif atau gagal diakses. (${error.message})`);
            return [];
          })
        : Promise.resolve([]);

      const [employeeMaster, scoreRows, attendanceRows] = await Promise.all([
        fetchJson(CONFIG.employeeApiUrl),
        fetchJson(CONFIG.scoreApiUrl),
        attendancePromise,
      ]);
      return {
        payload: {
          company: {
            name: "Darus Sakinah",
            workbook: "HR Darus Sakinah",
            subtitle: "Pantau performa, absensi, dan tindak lanjut karyawan secara ringkas",
          },
          generatedAt: new Date().toISOString(),
          employeeMaster,
          scoreRows,
          attendanceRows,
        },
        source: "Spreadsheet live via webhook n8n",
      };
    } catch (error) {
      showToast(`Endpoint n8n live gagal diakses. Pakai fallback lokal. (${error.message})`);
    }
  }

  if (CONFIG.dataPath) {
    try {
      const payload = await fetchJson(CONFIG.dataPath);
      return { payload, source: `File lokal: ${CONFIG.dataPath}` };
    } catch (error) {
      showToast(`File data lokal tidak ditemukan. Pakai fallback demo. (${error.message})`);
    }
  }

  return { payload: buildFallbackData(), source: "Built-in demo data" };
}

function extractRawSections(payload) {
  if (Array.isArray(payload)) {
    return { company: {}, generatedAt: "", employeeRows: [], scoreRows: payload };
  }
  const root = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  return {
    company: root.company || {},
    generatedAt: root.generatedAt || payload.generatedAt || "",
    employeeRows: root.employeeMaster || root.employees || root.dataKaryawan || root.karyawan || [],
    scoreRows: root.scoreRows || root.finalScoreBulanan || root.finalScoreRows || root.rows || [],
    attendanceRows: root.attendanceRows || root.absensiRows || root.attendance || root.absensi || [],
  };
}

function normalizeDashboardData(payload, sourceLabel) {
  const sections = extractRawSections(payload);
  const employeeRows = normalizeEmployeeRows(sections.employeeRows);
  const directoryRows = normalizeDirectoryRows(sections.employeeRows);
  const directoryLookup = {
    byKey: new Map(directoryRows.map((row) => [row.key, row])),
    byPhone: new Map(directoryRows.filter((row) => row.phone).map((row) => [row.phone, row])),
    byUserId: new Map(directoryRows.filter((row) => row.userId).map((row) => [row.userId, row])),
  };
  const scoreRows = normalizeScoreRows(sections.scoreRows, directoryLookup.byKey);
  const attendanceRows = normalizeAttendanceRows(sections.attendanceRows || [], directoryLookup);
  const periodMap = groupBy(scoreRows, (row) => row.periodKey);
  const periods = [...periodMap.entries()]
    .map(([periodKey, rows]) => ({
      key: periodKey,
      index: rows[0]?.periodIndex ?? 0,
      label: rows[0]?.periodLabel ?? periodKey,
      shortLabel: rows[0]?.periodShortLabel ?? periodKey,
      rows: [...rows].sort((left, right) => right.finalScore - left.finalScore),
    }))
    .sort((left, right) => left.index - right.index);

  const currentPeriod = periods.at(-1) || null;
  const previousPeriod = periods.at(-2) || null;
  const currentRows = currentPeriod ? currentPeriod.rows : [];
  const previousRows = previousPeriod ? previousPeriod.rows : [];
  const activeEmployeeCount = employeeRows.length || currentRows.length;

  const currentAvg = average(currentRows, (row) => row.finalScore);
  const previousAvg = average(previousRows, (row) => row.finalScore);
  const avgDelta = currentAvg !== null && previousAvg !== null ? Number((currentAvg - previousAvg).toFixed(2)) : null;
  const statusCounts = { top: 0, solid: 0, warning: 0, critical: 0 };
  currentRows.forEach((row) => {
    statusCounts[row.group] += 1;
  });

  const activeCountByDivision = employeeRows.reduce((result, row) => {
    result[row.division] = (result[row.division] || 0) + 1;
    return result;
  }, {});

  const divisions = [...groupBy(currentRows, (row) => row.division).entries()]
    .map(([division, rows]) => ({
      division,
      avgScore: average(rows, (row) => row.finalScore),
      scoredCount: rows.length,
      activeCount: activeCountByDivision[division] || rows.length,
      coverage: activeCountByDivision[division] ? (rows.length / activeCountByDivision[division]) * 100 : 100,
      topPerformer: rows[0] || null,
      kpiAvg: average(rows, (row) => row.kpi),
      okrAvg: average(rows, (row) => row.okr),
      behaviorAvg: average(rows, (row) => row.behavior),
    }))
    .sort((left, right) => (right.avgScore ?? -1) - (left.avgScore ?? -1));

  const bestDivision = divisions[0] || null;
  const lowestDivision = [...divisions].sort((left, right) => (left.avgScore ?? 999) - (right.avgScore ?? 999))[0] || null;
  const topTalent = currentRows.slice(0, 5);
  const attentionRows = currentRows.filter((row) => row.group === "warning" || row.group === "critical").sort((left, right) => left.finalScore - right.finalScore);
  const attentionList = attentionRows.length ? attentionRows.slice(0, 5) : [...currentRows].sort((left, right) => left.finalScore - right.finalScore).slice(0, 5);
  const trend = periods.slice(-6).map((period) => ({
    label: period.label,
    shortLabel: period.shortLabel,
    avgScore: average(period.rows, (row) => row.finalScore) || 0,
    scoredCount: period.rows.length,
  }));
  const attendanceDateOptions = [...new Set(attendanceRows.map((row) => row.dateKey))].sort((left, right) => right.localeCompare(left));

  const coverage = activeEmployeeCount ? (currentRows.length / activeEmployeeCount) * 100 : null;
  const alertCount = statusCounts.warning + statusCounts.critical;
  const currentScoreMap = new Map(currentRows.map((row) => [row.personKey, row]));
  const explorerRows = directoryRows
    .map((employee) => {
      const scoredRow = currentScoreMap.get(employee.key) || null;
      return {
        personKey: employee.key,
        userId: employee.userId,
        access: employee.access,
        name: employee.name,
        phone: employee.phone,
        division: employee.division,
        subDivision: employee.subDivision,
        title: employee.title,
        finalScore: scoredRow?.finalScore ?? null,
        kpi: scoredRow?.kpi ?? null,
        okr: scoredRow?.okr ?? null,
        behavior: scoredRow?.behavior ?? null,
        statusLabel: scoredRow?.statusLabel ?? "",
        group: scoredRow?.group ?? "unscored",
        hasScore: Boolean(scoredRow),
      };
    })
    .sort((left, right) => {
      if (left.hasScore !== right.hasScore) return left.hasScore ? -1 : 1;
      if (left.hasScore && right.hasScore) {
        return (right.finalScore ?? -1) - (left.finalScore ?? -1) || left.name.localeCompare(right.name, "id-ID");
      }
      return left.name.localeCompare(right.name, "id-ID");
    });
  const priorityNotes = [
    bestDivision ? {
      tone: "top",
      eyebrow: "Sorotan Positif",
      title: "Divisi terkuat",
      stat: bestDivision.division,
      text: `Rata-rata ${formatNumber(bestDivision.avgScore)} dengan coverage ${formatPercent(bestDivision.coverage)}. Top performer saat ini ${bestDivision.topPerformer?.name || "-"}.`,
    } : null,
    lowestDivision ? {
      tone: "warning",
      eyebrow: "Intervensi",
      title: "Divisi prioritas",
      stat: lowestDivision.division,
      text: `Rata-rata ${formatNumber(lowestDivision.avgScore)}. Prioritaskan coaching, review target, dan monitoring mingguan pada area ini.`,
    } : null,
    {
      tone: coverage !== null && coverage >= 80 ? "solid" : "warning",
      eyebrow: "Monitoring",
      title: "Coverage scoring",
      stat: `${formatNumber(currentRows.length, 0)}/${formatNumber(activeEmployeeCount, 0)}`,
      text: `${currentRows.length} dari ${activeEmployeeCount} karyawan aktif sudah memiliki final score pada periode ${currentPeriod?.label || "-"}.`,
    },
  ].filter(Boolean);

  return {
    companyName: normalizeText(sections.company.name || "Darus Sakinah"),
    workbookName: normalizeText(sections.company.workbook || "HR Darus Sakinah"),
    subtitle: normalizeText(sections.company.subtitle || "Pantau performa, absensi, dan tindak lanjut karyawan secara ringkas"),
    generatedAt: sections.generatedAt || new Date().toISOString(),
    sourceLabel,
    currentPeriod,
    previousPeriod,
    currentRows,
    currentAvg,
    previousAvg,
    avgDelta,
    activeEmployeeCount,
    scoredCount: currentRows.length,
    coverage,
    alertCount,
    explorerRows,
    statusCounts,
    divisions,
    bestDivision,
    lowestDivision,
    topTalent,
    attentionList,
    trend,
    attendanceRows,
    attendanceDateOptions,
    latestAttendanceDate: attendanceDateOptions[0] || "",
    priorityNotes,
    divisionOptions: ["all", ...new Set(directoryRows.map((row) => row.division).filter(Boolean))],
  };
}

function renderStats(model) {
  const cards = [
    { label: "Karyawan Aktif", value: formatNumber(model.activeEmployeeCount, 0), deltaText: "Master data aktif", deltaType: "flat" },
    { label: "Sudah Terscore", value: formatNumber(model.scoredCount, 0), deltaText: `${formatPercent(model.coverage)} coverage`, deltaType: "up" },
    { label: "Rata-rata Final Score", value: formatNumber(model.currentAvg), deltaText: model.avgDelta === null ? "Belum ada pembanding" : `${model.avgDelta >= 0 ? "+" : ""}${formatNumber(model.avgDelta)} vs ${model.previousPeriod?.label || "periode lalu"}`, deltaType: model.avgDelta === null ? "flat" : model.avgDelta >= 0 ? "up" : "down" },
    { label: "Perlu Perhatian", value: formatNumber(model.alertCount, 0), deltaText: `${formatNumber(model.statusCounts.critical, 0)} critical, ${formatNumber(model.statusCounts.warning, 0)} warning`, deltaType: model.alertCount > 0 ? "down" : "up" },
  ];

  document.getElementById("statsGrid").innerHTML = cards.map((card) => `
    <article class="stat-card">
      <p class="stat-card__label">${escapeHtml(card.label)}</p>
      <h2 class="stat-card__value">${escapeHtml(card.value)}</h2>
      <span class="stat-card__delta stat-card__delta--${card.deltaType}">${escapeHtml(card.deltaText)}</span>
    </article>
  `).join("");
}

function resolveTrendScale(values) {
  const numericValues = values.map((value) => Number(value)).filter(Number.isFinite);
  if (!numericValues.length) {
    return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  }

  const rawMin = Math.min(...numericValues);
  const rawMax = Math.max(...numericValues);
  const spread = rawMax - rawMin;
  const buffer = spread < 4 ? 8 : spread < 10 ? 6 : 5;

  let min = clamp(rawMin - buffer, 0, 100);
  const max = 100;
  if (max - min < 20) {
    min = Math.max(0, max - 20);
  }

  const visibleRange = max - min;
  const step = visibleRange <= 30 ? 5 : visibleRange <= 60 ? 10 : 20;
  min = Math.floor(min / step) * step;

  const ticks = [];
  for (let value = min; value <= max + 0.001; value += step) {
    ticks.push(Number(value.toFixed(1)));
  }

  return { min, max, ticks };
}

function renderTrend(model) {
  const trendChart = document.getElementById("trendChart");
  trendChart.className = `trend${model.trend.length === 1 ? " trend--single" : ""}`;
  trendChart.style.setProperty("--trend-columns", String(Math.max(model.trend.length, 1)));
  if (!model.trend.length) {
    trendChart.innerHTML = `<div class="empty-state">Belum ada data trend bulanan.</div>`;
    return;
  }

  const chartWidth = 1120;
  const chartHeight = 420;
  const padding = { top: 54, right: 58, bottom: 30, left: 58 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const baselineY = padding.top + plotHeight;
  const scale = resolveTrendScale(model.trend.map((item) => item.avgScore));
  const scoreRange = Math.max(scale.max - scale.min, 1);
  const stepX = model.trend.length === 1 ? 0 : plotWidth / (model.trend.length - 1);

  const points = model.trend.map((item, index) => {
    const x = model.trend.length === 1
      ? padding.left + (plotWidth / 2)
      : padding.left + (stepX * index);
    const y = padding.top + ((scale.max - clamp(item.avgScore, scale.min, scale.max)) / scoreRange) * plotHeight;
    const scoreLabel = formatNumber(item.avgScore);
    const pillWidth = Math.max(54, 24 + (scoreLabel.length * 8));
    return { ...item, x, y, scoreLabel, pillWidth };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = [
    `M ${points[0].x} ${baselineY}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${points[points.length - 1].x} ${baselineY}`,
    "Z",
  ].join(" ");
  const gridValues = [...scale.ticks];
  const latestPoint = points[points.length - 1];
  const previousPoint = points[points.length - 2] || null;
  const latestDelta = previousPoint ? latestPoint.avgScore - previousPoint.avgScore : null;
  const summaryItems = [
    { label: "Periode", value: latestPoint.label, meta: latestPoint.shortLabel },
    { label: "Final score", value: latestPoint.scoreLabel, meta: `${formatNumber(latestPoint.scoredCount, 0)} karyawan terscore` },
    {
      label: "Perubahan",
      value: latestDelta === null ? "Baseline" : `${latestDelta >= 0 ? "+" : ""}${formatNumber(latestDelta)}`,
      meta: previousPoint ? `vs ${previousPoint.shortLabel}` : "Belum ada pembanding",
    },
  ];

  trendChart.innerHTML = `
    <div class="trend__summary">
      ${summaryItems.map((item) => `
        <article class="trend__summary-card">
          <span class="trend__summary-label">${escapeHtml(item.label)}</span>
          <strong class="trend__summary-value">${escapeHtml(item.value)}</strong>
          <small class="trend__summary-meta">${escapeHtml(item.meta)}</small>
        </article>
      `).join("")}
    </div>
    <div class="trend__frame">
      <svg class="trend__svg" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" role="img" aria-label="Grafik trend rata-rata final score dengan skala fokus ${formatNumber(scale.min, 0)} sampai ${formatNumber(scale.max, 0)}">
        <defs>
          <linearGradient id="trend-area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#5a5bd6" stop-opacity="0.24"></stop>
            <stop offset="100%" stop-color="#5a5bd6" stop-opacity="0.02"></stop>
          </linearGradient>
        </defs>
        ${gridValues.map((value) => {
          const y = padding.top + ((scale.max - value) / scoreRange) * plotHeight;
          return `
            <line class="trend__grid-line" x1="${padding.left}" y1="${y}" x2="${chartWidth - padding.right}" y2="${y}"></line>
            <text class="trend__grid-label" x="${padding.left - 12}" y="${y + 4}" text-anchor="end">${escapeHtml(formatNumber(value, 0))}</text>
          `;
        }).join("")}
        <line class="trend__axis-line" x1="${padding.left}" y1="${baselineY}" x2="${chartWidth - padding.right}" y2="${baselineY}"></line>
        <path class="trend__area" d="${areaPath}"></path>
        <path class="trend__line" d="${linePath}"></path>
        ${points.map((point, index) => {
          const previousPoint = points[index - 1] || null;
          const deltaLabel = previousPoint
            ? `${point.avgScore >= previousPoint.avgScore ? "Naik" : "Turun"} ${formatNumber(Math.abs(point.avgScore - previousPoint.avgScore))} poin dibanding ${previousPoint.shortLabel}`
            : "Periode awal dalam grafik";
          return `
          <g class="trend__point-group${points.length <= 2 ? " trend__point-group--pinned" : ""}" data-index="${index}" transform="translate(${point.x} ${point.y})" tabindex="0" role="button" aria-label="${escapeHtml(`${point.label}. Final score ${formatNumber(point.avgScore)}. ${formatNumber(point.scoredCount, 0)} karyawan terscore. ${deltaLabel}.`)}">
            <line class="trend__guide" x1="0" y1="${padding.top - point.y}" x2="0" y2="${baselineY - point.y}"></line>
            <rect class="trend__score-pill" x="${-(point.pillWidth / 2)}" y="-40" width="${point.pillWidth}" height="30" rx="15"></rect>
            <text class="trend__score-text" x="0" y="-20">${escapeHtml(point.scoreLabel)}</text>
            <ellipse class="trend__point" cx="0" cy="0" rx="8" ry="8"></ellipse>
            <ellipse class="trend__target" cx="0" cy="0" rx="24" ry="24"></ellipse>
          </g>
        `;
        }).join("")}
      </svg>
      <div class="trend__tooltip" id="trendTooltip" aria-live="polite"></div>
    </div>
    <div class="trend__labels">
      ${points.map((point, index) => `
        <button class="trend__label trend__label-button" type="button" data-index="${index}" aria-label="${escapeHtml(`Tampilkan detail ${point.label}`)}">
          <strong>${escapeHtml(point.shortLabel)}</strong>
          <span>${escapeHtml(formatNumber(point.scoredCount, 0))} orang</span>
        </button>
      `).join("")}
    </div>
  `;

  bindTrendInteractivity(trendChart, points, chartWidth, chartHeight);
}

function bindTrendInteractivity(trendChart, points, chartWidth, chartHeight) {
  const frame = trendChart.querySelector(".trend__frame");
  const svg = trendChart.querySelector(".trend__svg");
  const tooltip = trendChart.querySelector(".trend__tooltip");
  const pointGroups = [...trendChart.querySelectorAll(".trend__point-group")];
  const labels = [...trendChart.querySelectorAll(".trend__label-button")];
  if (!frame || !svg || !tooltip || !pointGroups.length) return;

  let selectedIndex = Math.max(points.length - 1, 0);
  let activeIndex = null;

  const applyState = () => {
    pointGroups.forEach((group, groupIndex) => {
      group.classList.toggle("is-active", groupIndex === activeIndex);
      group.classList.toggle("is-selected", groupIndex === selectedIndex);
    });
    labels.forEach((label, labelIndex) => {
      label.classList.toggle("is-active", labelIndex === activeIndex);
      label.classList.toggle("is-selected", labelIndex === selectedIndex);
    });
  };

  const getDeltaText = (index) => {
    if (index === 0) return "Periode awal pada grafik";
    const previous = points[index - 1];
    const delta = points[index].avgScore - previous.avgScore;
    if (Math.abs(delta) < 0.05) return `Stabil vs ${previous.shortLabel}`;
    return `${delta >= 0 ? "+" : ""}${formatNumber(delta)} vs ${previous.shortLabel}`;
  };

  const renderTooltip = (index) => {
    const point = points[index];
    tooltip.innerHTML = `
      <strong>${escapeHtml(point.label)}</strong>
      <span>Final score ${escapeHtml(formatNumber(point.avgScore))}</span>
      <span>${escapeHtml(formatNumber(point.scoredCount, 0))} karyawan terscore</span>
      <span>${escapeHtml(getDeltaText(index))}</span>
    `;
  };

  const applyPointGeometry = () => {
    const svgRect = svg.getBoundingClientRect();
    const scaleX = svgRect.width / chartWidth || 1;
    const scaleY = svgRect.height / chartHeight || 1;
    const ratio = scaleX > 0 ? scaleY / scaleX : 1;

    pointGroups.forEach((group) => {
      const point = group.querySelector(".trend__point");
      const target = group.querySelector(".trend__target");
      if (point) {
        point.setAttribute("rx", String(8 * ratio));
        point.setAttribute("ry", "8");
      }
      if (target) {
        target.setAttribute("rx", String(24 * ratio));
        target.setAttribute("ry", "24");
      }
    });
  };

  const positionTooltip = (index) => {
    const point = points[index];
    const frameRect = frame.getBoundingClientRect();
    const x = (point.x / chartWidth) * frameRect.width;
    const y = (point.y / chartHeight) * frameRect.height;
    const tooltipRect = tooltip.getBoundingClientRect();
    const normalizedX = x / Math.max(frameRect.width, 1);
    const normalizedY = y / Math.max(frameRect.height, 1);
    const preferredLeft = normalizedX < 0.28
      ? x + 18
      : normalizedX > 0.72
        ? x - tooltipRect.width - 18
        : x - (tooltipRect.width / 2);
    const preferredTop = normalizedY < 0.24
      ? y + 18
      : y - tooltipRect.height - 18;
    const left = clamp(preferredLeft, 12, frameRect.width - tooltipRect.width - 12);
    const top = clamp(preferredTop, 12, frameRect.height - tooltipRect.height - 12);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.dataset.side = preferredTop > y ? "bottom" : "top";
  };

  const hideTooltip = () => {
    tooltip.classList.remove("is-visible");
  };

  const activate = (index, showTooltip = true) => {
    activeIndex = index;
    applyState();
    if (!showTooltip) {
      hideTooltip();
      return;
    }
    renderTooltip(index);
    tooltip.classList.add("is-visible");
    requestAnimationFrame(() => positionTooltip(index));
  };

  const commit = (index, showTooltip = true) => {
    selectedIndex = index;
    if (showTooltip) {
      activate(index, true);
      return;
    }
    activeIndex = null;
    applyState();
    hideTooltip();
  };

  const restore = () => {
    activeIndex = null;
    applyState();
    hideTooltip();
  };

  const focusSiblingAt = (source, index) => {
    if (source.classList.contains("trend__label-button")) {
      labels[index]?.focus();
      return;
    }
    pointGroups[index]?.focus();
  };

  const handleKeydown = (event, index) => {
    let nextIndex = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex = Math.max(0, index - 1);
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex = Math.min(points.length - 1, index + 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = points.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    commit(nextIndex);
    focusSiblingAt(event.currentTarget, nextIndex);
  };

  pointGroups.forEach((group, index) => {
    group.addEventListener("mouseenter", () => activate(index, true));
    group.addEventListener("focus", () => activate(index, true));
    group.addEventListener("click", () => commit(index, true));
    group.addEventListener("keydown", (event) => handleKeydown(event, index));
  });

  labels.forEach((label, index) => {
    label.addEventListener("mouseenter", () => activate(index, true));
    label.addEventListener("focus", () => activate(index, true));
    label.addEventListener("click", () => commit(index, true));
    label.addEventListener("keydown", (event) => handleKeydown(event, index));
  });

  trendChart.onmouseleave = restore;
  trendChart.onfocusout = () => {
    window.setTimeout(() => {
      if (!trendChart.contains(document.activeElement)) restore();
    }, 0);
  };

  if (trendChart._trendResizeHandler) {
    window.removeEventListener("resize", trendChart._trendResizeHandler);
  }

  const resizeHandler = () => {
    applyPointGeometry();
    if (tooltip.classList.contains("is-visible") && activeIndex !== null) {
      positionTooltip(activeIndex);
    }
  };
  trendChart._trendResizeHandler = resizeHandler;
  window.addEventListener("resize", resizeHandler);

  applyPointGeometry();
  commit(selectedIndex, false);
}

function renderStatusBreakdown(model) {
  const entries = [
    { key: "top", label: "Top Talent" },
    { key: "solid", label: "Solid" },
    { key: "warning", label: "Warning" },
    { key: "critical", label: "Critical" },
  ];
  const total = model.currentRows.length || 1;
  document.getElementById("statusBreakdown").innerHTML = `<div class="status-stack">${entries.map((entry) => `
    <div class="status-row status-row--${entry.key}">
      <span class="status-row__label">${escapeHtml(entry.label)}</span>
      <div class="status-row__track">
        <div class="status-row__bar bar--${entry.key}" style="width:${(model.statusCounts[entry.key] / total) * 100}%"></div>
      </div>
      <span class="status-row__value">
        <strong>${escapeHtml(formatNumber(model.statusCounts[entry.key], 0))}</strong>
        <small>${escapeHtml(formatPercent((model.statusCounts[entry.key] / total) * 100))}</small>
      </span>
    </div>
  `).join("")}</div>`;

  document.getElementById("signalCards").innerHTML = [
    {
      label: "Periode aktif",
      value: model.currentPeriod?.label || "-",
      meta: `${formatNumber(model.scoredCount, 0)} karyawan terscore`,
      tone: "solid",
    },
    {
      label: "Divisi terbaik",
      value: model.bestDivision?.division || "-",
      meta: model.bestDivision
        ? `Avg ${formatNumber(model.bestDivision.avgScore)} • Coverage ${formatPercent(model.bestDivision.coverage)}`
        : "Belum ada data",
      tone: "top",
    },
    {
      label: "Area prioritas",
      value: model.lowestDivision?.division || "-",
      meta: model.lowestDivision
        ? `Avg ${formatNumber(model.lowestDivision.avgScore)} • Butuh coaching`
        : "Belum ada data",
      tone: "warning",
    },
  ].map((card) => `
    <div class="signal-card signal-card--${card.tone}">
      <span class="signal-card__label">${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.meta)}</small>
    </div>
  `).join("");
}

function renderDivisionBoard(model) {
  document.getElementById("divisionBoard").innerHTML = model.divisions.length
    ? model.divisions.map((division, index) => `
      <article class="division-card">
        <div class="division-card__top">
          <div class="division-card__heading">
            <span class="division-card__rank">#${index + 1}</span>
            <h3>${escapeHtml(division.division)}</h3>
          </div>
          <span class="division-card__score">${escapeHtml(formatNumber(division.avgScore))}</span>
        </div>
        <div class="division-card__progress" aria-hidden="true">
          <span class="division-card__progress-fill" style="width:${clamp(division.coverage, 0, 100)}%"></span>
        </div>
        <div class="division-card__stats">
          <span>Coverage ${escapeHtml(formatPercent(division.coverage))}</span>
          <span>${escapeHtml(formatNumber(division.scoredCount, 0))}/${escapeHtml(formatNumber(division.activeCount, 0))} terscore</span>
        </div>
        <p class="division-card__meta">
          Top performer: <strong>${escapeHtml(division.topPerformer?.name || "-")}</strong>
        </p>
        <div class="division-card__chips">
          <span class="chip chip--kpi">KPI ${escapeHtml(formatNumber(division.kpiAvg))}</span>
          <span class="chip chip--okr">OKR ${escapeHtml(formatNumber(division.okrAvg))}</span>
          <span class="chip chip--behavior">Behavior ${escapeHtml(formatNumber(division.behaviorAvg))}</span>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">Belum ada data divisi.</div>`;
}

function renderPriority(model) {
  document.getElementById("priorityList").innerHTML = model.priorityNotes.map((item) => `
    <article class="priority-item priority-item--${item.tone || "solid"}">
      <div class="priority-item__top">
        <div>
          <span class="priority-item__eyebrow">${escapeHtml(item.eyebrow || "Monitoring")}</span>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        <span class="chip chip--${item.tone || "solid"}">${escapeHtml(toneLabelForPriority(item.tone))}</span>
      </div>
      <strong class="priority-item__stat">${escapeHtml(item.stat || "-")}</strong>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join("");
}

function renderExplorerSummary(rows, searchValue, divisionValue, statusValue) {
  const summaryItems = [
    { text: `${formatNumber(rows.length, 0)} tampil`, tone: "solid" },
    { text: `${formatNumber(rows.filter((row) => row.hasScore).length, 0)} terscore`, tone: "top" },
  ];

  if (divisionValue && divisionValue !== "all") {
    summaryItems.push({ text: `Divisi: ${divisionValue}`, tone: "solid" });
  }
  if (statusValue && statusValue !== "all") {
    summaryItems.push({ text: `Status: ${labelForGroup(statusValue)}`, tone: statusValue });
  }
  if (searchValue) {
    summaryItems.push({ text: `Cari: "${searchValue}"`, tone: "warning" });
  }

  document.getElementById("explorerSummary").innerHTML = summaryItems.map((item) => `
    <span class="summary-pill summary-pill--${item.tone}">${escapeHtml(item.text)}</span>
  `).join("");
}

function getAttendanceRowsByDate(model = currentDashboardModel) {
  if (!model) return [];
  const selectedDate = document.getElementById("attendanceDateFilter").value || model.latestAttendanceDate;
  return model.attendanceRows.filter((row) => row.dateKey === selectedDate);
}

function populateAttendanceDateFilter(model) {
  const select = document.getElementById("attendanceDateFilter");
  if (!model.attendanceDateOptions.length) {
    select.disabled = true;
    select.innerHTML = `<option value="">Belum ada data</option>`;
    return;
  }

  select.disabled = false;
  const currentValue = select.value;
  select.innerHTML = model.attendanceDateOptions
    .map((dateKey) => `<option value="${escapeHtml(dateKey)}">${escapeHtml(formatDateLabel(dateKey))}</option>`)
    .join("");

  select.value = model.attendanceDateOptions.includes(currentValue) ? currentValue : model.latestAttendanceDate;
}

function renderAttendanceSection(model = currentDashboardModel) {
  if (!model) return;

  const rows = getAttendanceRowsByDate(model);
  const counts = rows.reduce((result, row) => {
    result.total += 1;
    if (row.isOnTime) result.onTime += 1;
    if (row.isLate) result.late += 1;
    if (row.isEarlyLeave) result.earlyLeave += 1;
    if (row.isPermission) result.permission += 1;
    return result;
  }, { total: 0, onTime: 0, late: 0, earlyLeave: 0, permission: 0 });

  document.getElementById("attendanceSummary").innerHTML = [
    { label: "Total Data", value: counts.total },
    { label: "Tepat Waktu", value: counts.onTime },
    { label: "Terlambat", value: counts.late },
    { label: "Pulang Awal", value: counts.earlyLeave },
    { label: "Izin / WFH / Sakit", value: counts.permission },
  ].map((item) => `
    <article class="attendance-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(formatNumber(item.value, 0))}</strong>
    </article>
  `).join("");

  document.getElementById("attendanceTableBody").innerHTML = rows.length
    ? rows.map((row, index) => `
      <tr>
        <td data-label="No">${index + 1}</td>
        <td data-label="Nama">
          <div class="data-table__name">
            <strong>${escapeHtml(row.name)}</strong>
            <span class="data-table__sub">${escapeHtml(row.subDivision || row.division)}</span>
          </div>
        </td>
        <td data-label="Divisi">${escapeHtml(row.division)}</td>
        <td data-label="Sub Divisi">${escapeHtml(row.subDivision || "-")}</td>
        <td data-label="Jabatan">${escapeHtml(row.title)}</td>
        <td data-label="Scan Masuk">${escapeHtml(row.scanIn)}</td>
        <td data-label="Scan Pulang">${escapeHtml(row.scanOut)}</td>
        <td data-label="Status"><span class="chip chip--${row.statusGroup}">${escapeHtml(row.status)}</span></td>
      </tr>
    `).join("")
    : `<tr><td colspan="8"><div class="empty-state">Belum ada data absensi pada tanggal yang dipilih.</div></td></tr>`;
}

function renderPeopleList(containerId, rows) {
  document.getElementById(containerId).innerHTML = rows.length
    ? rows.map((row) => `
      <article class="person-card">
        <div class="person-card__top">
          <div>
            <h3>${escapeHtml(row.name)}</h3>
            <p class="person-card__meta">${escapeHtml(row.division)} • ${escapeHtml(row.title)}</p>
          </div>
          <span class="person-card__score">${escapeHtml(formatNumber(row.finalScore))}</span>
        </div>
        <div class="person-card__chips">
          <span class="chip chip--${row.group}">${escapeHtml(labelForGroup(row.group))}</span>
          <span class="chip chip--kpi">KPI ${escapeHtml(formatNumber(row.kpi))}</span>
          <span class="chip chip--okr">OKR ${escapeHtml(formatNumber(row.okr))}</span>
          <span class="chip chip--behavior">Behavior ${escapeHtml(formatNumber(row.behavior))}</span>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">Belum ada data untuk panel ini.</div>`;
}

function populateDivisionFilter(model) {
  document.getElementById("divisionFilter").innerHTML = model.divisionOptions
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value === "all" ? "Semua Divisi" : value)}</option>`)
    .join("");
}

function renderEmployeeTable(model = currentDashboardModel) {
  if (!model) return;
  const searchInputValue = document.getElementById("searchInput").value.trim();
  const searchValue = normalizeKey(searchInputValue);
  const divisionValue = document.getElementById("divisionFilter").value;
  const statusValue = document.getElementById("statusFilter").value;

  const rows = model.explorerRows.filter((row) => {
    const matchesDivision = divisionValue === "all" || row.division === divisionValue;
    const matchesStatus = statusValue === "all" || row.group === statusValue;
    const haystack = normalizeKey([row.name, row.division, row.title, row.subDivision].join(" "));
    const matchesSearch = !searchValue || haystack.includes(searchValue);
    return matchesDivision && matchesStatus && matchesSearch;
  });

  document.getElementById("employeeTableBody").innerHTML = rows.length
    ? rows.map((row, index) => `
      <tr>
        <td data-label="Rank">${index + 1}</td>
        <td data-label="Nama">
          <div class="data-table__name">
            <strong>${escapeHtml(row.name)}</strong>
            <span class="data-table__sub">${escapeHtml(row.subDivision || row.division)}</span>
          </div>
        </td>
        <td data-label="Divisi">${escapeHtml(row.division)}</td>
        <td data-label="Sub Divisi">${escapeHtml(row.subDivision || "-")}</td>
        <td data-label="Jabatan">${escapeHtml(row.title)}</td>
        <td data-label="Final Score"><span class="score-pill">${escapeHtml(formatNumber(row.finalScore))}</span></td>
        <td data-label="KPI"><span class="metric-pill metric-pill--kpi">${escapeHtml(formatNumber(row.kpi))}</span></td>
        <td data-label="OKR"><span class="metric-pill metric-pill--okr">${escapeHtml(formatNumber(row.okr))}</span></td>
        <td data-label="Behavior"><span class="metric-pill metric-pill--behavior">${escapeHtml(formatNumber(row.behavior))}</span></td>
        <td data-label="Status"><span class="chip chip--${row.group}">${escapeHtml(labelForGroup(row.group))}</span></td>
      </tr>
    `).join("")
    : `<tr><td colspan="10"><div class="empty-state">Tidak ada data yang cocok dengan filter saat ini.</div></td></tr>`;

  renderExplorerSummary(rows, searchInputValue, divisionValue, statusValue);
  const resetButton = document.getElementById("resetFiltersButton");
  if (resetButton) {
    resetButton.disabled = !searchInputValue && divisionValue === "all" && statusValue === "all";
  }
  document.getElementById("employeeCounter").textContent = `${rows.length} karyawan tampil`;
}

function renderHero(model) {
  document.getElementById("heroTitle").innerHTML = `Kinerja Karyawan<br>${escapeHtml(model.companyName)}`;
  document.getElementById("heroDescription").textContent = `${model.subtitle}.`;
  document.getElementById("periodPill").textContent = `Periode aktif: ${model.currentPeriod?.label || "-"}`;
}

function bindFilters(model) {
  if (filtersBound) return;
  ["searchInput", "divisionFilter", "statusFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => renderEmployeeTable());
    document.getElementById(id).addEventListener("change", () => renderEmployeeTable());
  });
  document.getElementById("attendanceDateFilter").addEventListener("change", () => renderAttendanceSection());
  document.getElementById("refreshButton").addEventListener("click", () => window.location.reload());
  document.getElementById("resetFiltersButton").addEventListener("click", () => {
    document.getElementById("searchInput").value = "";
    document.getElementById("divisionFilter").value = "all";
    document.getElementById("statusFilter").value = "all";
    renderEmployeeTable();
  });
  filtersBound = true;
}

function renderDashboard(model) {
  currentDashboardModel = model;
  renderHero(model);
  renderStats(model);
  populateAttendanceDateFilter(model);
  renderAttendanceSection(model);
  renderTrend(model);
  renderStatusBreakdown(model);
  renderDivisionBoard(model);
  renderPriority(model);
  renderPeopleList("topTalentList", model.topTalent);
  renderPeopleList("attentionList", model.attentionList);
  populateDivisionFilter(model);
  renderEmployeeTable(model);
  bindFilters(model);
}

async function boot() {
  try {
    const { payload, source } = await resolveRawData();
    const model = normalizeDashboardData(payload, source);
    renderDashboard(model);
    window.DarusDashboard = {
      render: (nextPayload, nextSource = "Injected runtime data") => {
        renderDashboard(normalizeDashboardData(nextPayload, nextSource));
      },
    };
  } catch (error) {
    showToast(`Dashboard gagal dimuat: ${error.message}`);
    document.getElementById("statsGrid").innerHTML = `<div class="empty-state">Terjadi kesalahan saat memuat dashboard.</div>`;
  }
}

boot();
