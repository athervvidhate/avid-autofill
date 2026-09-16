// Shared, deterministic tracker values. No profile data or network access here.
(function () {
  const A = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  const KEY = "avidTracker";
  const HEADERS = ["Company", "Role", "Job URL", "Location", "Date applied", "Status", "Follow-up date", "Notes", "Application ID", "Job key"];
  const STATUSES = ["Saved", "In progress", "Applied", "Interview", "Offer", "Rejected", "Withdrawn"];
  const ORIGINS = ["http://*/*", "https://*/*"];
  const SCRIPTS = ["src/shared/tracker-model.js", "src/content/job-detector.js", "src/content/tracker.js"];
  const clean = (value, max = 500) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function daysFromToday(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function jobUrl(value) {
    try {
      const u = new URL(value);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return "";
      // Keep requisition identifiers, never applicant/session or marketing parameters.
      const normalize = target => {
        for (const key of [...target.searchParams.keys()]) {
          if (!/^(?:gh_jid|job_?id|job|jid|id|req_?id|requisition_?id|opportunity_?id|posting_?id|vacancy_?id|position_?id)$/i.test(key)) target.searchParams.delete(key);
        }
        target.searchParams.sort();
        target.pathname = target.pathname.replace(/\/(?:apply|application|candidate|confirmation|thank-you)(?:\/.*)?\/?$/i, "").replace(/\/$/, "") || "/";
      };
      normalize(u);
      if (/^#\/(?:jobs?|careers?|positions?)\//i.test(u.hash)) {
        const route = new URL(u.hash.slice(1), u.origin);
        normalize(route);
        u.hash = route.pathname + route.search;
      } else u.hash = "";
      return u.href;
    } catch { return ""; }
  }
  function jobKey(value) {
    const url = jobUrl(value);
    if (!url) return "";
    const u = new URL(url);
    const gh = u.searchParams.get("gh_jid") || (/(?:^|\.)greenhouse\.io$/.test(u.hostname) && u.pathname.match(/\/(\d+)$/)?.[1]);
    if (gh) return `greenhouse:${gh}`;
    const icims = /\.icims\.com$/.test(u.hostname) && u.pathname.match(/\/jobs\/(\d+)/)?.[1];
    if (icims) return `${u.hostname}:${icims}`;
    return url;
  }
  function date(value) {
    if (!value) return "";
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Use a valid date.");
    return value;
  }
  function entry(value) {
    if (!value || typeof value !== "object") throw new Error("Application details are missing.");
    const result = {
      company: clean(value.company, 200), role: clean(value.role, 300), url: jobUrl(value.url),
      location: clean(value.location, 200), applied: date(value.applied),
      status: value.status, followUp: date(value.followUp), notes: clean(value.notes, 4000),
    };
    if (!result.company || !result.role) throw new Error("Add the company and role before saving.");
    if (!result.url) throw new Error("Use an HTTP or HTTPS job URL.");
    if (!STATUSES.includes(result.status)) throw new Error("Choose a status from the list.");
    result.applied ||= today();
    result.followUp ||= daysFromToday(7);
    return result;
  }
  const rgb = (hex) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
  const textCell = (text) => ({ userEnteredValue: { stringValue: text } });
  function richColumns(sheetId) {
    const body = { sheetId, startRowIndex: 1 };
    return [
      { setDataValidation: { range: { ...body, startColumnIndex: 5, endColumnIndex: 6 }, rule: { condition: { type: "ONE_OF_LIST", values: STATUSES.map(userEnteredValue => ({ userEnteredValue })) }, strict: true, showCustomUi: true } } },
      ...[4, 6].map(i => ({ setDataValidation: { range: { ...body, startColumnIndex: i, endColumnIndex: i + 1 } } })),
      ...[4, 6].map(i => ({ repeatCell: { range: { ...body, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mmm d, yyyy" } } }, fields: "userEnteredFormat.numberFormat" } })),
    ];
  }
  function template(sheetId) {
    const range = { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: HEADERS.length };
    const body = { ...range, startRowIndex: 1 };
    const requests = [
      { updateSheetProperties: { properties: { sheetId, title: "Applications", gridProperties: { frozenRowCount: 1, frozenColumnCount: 2, hideGridlines: true, columnCount: HEADERS.length } }, fields: "title,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines,gridProperties.columnCount" } },
      { repeatCell: { range, cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 11, foregroundColor: rgb("1b1c19") }, verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat" } },
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(textCell) }], fields: "userEnteredValue" } },
      { repeatCell: { range: { ...range, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: rgb("203d35"), textFormat: { bold: true, foregroundColor: rgb("ffffff"), fontFamily: "Arial", fontSize: 11 } } }, fields: "userEnteredFormat" } },
      { setBasicFilter: { filter: { range } } },
      { addBanding: { bandedRange: { range: body, rowProperties: { firstBandColor: rgb("ffffff"), secondBandColor: rgb("f2f7f4") } } } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 10 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
      ...[180, 280, 260, 180, 130, 140, 140, 320].map((pixelSize, i) => ({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: "pixelSize" } })),
      ...richColumns(sheetId),
    ];
    for (const [status, color] of [["Applied", "e5ebff"], ["Interview", "fff0cf"], ["Offer", "d5eddd"], ["Rejected", "f7dede"], ["Withdrawn", "e9e9e9"]]) {
      requests.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ ...body, startColumnIndex: 5, endColumnIndex: 6 }], booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: status }] }, format: { backgroundColor: rgb(color) } } } } });
    }
    requests.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ ...body, startColumnIndex: 6, endColumnIndex: 7 }], booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: '=AND(ISNUMBER($G2),$G2<TODAY(),$F2<>"Rejected",$F2<>"Withdrawn",$F2<>"Offer")' }] }, format: { backgroundColor: rgb("fff0cf") } } } } });
    requests.push({ createDeveloperMetadata: { developerMetadata: { metadataId: 1, metadataKey: "avidTemplate", metadataValue: "1", location: { spreadsheet: true }, visibility: "DOCUMENT" } } });
    return requests;
  }
  function row(record) {
    const e = record.entry;
    const dateCell = value => ({ ...(value ? { userEnteredValue: { numberValue: Date.parse(value) / 86400000 + 25569 } } : {}), userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mmm d, yyyy" } } });
    const values = [textCell(e.company), textCell(e.role), { ...textCell(e.url), userEnteredFormat: { textFormat: { link: { uri: e.url } } } }, textCell(e.location), dateCell(e.applied), textCell(e.status), dateCell(e.followUp), textCell(e.notes), textCell(record.id), textCell(record.key)];
    return { values: values.map(cell => ({ ...cell, userEnteredFormat: { verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", ...cell.userEnteredFormat, textFormat: { fontFamily: "Arial", fontSize: 11, ...cell.userEnteredFormat?.textFormat } } })) };
  }
  function writeRequests(record, sheetId) {
    // Google's atomic batch and unique metadata ID make ambiguous retries safe.
    return [
      { appendCells: { sheetId, rows: [row(record)], fields: "userEnteredValue,userEnteredFormat" } },
      { createDeveloperMetadata: { developerMetadata: { metadataId: record.metadataId, metadataKey: "avidApplication", metadataValue: record.id, location: { spreadsheet: true }, visibility: "DOCUMENT" } } },
    ];
  }
  A.trackerModel = { KEY, HEADERS, STATUSES, ORIGINS, SCRIPTS, clean, today, daysFromToday, jobUrl, jobKey, entry, richColumns, template, row, writeRequests };
})();
