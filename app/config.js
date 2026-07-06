// Sakta Cab — konfigurācija
//
// apiUrl: Google Apps Script web-app URL (backend, kas saglabā atbildes
// Google Sheets + ekrānuzņēmumus Google Drive). Kamēr tukšs — DEMO režīms:
// viss glabājas tikai šajā pārlūkā (localStorage + IndexedDB), lomu izvēlas
// ar pogu vai ?p=soferis / ?p=dispecere / ?p=admin.
//
// Kad backend ir izvietots, ieraksti URL šeit; tad lapa strādā ar personīgajām
// saitēm ?t=<token> (tokenus lomām piešķir backend Script Properties).
window.TAXI_CONFIG = {
  apiUrl: '',
};
