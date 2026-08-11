const API = '/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

let chartMentionsInstance = null;
let chartTauxInstance = null;
let epreuveIdSujet = null;
let ordreAutoSujet = 1;

// mémorise le concours actuellement ouvert dans le dashboard,
// pour que le bouton "Voir les résultats de ce concours" sache où aller.
let concoursActuelDashboard = null;

// ===== Sécurité : on bloque tout de suite si ce n'est pas un admin =====
if (!token || user.role !== 'admin') {
  alert('Accès refusé. Vous devez être administrateur.');
  window.location.href = 'login.html';
  throw new Error('Accès non autorisé - arrêt du script admin.js');
}

document.getElementById('nomAdmin').textContent = `👤 ${user.nom || 'Admin'}`;

// Anti-XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function deconnexion() {
  localStorage.clear();
  window.location.href = 'login.html';
}

function afficherSection(nom) {
  if (nom === 'resultats') remplirSelectConcoursResultats();
  if (nom === 'validation') chargerEpreuvesAttente();
  if (nom === 'liste') chargerTableau();
  if (nom === 'candidatures') chargerCandidatures();
  if (nom === 'dashboard') chargerStats();
  if (nom === 'creer_sujet') chargerConcoursSujet();
  if (nom === 'affectations') chargerConcoursAffectation();
  if (nom === 'notifications') chargerCandidatsNotif();

  ['dashboard', 'creer', 'liste', 'candidatures', 'utilisateurs', 'validation', 'creer_sujet', 'resultats', 'affectations', 'notifications']
    .forEach(s => {
      document.getElementById(`section-${s}`).style.display = s === nom ? '' : 'none';
    });
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
}

// ===== Dashboard / Stats =====
async function chargerStats() {
  try {
    const res = await fetch(`${API}/concours`, { headers: { 'Authorization': `Bearer ${token}` } });
    const concours = await res.json();
    document.getElementById('statTotal').textContent = concours.length;
    document.getElementById('statOuvert').textContent = concours.filter(c => c.statut === 'ouvert').length;
    afficherListeConcoursDashboard(concours);
  } catch {
    document.getElementById('statTotal').textContent = '–';
    document.getElementById('statOuvert').textContent = '–';
  }
}

function afficherListeConcoursDashboard(concours) {
  const container = document.getElementById('listeConcoursDashboard');

  if (!concours.length) {
    container.innerHTML = '<p class="text-muted text-center py-3">Aucun concours créé.</p>';
    return;
  }

  container.innerHTML = concours.map(c => `
    <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2 concours-dashboard-item"
         style="cursor:pointer;" data-id="${c.id}" data-titre="${escapeHtml(c.titre)}">
      <div>
        <strong>${escapeHtml(c.titre)}</strong>
        <span class="badge bg-light text-dark ms-2" style="font-size:11px;">${escapeHtml(c.statut)}</span>
      </div>
      <span class="text-primary">Voir les stats →</span>
    </div>
  `).join('');

  container.querySelectorAll('.concours-dashboard-item').forEach(el => {
    el.addEventListener('click', () => voirStatsConcours(el.dataset.id, el.dataset.titre));
  });
}

async function voirStatsConcours(id, titre) {
  try {
    const res = await fetch(`${API}/resultats?stats_concours=${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const s = await res.json();

    if (!res.ok) {
      alert(s.message || "Erreur lors du chargement des statistiques.");
      return;
    }

    concoursActuelDashboard = { id, titre };

    document.getElementById('titreStatsConcours').textContent = `📊 ${titre}`;
    document.getElementById('statCandidats').textContent = s.total_candidats;
    document.getElementById('statAdmis').textContent = s.admis;
    document.getElementById('statAjourne').textContent = s.ajourne;
    document.getElementById('statRejete').textContent = s.rejete;
    document.getElementById('statTauxReussite').textContent = s.taux_reussite;
    document.getElementById('statEnAttente').textContent = s.en_attente;

    if (chartMentionsInstance) chartMentionsInstance.destroy();
    if (chartTauxInstance) chartTauxInstance.destroy();

    chartMentionsInstance = new Chart(document.getElementById('chartMentions'), {
      type: 'doughnut',
      data: {
        labels: ['Admis', 'Ajournés', 'Rejetés'],
        datasets: [{ data: [s.admis, s.ajourne, s.rejete], backgroundColor: ['#10b981', '#f59e0b', '#ef4444'] }]
      },
      options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false }
    });

    chartTauxInstance = new Chart(document.getElementById('chartTaux'), {
      type: 'bar',
      data: {
        labels: ['Taux de réussite (%)'],
        datasets: [{ label: 'Taux de réussite', data: [s.taux_reussite], backgroundColor: '#0b132b' }]
      },
      options: {
        indexAxis: 'y',
        scales: { x: { min: 0, max: 100 } },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
      }
    });

    document.getElementById('zoneStatsConcours').style.display = '';
    document.getElementById('zoneStatsConcours').scrollIntoView({ behavior: 'smooth' });
  } catch {
    alert('Erreur réseau lors du chargement des statistiques.');
  }
}

function fermerStatsConcours() {
  document.getElementById('zoneStatsConcours').style.display = 'none';
}

async function allerVersResultats() {
  if (!concoursActuelDashboard) return;

  afficherSection('resultats');

  await remplirSelectConcoursResultats();

  document.getElementById('selectConcoursResultats').value = concoursActuelDashboard.id;
  await chargerResultatsConcours();
}

// ===== Tableau des concours =====
async function chargerTableau() {
  try {
    const res = await fetch(`${API}/concours`, { headers: { 'Authorization': `Bearer ${token}` } });
    const concours = await res.json();

    if (!concours.length) {
      document.getElementById('tableauConcours').innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-4">Aucun concours créé.</td></tr>';
      return;
    }

    document.getElementById('tableauConcours').innerHTML = concours.map(c => `
      <tr>
        <td>${c.id}</td>
        <td><strong>${escapeHtml(c.titre)}</strong></td>
        <td>${new Date(c.date_debut).toLocaleDateString('fr-FR')}</td>
        <td>${new Date(c.date_fin).toLocaleDateString('fr-FR')}</td>
        <td>
          <span class="badge ${c.statut === 'ouvert' ? 'badge-ouvert' : 'badge-ferme'} px-2 py-1 rounded-pill" style="font-size:11px;">
            ${c.statut === 'ouvert' ? '✅ Ouvert' : '❌ Fermé'}
          </span>
        </td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('tableauConcours').innerHTML =
      '<tr><td colspan="5" class="text-danger text-center py-3">Erreur de chargement.</td></tr>';
  }
}

// ===== Créer un concours =====
async function creerConcours() {
  const titre       = document.getElementById('titre').value.trim();
  const description = document.getElementById('description').value.trim();
  const dateDebut    = document.getElementById('dateDebut').value;
  const dateFin       = document.getElementById('dateFin').value;
  const statut        = document.getElementById('statut').value;
  const nbPlaces       = document.getElementById('nbPlaces').value;

  if (!titre || !dateDebut || !dateFin) {
    document.getElementById('alertAdmin').innerHTML =
      '<div class="alert alert-warning">Remplissez au moins le titre et les dates.</div>';
    return;
  }

  if (new Date(dateFin) < new Date(dateDebut)) {
    document.getElementById('alertAdmin').innerHTML =
      '<div class="alert alert-warning">La date de fin ne peut pas être avant la date de début.</div>';
    return;
  }

  try {
    const res = await fetch(`${API}/concours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ titre, description, date_debut: dateDebut, date_fin: dateFin, statut, nb_places: nbPlaces || null })
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('alertAdmin').innerHTML =
        '<div class="alert alert-success">✅ Concours créé avec succès !</div>';
      ['titre', 'description', 'dateDebut', 'dateFin', 'nbPlaces'].forEach(id => document.getElementById(id).value = '');
      chargerStats();
    } else {
      document.getElementById('alertAdmin').innerHTML =
        `<div class="alert alert-danger">${escapeHtml(data.message)}</div>`;
    }
  } catch {
    document.getElementById('alertAdmin').innerHTML =
      '<div class="alert alert-danger">Erreur réseau.</div>';
  }
}

// ===== Créer un utilisateur (admin/jury) =====
async function creerUtilisateur() {
  const nom      = document.getElementById('newNom').value.trim();
  const email    = document.getElementById('newEmail').value.trim();
  const password = document.getElementById('newPassword').value;
  const role     = document.getElementById('newRole').value;

  if (!nom || !email || !password) {
    document.getElementById('alertUser').innerHTML =
      '<div class="alert alert-warning">Remplissez tous les champs.</div>';
    return;
  }

  if (password.length < 6) {
    document.getElementById('alertUser').innerHTML =
      '<div class="alert alert-warning">Le mot de passe doit faire au moins 6 caractères.</div>';
    return;
  }

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'create_user', nom, email, password, role })
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('alertUser').innerHTML =
        '<div class="alert alert-success">✅ Utilisateur créé !</div>';
      ['newNom', 'newEmail', 'newPassword'].forEach(id => document.getElementById(id).value = '');
    } else {
      document.getElementById('alertUser').innerHTML =
        `<div class="alert alert-danger">${escapeHtml(data.message)}</div>`;
    }
  } catch {
    document.getElementById('alertUser').innerHTML =
      '<div class="alert alert-danger">Erreur réseau.</div>';
  }
}

// ===== Candidatures =====
async function chargerCandidatures() {
  try {
    const res = await fetch(`${API}/candidatures?all=1`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      document.getElementById('tableauCandidatures').innerHTML =
        '<tr><td colspan="6" class="text-center text-muted py-4">Aucune candidature reçue.</td></tr>';
      return;
    }

    document.getElementById('tableauCandidatures').innerHTML = data.map(c => `
      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.candidat_nom)}</td>
        <td>${escapeHtml(c.concours_titre)}</td>
        <td>${new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
        <td>${escapeHtml(c.statut)}</td>
        <td>
          <a href="dossier.html?id=${c.id}&nom=${encodeURIComponent(c.candidat_nom)}"
             target="_blank" class="btn btn-sm btn-outline-primary">👁️ Voir dossier</a>
          <button class="btn btn-sm btn-success" onclick="validerCandidature(${c.id})">✅ Valider</button>
          <button class="btn btn-sm btn-danger" onclick="refuserCandidature(${c.id})">❌ Refuser</button>
        </td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('tableauCandidatures').innerHTML =
      '<tr><td colspan="6" class="text-danger text-center py-3">Erreur de chargement.</td></tr>';
  }
}

async function validerCandidature(id) { await changerStatutCandidature(id, 'validé'); }
async function refuserCandidature(id) { await changerStatutCandidature(id, 'rejeté'); }

async function changerStatutCandidature(id, statut) {
  try {
    const res = await fetch(`${API}/candidatures`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id, statut })
    });

    if (res.ok) {
      chargerCandidatures();
    } else {
      alert('Erreur lors de la mise à jour du statut');
    }
  } catch {
    alert('Erreur réseau');
  }
}

// ===== Validation des épreuves =====
async function chargerEpreuvesAttente() {
  try {
    const res = await fetch(`${API}/epreuves?en_attente=1`, { headers: { 'Authorization': `Bearer ${token}` } });
    const epreuves = await res.json();
    const container = document.getElementById('listeEpreuvesAttente');

    if (!epreuves.length) {
      container.innerHTML = '<p class="text-muted text-center py-4">Aucune épreuve créée.</p>';
      return;
    }

    container.innerHTML = epreuves.map(e => `
      <div class="border rounded p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div>
            <strong>${escapeHtml(e.titre)}</strong>
            <div class="text-muted" style="font-size:13px;">
              Concours : ${escapeHtml(e.concours_titre)} • Type : ${escapeHtml(e.type)} • Durée : ${e.duree} min
            </div>
          </div>
          <div class="d-flex gap-2">
            <a href="sujet.html?id=${e.id}" target="_blank" class="btn btn-outline-primary btn-sm">👁️ Voir le sujet</a>
            ${e.modifiable == 1
              ? `<button class="btn btn-warning btn-sm btn-modifier-epreuve" data-id="${e.id}" data-titre="${escapeHtml(e.titre)}">✏️ Modifier</button>`
              : `<button class="btn btn-secondary btn-sm" disabled title="Épreuve déjà débutée">🔒 Verrouillée</button>`
            }
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-modifier-epreuve').forEach(btn => {
      btn.addEventListener('click', () => ouvrirModificationEpreuve(btn.dataset.id, btn.dataset.titre));
    });
  } catch {
    document.getElementById('listeEpreuvesAttente').innerHTML =
      '<p class="text-danger text-center py-3">Erreur de chargement.</p>';
  }
}

async function ouvrirModificationEpreuve(id, titre) {
  afficherSection('creer_sujet');

  epreuveIdSujet = id;
  ordreAutoSujet = 1;

  document.querySelector('#section-creer_sujet .form-card').style.display = 'none';
  document.getElementById('badgeEpreuveSujet').textContent = `Épreuve (édition) : ${titre}`;
  document.getElementById('sectionQuestionsSujet').style.display = '';

  showAlertSujet(`Édition de "${escapeHtml(titre)}" — les questions existantes sont chargées ci-dessous.`, 'success');

  await rafraichirListeQuestionsSujet();
}

async function voirQuestions(epreuve_id) {
  const zone = document.getElementById(`questions-${epreuve_id}`);
  if (!zone) return;

  if (zone.style.display !== 'none') {
    zone.style.display = 'none';
    return;
  }

  zone.innerHTML = '<p class="text-muted">Chargement...</p>';
  zone.style.display = '';

  try {
    const res = await fetch(`${API}/questions?epreuve_id=${epreuve_id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const questions = await res.json();

    if (!questions.length) {
      zone.innerHTML = '<p class="text-muted">Aucune question dans ce sujet.</p>';
      return;
    }

    zone.innerHTML = questions.map((q, i) => {
      let choix = [];
      try { choix = JSON.parse(q.choix || '[]').filter(c => c.texte); } catch { choix = []; }

      const choixHtml = choix.map(c => `
        <div style="color: ${c.est_correcte ? 'green' : '#666'}; font-size:13px;">
          ${c.est_correcte ? '✅' : '○'} ${escapeHtml(c.texte)}
        </div>
      `).join('');

      return `
        <div class="mb-3">
          <div class="fw-semibold">Q${i + 1}. ${escapeHtml(q.enonce)}</div>
          <span class="badge bg-light text-dark" style="font-size:11px;">${escapeHtml(q.type)} • ${q.points} pt(s)</span>
          <div class="mt-1">${choixHtml || '<small class="text-muted">Correction manuelle</small>'}</div>
        </div>
      `;
    }).join('');
  } catch {
    zone.innerHTML = '<p class="text-danger">Erreur de chargement.</p>';
  }
}

async function validerEpreuve(id, statut) {
  try {
    const res = await fetch(`${API}/epreuves`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id, statut_validation: statut })
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('alertValidation').innerHTML = `<div class="alert alert-success">${escapeHtml(data.message)}</div>`;
      chargerEpreuvesAttente();
    } else {
      document.getElementById('alertValidation').innerHTML = `<div class="alert alert-danger">${escapeHtml(data.message || 'Erreur')}</div>`;
    }
  } catch {
    document.getElementById('alertValidation').innerHTML = '<div class="alert alert-danger">Erreur réseau.</div>';
  }
}

// ===== Création de sujet =====
function showAlertSujet(msg, type = 'danger') {
  document.getElementById('alertMsgSujet').innerHTML =
    `<div class="alert alert-${type} alert-dismissible">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

async function chargerConcoursSujet() {
  try {
    const res = await fetch(`${API}/concours`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    const sel = document.getElementById('selectConcoursSujet');
    sel.innerHTML = '<option value="">-- Choisir un concours --</option>';
    data.forEach(c => { sel.innerHTML += `<option value="${c.id}">${escapeHtml(c.titre)}</option>`; });
  } catch {
    showAlertSujet('Erreur de chargement des concours.');
  }
}

async function creerEpreuveSujet() {
  const concours_id  = document.getElementById('selectConcoursSujet').value;
  const titre        = document.getElementById('titreEpreuve').value.trim();
  const type         = document.getElementById('typeEpreuve').value;
  const duree        = document.getElementById('dureeEpreuve').value;
  const coefficient  = document.getElementById('coefficientEpreuve').value;
  const date_epreuve = document.getElementById('dateEpreuve').value;

  if (!concours_id || !titre || !duree) {
    showAlertSujet('Remplis tous les champs obligatoires.');
    return;
  }

  try {
    const res = await fetch(`${API}/epreuves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ concours_id, titre, type, duree, coefficient, date_epreuve })
    });
    const data = await res.json();

    if (res.ok) {
      epreuveIdSujet = data.id;
      document.getElementById('badgeEpreuveSujet').textContent = `Épreuve : ${titre}`;
      document.getElementById('sectionQuestionsSujet').style.display = '';
      showAlertSujet('Épreuve créée ! Ajoutez maintenant vos questions. ✅', 'success');
      document.getElementById('btnEnvoiZoneSujet').style.display = '';
      afficherFormulaireQuestionSujet();
    } else {
      showAlertSujet(data.message || 'Erreur lors de la création.');
    }
  } catch {
    showAlertSujet('Erreur réseau.');
  }
}

function afficherFormulaireQuestionSujet() {
  const type = document.getElementById('typeQuestion').value;
  const zoneChoix = document.getElementById('zoneChoix');
  const zoneMedia = document.getElementById('zoneMedia');

  zoneMedia.style.display = type === 'etude_de_cas' ? '' : 'none';

  if (['qcm', 'qrm'].includes(type)) {
    zoneChoix.innerHTML = `
      <label class="form-label fw-semibold">Choix de réponses <small class="text-muted">(${type === 'qcm' ? 'une seule bonne réponse' : 'plusieurs bonnes réponses possibles'})</small></label>
      <div id="listeChoix">${genererChoixSujet(3)}</div>
      <button type="button" class="btn btn-outline-secondary btn-sm mt-2" onclick="ajouterChoixSujet()">+ Ajouter un choix</button>
    `;
  } else if (type === 'vrai_faux') {
    zoneChoix.innerHTML = `
      <label class="form-label fw-semibold">Bonne réponse</label>
      <select class="form-select" id="bonneReponseVraiFaux">
        <option value="Vrai">Vrai</option>
        <option value="Faux">Faux</option>
      </select>
    `;
  } else if (type === 'completion') {
    zoneChoix.innerHTML = `
      <label class="form-label fw-semibold">Réponse attendue <small class="text-muted">(le ou les mots à placer dans le blanc)</small></label>
      <input type="text" class="form-control" id="bonneReponseTexte" placeholder="Ex: photosynthèse" />
    `;
  } else if (type === 'calcul') {
    zoneChoix.innerHTML = `
      <label class="form-label fw-semibold">Résultat exact attendu</label>
      <input type="text" class="form-control" id="bonneReponseTexte" placeholder="Ex: 42" />
    `;
  } else {
    zoneChoix.innerHTML = `<div class="alert alert-info py-2">✏️ Correction manuelle par le jury — pas de choix à définir.</div>`;
  }
}

function genererChoixSujet(n) {
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `
      <div class="choix-item d-flex align-items-center gap-2 mb-2">
        <input type="checkbox" class="form-check-input est-correcte" title="Bonne réponse" />
        <input type="text" class="form-control form-control-sm texte-choix" placeholder="Choix ${i + 1}" />
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest('.choix-item').remove()">✕</button>
      </div>`;
  }
  return html;
}

function ajouterChoixSujet() {
  document.getElementById('listeChoix').insertAdjacentHTML('beforeend', `
    <div class="choix-item d-flex align-items-center gap-2 mb-2">
      <input type="checkbox" class="form-check-input est-correcte" title="Bonne réponse" />
      <input type="text" class="form-control form-control-sm texte-choix" placeholder="Nouveau choix" />
      <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest('.choix-item').remove()">✕</button>
    </div>
  `);
}

function construireChoixSujet(type) {
  if (['qcm', 'qrm'].includes(type)) {
    const checkboxes = document.querySelectorAll('.est-correcte');
    const textes = document.querySelectorAll('.texte-choix');
    let choix = [];
    textes.forEach((t, i) => {
      if (t.value.trim()) choix.push({ texte: t.value.trim(), est_correcte: checkboxes[i].checked });
    });
    return choix;
  } else if (type === 'vrai_faux') {
    const bonne = document.getElementById('bonneReponseVraiFaux').value;
    return [
      { texte: 'Vrai', est_correcte: bonne === 'Vrai' },
      { texte: 'Faux', est_correcte: bonne === 'Faux' }
    ];
  } else if (['completion', 'calcul'].includes(type)) {
    const bonne = document.getElementById('bonneReponseTexte').value.trim();
    return [{ texte: bonne, est_correcte: true }];
  }
  return [];
}

async function ajouterQuestionSujet() {
  const type = document.getElementById('typeQuestion').value;
  const enonce = document.getElementById('enonce').value.trim();
  const points = document.getElementById('points').value;
  const choix = construireChoixSujet(type);

  if (!enonce) { showAlertSujet("L'énoncé est obligatoire."); return; }

  if (!epreuveIdSujet) { showAlertSujet("Aucune épreuve sélectionnée."); return; }

  const formData = new FormData();
  formData.append('epreuve_id', epreuveIdSujet);
  formData.append('enonce', enonce);
  formData.append('type', type);
  formData.append('points', points);
  formData.append('ordre', ordreAutoSujet);
  formData.append('choix', JSON.stringify(choix));

  if (type === 'etude_de_cas') {
    const fichier = document.getElementById('mediaFichier').files[0];
    if (fichier) formData.append('media', fichier);
  }

  try {
    const res = await fetch(`${API}/questions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();

    if (res.ok) {
      afficherQuestionDansApercuSujet(type, enonce, choix, points, ordreAutoSujet, data.id);
      ordreAutoSujet++;
      document.getElementById('ordre').value = ordreAutoSujet;
      document.getElementById('enonce').value = '';
      const mediaFichier = document.getElementById('mediaFichier');
      if (mediaFichier) mediaFichier.value = '';
      showAlertSujet('Question ajoutée ✅', 'success');
    } else {
      showAlertSujet(data.message || 'Erreur.');
    }
  } catch {
    showAlertSujet('Erreur réseau.');
  }
}

function afficherQuestionDansApercuSujet(type, enonce, choix, points, ordre, id) {
  const labels = {
    qcm: 'QCM', qrm: 'QRM', vrai_faux: 'Vrai/Faux',
    completion: 'Complétion', calcul: 'Calcul',
    ouverte_courte: 'Ouverte courte', ouverte_longue: 'Ouverte longue',
    etude_de_cas: 'Étude de cas'
  };

  let choixHtml = '';
  choix.forEach(c => {
    choixHtml += `<div style="font-size:13px; color:${c.est_correcte ? 'green' : '#999'}">
      ${c.est_correcte ? '✅' : '○'} ${escapeHtml(c.texte)}
    </div>`;
  });

  const container = document.getElementById('listeQuestionsSujet');
  if (container.querySelector('p')) container.innerHTML = '';

  container.insertAdjacentHTML('beforeend', `
    <div class="border-start border-3 ps-3 mb-3" data-id="${id}" style="border-color:#0b132b !important;">
      <div class="d-flex justify-content-between align-items-start mb-1">
        <span class="fw-semibold">Q${ordre}. ${escapeHtml(enonce)}</span>
        <div class="d-flex gap-2 align-items-center">
          <span class="badge bg-light text-dark" style="font-size:11px;">${labels[type] || type}</span>
          <span class="badge bg-secondary">${points} pt${points > 1 ? 's' : ''}</span>
          <button class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:11px;" onclick="supprimerQuestionSujet(${id})">🗑️</button>
        </div>
      </div>
      ${choixHtml || '<small class="text-muted">Correction manuelle</small>'}
    </div>
  `);

  document.getElementById('compteurQuestionsSujet').textContent = ordreAutoSujet;
}

async function supprimerQuestionSujet(questionId) {
  if (!confirm("Supprimer définitivement cette question ?")) return;

  try {
    const res = await fetch(`${API}/questions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id: questionId })
    });
    const data = await res.json();

    if (res.ok) {
      showAlertSujet('Question supprimée ✅', 'success');
      await rafraichirListeQuestionsSujet();
    } else {
      showAlertSujet(data.message || 'Erreur lors de la suppression.');
    }
  } catch {
    showAlertSujet('Erreur réseau.');
  }
}

async function rafraichirListeQuestionsSujet() {
  if (!epreuveIdSujet) return;

  try {
    const res = await fetch(`${API}/questions?epreuve_id=${epreuveIdSujet}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const questions = await res.json();

    document.getElementById('listeQuestionsSujet').innerHTML = '';
    ordreAutoSujet = 1;

    questions.forEach(q => {
      let choix = [];
      try { choix = q.choix ? JSON.parse(q.choix).filter(c => c.id !== null) : []; } catch { choix = []; }
      afficherQuestionDansApercuSujet(q.type, q.enonce, choix, q.points, ordreAutoSujet, q.id);
      ordreAutoSujet++;
    });

    document.getElementById('ordre').value = ordreAutoSujet;
  } catch {
    showAlertSujet('Erreur lors du rechargement des questions.');
  }
}

// ===== Résultats =====
async function remplirSelectConcoursResultats() {
  const select = document.getElementById('selectConcoursResultats');
  try {
    const res = await fetch(`${API}/concours`, { headers: { 'Authorization': 'Bearer ' + token } });
    const concoursListe = await res.json();

    select.innerHTML = '<option value="">-- Choisir un concours --</option>';
    concoursListe.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${escapeHtml(c.titre)}</option>`;
    });
  } catch {
    select.innerHTML = '<option value="">Erreur de chargement</option>';
  }
}

async function chargerResultatsConcours() {
  const concoursId = document.getElementById('selectConcoursResultats').value;
  const zone = document.getElementById('accordeonResultats');
  const zonePub = document.getElementById('zonePublication');

  if (!concoursId) {
    zone.innerHTML = '<p class="text-muted text-center py-4">Sélectionnez un concours pour afficher les résultats.</p>';
    zonePub.style.display = 'none';
    return;
  }

  zone.innerHTML = '<p class="text-muted text-center py-4">Chargement...</p>';

  try {
    const res = await fetch(`${API}/resultats?par_candidat=${concoursId}`, { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();

    const candidats = data.candidats || [];

    afficherZonePublication(data.publie, concoursId);

    if (candidats.length === 0) {
      zone.innerHTML = '<p class="text-muted text-center py-4">Aucun résultat disponible pour ce concours.</p>';
      return;
    }

    zone.innerHTML = genererAccordeonResultats(candidats);
  } catch {
    zone.innerHTML = '<p class="text-danger text-center py-4">Erreur lors du chargement des résultats.</p>';
    zonePub.style.display = 'none';
  }
}

function afficherZonePublication(publie, concoursId) {
  const zonePub = document.getElementById('zonePublication');
  const badge = document.getElementById('badgePublication');
  const btn = document.getElementById('btnPublierResultats');

  zonePub.style.display = 'flex';

  if (publie) {
    badge.innerHTML = '✅ Résultats publiés — visibles par les candidats';
    badge.className = 'badge-publication badge-publication-ok';
    btn.style.display = 'none';
  } else {
    badge.innerHTML = '🔒 Résultats non publiés — invisibles pour les candidats';
    badge.className = 'badge-publication badge-publication-attente';
    btn.style.display = '';
    btn.dataset.concoursId = concoursId;
  }
}

async function publierResultats() {
  const btn = document.getElementById('btnPublierResultats');
  const concoursId = btn.dataset.concoursId;

  if (!confirm("Publier les résultats de ce concours ? Ils deviendront immédiatement visibles par tous les candidats concernés.")) return;

  try {
    const res = await fetch(`${API}/resultats`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'publier', concours_id: concoursId })
    });
    const data = await res.json();

    if (res.ok) {
      chargerResultatsConcours();
    } else {
      alert(data.message || "Erreur lors de la publication.");
    }
  } catch {
    alert('Erreur réseau.');
  }
}

function genererAccordeonResultats(candidats) {
  const badgeCouleur = { 'Admis': 'bg-success', 'Ajourné': 'bg-warning text-dark', 'Rejeté': 'bg-danger' };

  let html = '<div class="accordion" id="accordionResultatsWrapper">';

  candidats.forEach(candidat => {
    const couleur = badgeCouleur[candidat.mention] || 'bg-secondary';

    html += `
      <div class="accordion-item">
        <h2 class="accordion-header">
          <a href="detail_resultats.html?id=${candidat.candidature_id}" class="accordion-button collapsed text-decoration-none" style="cursor:pointer;">
            <span class="me-2">🥇 Rang ${candidat.rang}</span>
            <strong class="me-2">${escapeHtml(candidat.prenom)} ${escapeHtml(candidat.nom)}</strong>
            <span class="badge ${couleur} ms-2">${escapeHtml(candidat.mention)}</span>
            <span class="ms-auto me-3 fw-bold">${candidat.note_totale} / 20</span>
          </a>
        </h2>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

// ===== Affectations jury (examen des dossiers de candidature — par CONCOURS) =====

async function chargerConcoursAffectation() {
  const select = document.getElementById('selectConcoursAffectation');
  try {
    const res = await fetch(`${API}/concours`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    select.innerHTML = '<option value="">-- Choisir un concours --</option>';
    data.forEach(c => { select.innerHTML += `<option value="${c.id}">${escapeHtml(c.titre)}</option>`; });
  } catch {
    select.innerHTML = '<option value="">Erreur de chargement</option>';
  }

  document.getElementById('zoneAffectation').style.display = 'none';
  document.getElementById('zoneSelectEpreuveAffectation').style.display = 'none';
  document.getElementById('zoneAffectationEpreuve').style.display = 'none';
}

async function chargerJurysAffectesAffectation() {
  const concoursId = document.getElementById('selectConcoursAffectation').value;
  const zone = document.getElementById('zoneAffectation');

  if (!concoursId) {
    zone.style.display = 'none';
    document.getElementById('zoneSelectEpreuveAffectation').style.display = 'none';
    document.getElementById('zoneAffectationEpreuve').style.display = 'none';
    return;
  }
  zone.style.display = '';

  await Promise.all([
    afficherListeJurysAffectes(concoursId),
    remplirSelectJurysDisponibles(),
    chargerEpreuvesAffectationEpreuve(concoursId)
  ]);
}

async function afficherListeJurysAffectes(concoursId) {
  const container = document.getElementById('listeJurysAffectes');
  container.innerHTML = '<p class="text-muted text-center py-3">Chargement...</p>';

  try {
    const res = await fetch(`${API}/affectations?concours_id=${concoursId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      container.innerHTML = '<p class="text-muted text-center py-3">Aucun jury affecté à ce concours pour le moment.</p>';
      return;
    }

    container.innerHTML = data.map(a => `
      <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2">
        <div>
          <strong>${escapeHtml(a.jury_nom)}</strong>
          <span class="text-muted ms-2" style="font-size:12px;">${escapeHtml(a.jury_email)}</span>
        </div>
        <button class="btn btn-sm btn-outline-danger" onclick="retirerAffectation(${a.id})">Retirer</button>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<p class="text-danger text-center py-3">Erreur de chargement.</p>';
  }
}

async function remplirSelectJurysDisponibles() {
  const select = document.getElementById('selectJuryAffectation');
  try {
    const res = await fetch(`${API}/auth?role=jury`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      select.innerHTML = '<option value="">Aucun compte jury créé</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Choisir un jury --</option>';
    data.forEach(j => { select.innerHTML += `<option value="${j.id}">${escapeHtml(j.nom)} (${escapeHtml(j.email)})</option>`; });
  } catch {
    select.innerHTML = '<option value="">Erreur de chargement</option>';
  }
}

async function affecterJury() {
  const concours_id = document.getElementById('selectConcoursAffectation').value;
  const jury_id = document.getElementById('selectJuryAffectation').value;

  if (!jury_id) {
    document.getElementById('alertAffectation').innerHTML = '<div class="alert alert-warning">Choisis un jury.</div>';
    return;
  }

  try {
    const res = await fetch(`${API}/affectations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ jury_id, concours_id })
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('alertAffectation').innerHTML = '<div class="alert alert-success">Jury affecté ✅</div>';
      afficherListeJurysAffectes(concours_id);
    } else {
      document.getElementById('alertAffectation').innerHTML = `<div class="alert alert-danger">${escapeHtml(data.message)}</div>`;
    }
  } catch {
    document.getElementById('alertAffectation').innerHTML = '<div class="alert alert-danger">Erreur réseau.</div>';
  }
}

async function retirerAffectation(id) {
  if (!confirm("Retirer ce jury de l'examen des dossiers de ce concours ?")) return;

  const concoursId = document.getElementById('selectConcoursAffectation').value;

  try {
    const res = await fetch(`${API}/affectations`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id })
    });

    if (res.ok) {
      afficherListeJurysAffectes(concoursId);
    } else {
      alert("Erreur lors du retrait de l'affectation");
    }
  } catch {
    alert('Erreur réseau');
  }
}

// ==========================================================================
// Affectations jury (correction des copies — par ÉPREUVE)
// ==========================================================================

async function chargerEpreuvesAffectationEpreuve(concoursId) {
  const zoneSelect = document.getElementById('zoneSelectEpreuveAffectation');
  const selectEpreuve = document.getElementById('selectEpreuveAffectation');

  document.getElementById('zoneAffectationEpreuve').style.display = 'none';
  selectEpreuve.value = '';

  if (!concoursId) {
    zoneSelect.style.display = 'none';
    return;
  }

  try {
    const res = await fetch(`${API}/epreuves?concours_id=${concoursId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      selectEpreuve.innerHTML = '<option value="">Aucune épreuve pour ce concours</option>';
    } else {
      selectEpreuve.innerHTML = '<option value="">-- Choisir une épreuve --</option>';
      data.forEach(e => { selectEpreuve.innerHTML += `<option value="${e.id}">${escapeHtml(e.titre)}</option>`; });
    }
    zoneSelect.style.display = '';
  } catch {
    selectEpreuve.innerHTML = '<option value="">Erreur de chargement</option>';
    zoneSelect.style.display = '';
  }
}

async function chargerJurysAffectesAffectationEpreuve() {
  const epreuveId = document.getElementById('selectEpreuveAffectation').value;
  const zone = document.getElementById('zoneAffectationEpreuve');

  if (!epreuveId) {
    zone.style.display = 'none';
    return;
  }
  zone.style.display = '';

  await Promise.all([
    afficherListeJurysAffectesEpreuve(epreuveId),
    remplirSelectJurysDisponiblesEpreuve()
  ]);
}

async function afficherListeJurysAffectesEpreuve(epreuveId) {
  const container = document.getElementById('listeJurysAffectesEpreuve');
  container.innerHTML = '<p class="text-muted text-center py-3">Chargement...</p>';

  try {
    const res = await fetch(`${API}/affectations_epreuve?epreuve_id=${epreuveId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      container.innerHTML = '<p class="text-muted text-center py-3">Aucun jury affecté à cette épreuve pour le moment.</p>';
      return;
    }

    container.innerHTML = data.map(a => `
      <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2">
        <div>
          <strong>${escapeHtml(a.jury_nom)}</strong>
          <span class="text-muted ms-2" style="font-size:12px;">${escapeHtml(a.jury_email)}</span>
        </div>
        <button class="btn btn-sm btn-outline-danger" onclick="retirerAffectationEpreuve(${a.id})">Retirer</button>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<p class="text-danger text-center py-3">Erreur de chargement.</p>';
  }
}

async function remplirSelectJurysDisponiblesEpreuve() {
  const select = document.getElementById('selectJuryAffectationEpreuve');
  try {
    const res = await fetch(`${API}/auth?role=jury`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      select.innerHTML = '<option value="">Aucun compte jury créé</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Choisir un jury --</option>';
    data.forEach(j => { select.innerHTML += `<option value="${j.id}">${escapeHtml(j.nom)} (${escapeHtml(j.email)})</option>`; });
  } catch {
    select.innerHTML = '<option value="">Erreur de chargement</option>';
  }
}

async function affecterJuryEpreuve() {
  const epreuve_id = document.getElementById('selectEpreuveAffectation').value;
  const jury_id = document.getElementById('selectJuryAffectationEpreuve').value;

  if (!jury_id) {
    document.getElementById('alertAffectationEpreuve').innerHTML = '<div class="alert alert-warning">Choisis un jury.</div>';
    return;
  }

  try {
    const res = await fetch(`${API}/affectations_epreuve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ jury_id, epreuve_id })
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('alertAffectationEpreuve').innerHTML = '<div class="alert alert-success">Jury affecté ✅</div>';
      afficherListeJurysAffectesEpreuve(epreuve_id);
    } else {
      document.getElementById('alertAffectationEpreuve').innerHTML = `<div class="alert alert-danger">${escapeHtml(data.message)}</div>`;
    }
  } catch {
    document.getElementById('alertAffectationEpreuve').innerHTML = '<div class="alert alert-danger">Erreur réseau.</div>';
  }
}

async function retirerAffectationEpreuve(id) {
  if (!confirm("Retirer ce jury de la correction de cette épreuve ?")) return;

  const epreuveId = document.getElementById('selectEpreuveAffectation').value;

  try {
    const res = await fetch(`${API}/affectations_epreuve`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id })
    });

    if (res.ok) {
      afficherListeJurysAffectesEpreuve(epreuveId);
    } else {
      alert("Erreur lors du retrait de l'affectation");
    }
  } catch {
    alert('Erreur réseau');
  }
}

// ==========================================================================
// ⚠️ NOUVEAU — Notifications
// ==========================================================================

// Affiche ou masque le sélecteur de candidat selon le mode choisi (globale / ciblée)
function toggleDestinataireNotif() {
  const mode = document.getElementById('typeDestinataireNotif').value;
  document.getElementById('zoneCandidatNotif').style.display = mode === 'ciblee' ? '' : 'none';
}

// Charge la liste des candidats pour le sélecteur "notification ciblée"
// Réutilise la même route /auth?role=... déjà utilisée pour les jurys
async function chargerCandidatsNotif() {
  const select = document.getElementById('selectCandidatNotif');
  try {
    const res = await fetch(`${API}/auth?role=candidat`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (!data.length) {
      select.innerHTML = '<option value="">Aucun candidat trouvé</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Choisir un candidat --</option>';
    data.forEach(c => { select.innerHTML += `<option value="${c.id}">${escapeHtml(c.nom)} ${escapeHtml(c.prenom || '')} (${escapeHtml(c.email)})</option>`; });
  } catch {
    select.innerHTML = '<option value="">Erreur de chargement</option>';
  }
}

// Envoie la notification créée par l'admin (globale ou ciblée)
async function envoyerNotification() {
  const modeDestinataire = document.getElementById('typeDestinataireNotif').value;
  const idCandidat = document.getElementById('selectCandidatNotif').value;
  const titre = document.getElementById('titreNotif').value.trim();
  const message = document.getElementById('messageNotif').value.trim();
  const type = document.getElementById('typeNotif').value;
  const lien = document.getElementById('lienNotif').value.trim();

  if (!titre || !message) {
    document.getElementById('alertNotif').innerHTML =
      '<div class="alert alert-warning">Le titre et le message sont obligatoires.</div>';
    return;
  }

  if (modeDestinataire === 'ciblee' && !idCandidat) {
    document.getElementById('alertNotif').innerHTML =
      '<div class="alert alert-warning">Choisis un candidat, ou passe en notification globale.</div>';
    return;
  }

  try {
    const res = await fetch(`${API}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        id_destinataire: modeDestinataire === 'ciblee' ? idCandidat : null,
        titre,
        message,
        type,
        lien: lien || null
      })
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('alertNotif').innerHTML =
        '<div class="alert alert-success">✅ Notification envoyée !</div>';
      ['titreNotif', 'messageNotif', 'lienNotif'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('selectCandidatNotif').value = '';
    } else {
      document.getElementById('alertNotif').innerHTML =
        `<div class="alert alert-danger">${escapeHtml(data.message)}</div>`;
    }
  } catch {
    document.getElementById('alertNotif').innerHTML =
      '<div class="alert alert-danger">Erreur réseau.</div>';
  }
}

// ===== Démarrage =====
chargerStats();