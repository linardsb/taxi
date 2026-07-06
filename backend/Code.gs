/**
 * Sakta Cab — anketas backend (Google Apps Script)
 *
 * Ko dara: pieņem anketas lapas (Cloudflare Pages) POST pieprasījumus un glabā
 * visu Linarda Google kontā — atbildes Google Sheet, ekrānuzņēmumus Drive mapē.
 * API kontrakts 1:1 atbilst frontend `app.js` galvenes komentāram.
 *
 * UZSTĀDĪŠANA (vienreiz):
 *   1) Palaid funkciju `setup` — tā izveido Sheet "Sakta Cab — atbildes",
 *      Drive mapi "Sakta Cab", abus slepenos tokenus un saglabā ID Script Properties.
 *   2) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   3) /exec URL ieliec frontend `config.js` (apiUrl).
 * Pilnā instrukcija: DEPLOY.md.
 */

var PROPS = PropertiesService.getScriptProperties();

var SHEET_ANSWERS = 'Atbildes';
var SHEET_EVENTS = 'Notikumi';
// Kolonnas: A qid | B sadaļa | C atbild | D atbilde JSON | E izlaists | F statuss | G komentārs | H faili JSON | I atjaunināts
var HEADERS = ['qid', 'sadaļa', 'atbild', 'atbilde (JSON)', 'izlaists', 'statuss', 'komentārs', 'faili (JSON)', 'atjaunināts'];

/* ───────────────────────── Setup ───────────────────────── */

function setup() {
  if (PROPS.getProperty('SHEET_ID')) {
    Logger.log('Jau uzstādīts — nekas netiek mainīts. Esošā informācija:');
    logInfo_();
    return;
  }
  var ss = SpreadsheetApp.create('Sakta Cab — atbildes');
  var sh = ss.getSheets()[0];
  sh.setName(SHEET_ANSWERS);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var ev = ss.insertSheet(SHEET_EVENTS);
  ev.getRange(1, 1, 1, 3).setValues([['laiks', 'notikums', 'sadaļa']]).setFontWeight('bold');
  ev.setFrozenRows(1);

  var folder = DriveApp.createFolder('Sakta Cab');

  PROPS.setProperties({
    SHEET_ID: ss.getId(),
    FOLDER_ID: folder.getId(),
    TOKEN_ANKETA: rand_(),
    TOKEN_ADMIN: rand_(),
    NOTIFY_EMAIL: Session.getActiveUser().getEmail() || 'linardsberzins@gmail.com',
    COMPLETED: '[]',
    APP_URL: 'https://sakta-cab.pages.dev',
    RESP_EMAILS: 'atisvikis@gmail.com', // precizējumu e-pastu saņēmēji — pievieno Dinas adresi ar komatu
  });
  Logger.log('Gatavs! ↓');
  logInfo_();
}

function logInfo_() {
  var p = PROPS.getProperties();
  Logger.log('Sheet:      https://docs.google.com/spreadsheets/d/' + p.SHEET_ID);
  Logger.log('Drive mape: https://drive.google.com/drive/folders/' + p.FOLDER_ID);
  Logger.log('TOKEN_ANKETA (saite Atim & Dinai): ?t=' + p.TOKEN_ANKETA);
  Logger.log('TOKEN_ADMIN  (saite Linardam):     ?t=' + p.TOKEN_ADMIN);
  Logger.log('Pēc publicēšanas saites būs: <lapas-URL>/?t=<tokens>');
}

function rand_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

/* ───────────────────────── HTTP ───────────────────────── */

function doGet() {
  return ContentService.createTextOutput('Sakta Cab API — OK').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    var role = roleFor_(req.token);
    if (!role) throw new Error('Nederīga saite (tokens).');
    res = route_(req, role);
    res.ok = true;
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function roleFor_(token) {
  if (!token) return null;
  if (token === PROPS.getProperty('TOKEN_ADMIN')) return 'admin';
  if (token === PROPS.getProperty('TOKEN_ANKETA')) return 'anketa';
  return null;
}

function route_(req, role) {
  switch (req.action) {
    case 'getState':        return { role: role, state: buildState_() };
    case 'saveAnswer':      return saveAnswer_(req);
    case 'uploadFile':      return uploadFile_(req);
    case 'deleteFile':      return deleteFile_(req);
    case 'sectionComplete': return sectionComplete_(req);
    case 'setStatus':
      if (role !== 'admin') throw new Error('Tikai admin saitei.');
      return setStatus_(req);
    case 'notifyPrecizejumi':
      if (role !== 'admin') throw new Error('Tikai admin saitei.');
      return notifyPrecizejumi_(req);
    default: throw new Error('Nezināma darbība: ' + req.action);
  }
}

/* ─────────────────── Sheet palīgi ─────────────────── */

function sheet_(name) {
  return SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID')).getSheetByName(name);
}

function sectionOf_(qid) {
  var m = String(qid).match(/^S(\d+)-/);
  return m ? Number(m[1]) : '';
}

// Atrod vai izveido qid rindu un ļauj to izmainīt; ar LockService pret vienlaicīgiem rakstiem.
function upsert_(qid, mutate) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_ANSWERS);
    var last = sh.getLastRow();
    var row = -1;
    if (last > 1) {
      var col = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < col.length; i++) {
        if (col[i][0] === qid) { row = i + 2; break; }
      }
    }
    var vals;
    if (row === -1) {
      row = last + 1;
      vals = [qid, sectionOf_(qid), '', '{}', '', '', '', '[]', ''];
    } else {
      vals = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    }
    mutate(vals);
    vals[8] = new Date();
    sh.getRange(row, 1, 1, HEADERS.length).setValues([vals]);
  } finally {
    lock.releaseLock();
  }
}

function safeParse_(s, dflt) {
  try {
    var v = JSON.parse(s);
    return (v === null || v === undefined) ? dflt : v;
  } catch (e) { return dflt; }
}

/* ─────────────────── Darbības ─────────────────── */

function buildState_() {
  var sh = sheet_(SHEET_ANSWERS);
  var last = sh.getLastRow();
  var answers = {};
  if (last > 1) {
    var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    rows.forEach(function (v) {
      if (!v[0]) return;
      answers[v[0]] = {
        data: safeParse_(v[3], {}),
        files: safeParse_(v[7], []),
        skipped: v[4] === 'jā',
        status: v[5] || null,
        comment: v[6] || '',
        by: v[2] || null,
      };
    });
  }
  return {
    answers: answers,
    completed: safeParse_(PROPS.getProperty('COMPLETED'), []),
    introSeen: false, // ievadu rāda vienreiz katrā pārlūkā (frontend localStorage)
  };
}

function saveAnswer_(req) {
  upsert_(req.qid, function (v) {
    v[2] = req.by || '';
    v[3] = JSON.stringify(req.data || {});
    v[4] = req.skipped ? 'jā' : '';
    v[5] = req.status || '';
  });
  return {};
}

function uploadFile_(req) {
  var root = DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID'));
  var subName = 'Sadaļa ' + sectionOf_(req.qid);
  var it = root.getFoldersByName(subName);
  var sub = it.hasNext() ? it.next() : root.createFolder(subName);

  var bytes = Utilities.base64Decode(req.dataB64);
  var blob = Utilities.newBlob(bytes, req.mime || 'application/octet-stream', req.qid + ' — ' + (req.name || 'fails'));
  var file = sub.createFile(blob);
  // "Ikviens ar saiti var skatīt" — lai attēli rādās anketā bez Google pieslēgšanās.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var meta = {
    id: file.getId(),
    name: req.name || file.getName(),
    mime: req.mime || '',
    url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    thumb: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400',
  };
  upsert_(req.qid, function (v) {
    var files = safeParse_(v[7], []);
    files.push(meta);
    v[7] = JSON.stringify(files);
  });
  return { file: meta };
}

function deleteFile_(req) {
  upsert_(req.qid, function (v) {
    var files = safeParse_(v[7], []).filter(function (f) { return f.id !== req.fileId; });
    v[7] = JSON.stringify(files);
  });
  try { DriveApp.getFileById(req.fileId).setTrashed(true); } catch (e) {}
  return {};
}

function sectionComplete_(req) {
  var sid = Number(req.sectionId);
  var completed = safeParse_(PROPS.getProperty('COMPLETED'), []);
  if (completed.indexOf(sid) === -1) {
    completed.push(sid);
    PROPS.setProperty('COMPLETED', JSON.stringify(completed));
  }
  sheet_(SHEET_EVENTS).appendRow([new Date(), 'sadaļa pabeigta', sid]);

  var email = PROPS.getProperty('NOTIFY_EMAIL');
  if (email) {
    var appUrl = PROPS.getProperty('APP_URL') || '';
    var adminLink = appUrl
      ? appUrl.replace(/\/$/, '') + '/?t=' + PROPS.getProperty('TOKEN_ADMIN')
      : '(ieraksti APP_URL Script Properties, lai šeit būtu klikšķināma saite)';
    MailApp.sendEmail(
      email,
      'Sakta Cab: pabeigta sadaļa ' + sid,
      'Anketā tikko atzīmēta kā pabeigta sadaļa ' + sid + '.\n\n' +
      'Apskatīt un apstiprināt atbildes:\n' + adminLink + '\n\n' +
      '— Sakta Cab anketa'
    );
  }
  return {};
}

function setStatus_(req) {
  upsert_(req.qid, function (v) {
    v[5] = req.status || '';
    v[6] = req.comment || '';
  });
  return {};
}

// Viens kopsavilkuma e-pasts Atim & Dinai par visiem atvērtajiem precizējumiem.
// Frontend atsūta sarakstu (jautājuma nr., teksts, komentārs) — backend tikai formatē un sūta.
function notifyPrecizejumi_(req) {
  var items = req.items || [];
  if (!items.length) throw new Error('Nav atvērtu precizējumu.');
  var to = (PROPS.getProperty('RESP_EMAILS') || '').trim();
  if (!to) throw new Error('Ieraksti RESP_EMAILS (⚙ Project Settings → Script Properties) — adreses, atdalot ar komatu.');
  var appUrl = PROPS.getProperty('APP_URL') || '';
  var link = appUrl
    ? appUrl.replace(/\/$/, '') + '/?t=' + PROPS.getProperty('TOKEN_ANKETA')
    : '(anketas saite — ieraksti APP_URL Script Properties)';
  var lines = items.map(function (it) {
    return '• ' + it.num + '. ' + it.text + '\n   Linards: ' + (it.comment || '');
  });
  MailApp.sendEmail(
    to,
    'Sakta Cab: Linards lūdz precizēt ' + items.length + ' atbildi(-es)',
    'Sveiki!\n\nLinards pārskatīja jūsu atbildes un lūdz precizēt šos jautājumus:\n\n' +
    lines.join('\n\n') +
    '\n\nAtveriet anketu — pie šiem jautājumiem būs oranžs komentārs:\n' + link + '\n\n— Sakta Cab anketa'
  );
  sheet_(SHEET_EVENTS).appendRow([new Date(), 'nosūtīts precizējumu e-pasts (' + items.length + ')', '']);
  return { sent: items.length };
}

/* ─────────────────── Testa datu tīrīšana ─────────────────── */

// Palaid PIRMS īstās palaišanas, lai notīrītu izmēģinājuma atbildes.
// Izdzēš visas atbilžu un notikumu rindas un COMPLETED sarakstu.
// Tokenus un URL nemaina. Drive mapē ieliktos testa failus izdzēs ar roku.
function resetAnswers() {
  var sh = sheet_(SHEET_ANSWERS);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  var ev = sheet_(SHEET_EVENTS);
  if (ev.getLastRow() > 1) ev.deleteRows(2, ev.getLastRow() - 1);
  PROPS.setProperty('COMPLETED', '[]');
  Logger.log('Testa atbildes notīrītas. Drive failus, ja tādi ir, izdzēs ar roku.');
}
