// === 0) nuke old localStorage data from the pre-backend app ===
localStorage.removeItem('reservierungen');  // old offline data
localStorage.removeItem('users');           // old offline users

// force token on every fetch
(function enforceAuthFetch(){
  const origFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const headers = new Headers(init?.headers || {});
    const t = localStorage.getItem('token');
    if (t && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${t}`);
    }
    return origFetch(input, { ...init, headers });
  };
})();

// === 1) Force Authorization header on ALL fetch calls globally ===
(function enforceAuthFetch() {
  const origFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const headers = new Headers(init.headers || {});
    const t = localStorage.getItem('token');
    if (t && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${t}`);
    }
    return origFetch(input, { ...init, headers });
  };
})();


// ================== API BASE & HELPERS ==================
const API = 'http://127.0.0.1:4000';

function getToken() { return localStorage.getItem('token'); }
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
function requireAuth() {
  if (!localStorage.getItem('loggedIn')) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// ================== PAGE BOOTSTRAP ==================
document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.classList.contains('protected') && !requireAuth()) return;
  initLogout();
  fuelleJahrAuswahl();
  await fuelleUnterkunftAuswahl();
  await ladeReservierungen();
  initExcelImport();
});

// ================== AUTH (BACKEND) ==================
async function registerUser(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const errEl = document.getElementById('error');
  const okEl  = document.getElementById('success');
  errEl.textContent = ''; okEl.textContent = ''; btn.disabled = true;

  const firstName = document.getElementById('reg-vorname').value.trim();
  const lastName  = document.getElementById('reg-nachname').value.trim();
  const email     = document.getElementById('reg-email').value.trim();
  const password  = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if (!firstName || !lastName || !email || !password) {
    errEl.textContent = 'Bitte alle Felder ausfüllen.'; btn.disabled = false; return false;
  }
  if (password !== password2) {
    errEl.textContent = 'Passwörter stimmen nicht überein.'; btn.disabled = false; return false;
  }

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Registrierung fehlgeschlagen');
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('loggedIn', '1');
    okEl.textContent = 'Registrierung erfolgreich! Weiterleiten...';
    setTimeout(() => (window.location.href = 'index.html'), 600);
  } catch (err) {
    errEl.textContent = err.message || 'Fehler bei der Registrierung.';
  } finally { btn.disabled = false; }
  return false;
}

async function loginUser(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const errEl = document.getElementById('error');
  errEl.textContent = ''; btn.disabled = true;

  const email    = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Login fehlgeschlagen');
    localStorage.setItem('token', data.accessToken);
    localStorage.setItem('loggedIn', '1');
    window.location.href = 'index.html';
  } catch (err) {
    errEl.textContent = err.message || 'Fehler beim Login.';
  } finally { btn.disabled = false; }
  return false;
}

function initLogout() {
  const logoutBtn = document.getElementById('logout-btn');
  if (!logoutBtn) return;
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('loggedIn');
    window.location.href = 'login.html';
  });
}

// ================== YEAR & UNTERKUNFT SELECTS ==================
function fuelleJahrAuswahl() {
  const selectYear = document.getElementById('select-year');
  if (!selectYear) return;
  const y = new Date().getFullYear();
  selectYear.innerHTML = '';
  for (let i = y - 2; i <= y + 1; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    selectYear.appendChild(opt);
  }
  selectYear.value = y;
}

async function fuelleUnterkunftAuswahl() {
  const select = document.getElementById('select-logement');
  const counter = document.getElementById('total-logements');
  if (!select) return;

  try {
    const res = await fetch(`${API}/api/unterkuenfte`);
    const unterkuenfte = await res.json();
    select.innerHTML = '<option value="alle">Alle</option>';
    unterkuenfte.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name || u.id;
      opt.textContent = u.name || u.id;
      select.appendChild(opt);
    });
    if (counter) counter.textContent = unterkuenfte.length;
  } catch { /* ignore */ }
}

// ================== RESERVIERUNGEN (user-scoped) ==================
async function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

const form = document.getElementById('reservation-form');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireAuth()) return;

    const vorname     = document.getElementById('prenom').value.trim();
    const nachname    = document.getElementById('nom').value.trim();
    const ausweisnum  = document.getElementById('cin').value.trim();
    const telefon     = document.getElementById('telephone').value.trim();
    const startdatum  = document.getElementById('date-debut').value;
    const enddatum    = document.getElementById('date-fin').value;
    const preis       = parseFloat(document.getElementById('prix').value);
    const unterkunft  = document.getElementById('logement').value.trim();
    const standort    = document.getElementById('emplacement').value.trim();

    if (!vorname || !nachname || !ausweisnum || !telefon || !startdatum || !enddatum || isNaN(preis) || preis < 0 || !unterkunft || !standort) {
      alert('❌ Bitte alle Felder korrekt ausfüllen!');
      return;
    }

    const start = new Date(startdatum);
    const ende  = new Date(enddatum);
    const tage  = Math.ceil((ende - start) / (1000*60*60*24));
    if (tage <= 0) { alert('❌ Enddatum muss nach dem Startdatum liegen.'); return; }
    const dauer = `${tage} Tage`;

    const fileAusweis = document.getElementById('photo-cin')?.files?.[0];
    const filePass    = document.getElementById('photo-passeport')?.files?.[0];
    const fotoAusweis = fileAusweis ? await fileToDataUrl(fileAusweis) : 'Kein Foto';
    const fotoPass    = filePass ? await fileToDataUrl(filePass)   : 'Kein Foto';

    const payload = {
      vorname, nachname, ausweisnummer: ausweisnum, telefon,
      startdatum, enddatum, dauer, preis,
      unterkunft, standort, fotoAusweis, fotoPass
    };

    try {
      const res = await fetch(`${API}/api/reservierungen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({message:'Fehler'}));
        throw new Error(err.message || 'Fehler beim Speichern');
      }
      form.reset();
      await ladeReservierungen();
      await fuelleUnterkunftAuswahl();
    } catch (err) {
      alert(err.message || 'Fehler beim Speichern.');
    }
  });
}

async function ladeReservierungen() {
  const list = document.getElementById('reservation-list');
  if (!list) return;

  try {
    const res = await fetch(`${API}/api/reservierungen`, { headers: { ...authHeaders() } });
    const reservierungen = await res.json();
    list.innerHTML = reservierungen.map(r => `
      <tr>
        <td>${r.vorname ?? ''}</td>
        <td>${r.nachname ?? ''}</td>
        <td>${r.startdatum ?? ''} → ${r.enddatum ?? ''}</td>
        <td>${r.dauer ?? ''}</td>
        <td>${Number(r.preis || 0).toFixed(2)} €</td>
        <td>${r.fotoAusweis === 'Kein Foto' || !r.fotoAusweis ? 'Kein Foto' : `<img src="${r.fotoAusweis}" class="thumb" alt="Ausweis">`}</td>
        <td>${r.fotoPass === 'Kein Foto' || !r.fotoPass ? 'Kein Foto' : `<img src="${r.fotoPass}" class="thumb" alt="Pass">`}</td>
        <td>${r.unterkunft ?? ''}</td>
        <td>${r.standort ?? ''}</td>
        <td><button class="btn-danger" onclick="delRez('${r.id}')">🗑</button></td>
      </tr>
    `).join('');

    aktualisiereSummen(reservierungen);
  } catch {
    list.innerHTML = '';
    aktualisiereSummen([]);
  }
}

async function delRez(id) {
  if (!requireAuth()) return;
  try {
    await fetch(`${API}/api/reservierungen/${id}`, {
      method: 'DELETE',
      headers: { ...authHeaders() }
    });
    await ladeReservierungen();
  } catch {
    alert('Löschen fehlgeschlagen.');
  }
}

function aktualisiereSummen(resList) {
  const reservierungen = Array.isArray(resList) ? resList : [];
  let gesamtMonat = 0, gesamtJahr = 0;
  const m = new Date().getMonth(), y = new Date().getFullYear();
  reservierungen.forEach(r => {
    const d = new Date(r.startdatum);
    const p = Number(r.preis) || 0;
    if (d.getFullYear() === y) { gesamtJahr += p; if (d.getMonth() === m) gesamtMonat += p; }
  });
  const monatDiv = document.getElementById('total-mensuel');
  const jahrDiv  = document.getElementById('total-annuel');
  if (monatDiv) monatDiv.textContent = `${gesamtMonat.toFixed(2)} €`;
  if (jahrDiv)  jahrDiv.textContent  = `${gesamtJahr.toFixed(2)} €`;
}

// ================== EXCEL IMPORT (POST TO BACKEND) ==================
let importierteExcelDaten = [];

function initExcelImport() {
  const fileInput = document.getElementById('excel-file');
  const pickBtn   = document.getElementById('excel-browse');
  const importAll = document.getElementById('excel-import-all');
  const fileName  = document.getElementById('excel-file-name');
  if (!fileInput || !pickBtn || !importAll) return;

  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    if (fileName) fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        importierteExcelDaten = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (importierteExcelDaten.length > 0) {
          fuelleFormularMitExcel(importierteExcelDaten[0]);
          importAll.disabled = false;
        }
      } catch (e) {
        console.error(e);
        alert('Excel konnte nicht gelesen werden.');
      }
    };
    reader.readAsArrayBuffer(file);
  });

  importAll.addEventListener('click', async () => {
    if (!requireAuth()) return;
    if (!importierteExcelDaten.length) return;
    try {
      for (const row of importierteExcelDaten) {
        const start = new Date(row['Startdatum']);
        const ende  = new Date(row['Enddatum']);
        const tage  = Math.ceil((ende - start) / 86400000);
        if (isNaN(start) || isNaN(ende) || tage <= 0) continue;

        const payload = {
          vorname: row['Vorname'] || '',
          nachname: row['Nachname'] || '',
          ausweisnummer: row['Ausweisnummer'] || '',
          telefon: row['Telefonnummer'] || '',
          startdatum: row['Startdatum'] || '',
          enddatum: row['Enddatum'] || '',
          dauer: `${tage} Tage`,
          preis: Number(row['Preis']) || 0,
          unterkunft: row['Unterkunft'] || '',
          standort: row['Standort'] || '',
          fotoAusweis: 'Kein Foto',
          fotoPass: 'Kein Foto'
        };

        await fetch(`${API}/api/reservierungen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload)
        });
      }
      await ladeReservierungen();
      await fuelleUnterkunftAuswahl();
      alert('Alle Zeilen importiert.');
    } catch { alert('Import fehlgeschlagen.'); }
  });
}

function fuelleFormularMitExcel(entry) {
  const map = {
    Vorname: 'prenom',
    Nachname: 'nom',
    Ausweisnummer: 'cin',
    Telefonnummer: 'telephone',
    Startdatum: 'date-debut',
    Enddatum: 'date-fin',
    Preis: 'prix',
    Unterkunft: 'logement',
    Standort: 'emplacement'
  };
  Object.entries(map).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el && entry[k] != null) el.value = entry[k];
  });
}

// ================== PDF EXPORT (user-scoped fetch) ==================
const monate = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

document.getElementById('export-pdf-annee')?.addEventListener('click', async () => {
  const jahr = parseInt(document.getElementById('select-year').value);
  await exportierePDF(jahr);
});
document.getElementById('export-pdf-mois')?.addEventListener('click', async () => {
  const jahr  = parseInt(document.getElementById('select-year').value);
  const monat = parseInt(document.getElementById('select-month').value);
  await exportierePDFMonat(jahr, monat);
});

async function exportierePDF(jahr) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const selectedLogement = document.getElementById('select-logement').value;

  const res = await fetch(`${API}/api/reservierungen`, { headers: { ...authHeaders() } });
  const all = await res.json();

  const rows = all.filter(r =>
    new Date(r.startdatum).getFullYear() === jahr &&
    (selectedLogement === 'alle' || r.unterkunft === selectedLogement)
  );

  if (!rows.length) { alert('Keine Daten zum Exportieren für dieses Jahr.'); return; }

  doc.text(`Reservierungen ${jahr}`, 105, 15, { align: 'center' });
  const data = rows.map((r, i) => [
    i + 1, `${r.vorname ?? ''} ${r.nachname ?? ''}`, r.ausweisnummer ?? '',
    r.telefon ?? '', r.unterkunft ?? '', r.standort ?? '',
    `${r.startdatum ?? ''} - ${r.enddatum ?? ''}`, r.dauer ?? '',
    `${Number(r.preis||0).toFixed(2)} €`
  ]);
  doc.autoTable({ head: [[ '#','Kunde','Ausweis','Telefon','Unterkunft','Standort','Zeitraum','Dauer','Preis' ]], body: data, startY: 25 });
  doc.save(`reservierungen_${jahr}.pdf`);
}

async function exportierePDFMonat(jahr, monat) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const selectedLogement = document.getElementById('select-logement').value;

  const res = await fetch(`${API}/api/reservierungen`, { headers: { ...authHeaders() } });
  const all = await res.json();

  const rows = all.filter(r => {
    const d = new Date(r.startdatum);
    return d.getFullYear() === jahr && d.getMonth() === monat &&
           (selectedLogement === 'alle' || r.unterkunft === selectedLogement);
  });

  if (!rows.length) { alert(`Keine Reservierungen für ${monate[monat]} ${jahr}`); return; }

  doc.text(`Reservierungen ${monate[monat]} ${jahr}`, 105, 15, { align: 'center' });
  const data = rows.map((r, i) => [
    i + 1, `${r.vorname ?? ''} ${r.nachname ?? ''}`, r.ausweisnummer ?? '',
    r.telefon ?? '', r.unterkunft ?? '', r.standort ?? '',
    `${r.startdatum ?? ''} - ${r.enddatum ?? ''}`, r.dauer ?? '',
    `${Number(r.preis||0).toFixed(2)} €`
  ]);
  doc.autoTable({ head: [[ '#','Kunde','Ausweis','Telefon','Unterkunft','Standort','Zeitraum','Dauer','Preis' ]], body: data, startY: 25 });
  doc.save(`reservierungen_${jahr}_${monate[monat]}.pdf`);
}
