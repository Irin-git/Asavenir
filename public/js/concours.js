const API = '/concours_fp/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Pour éviter le bug qui empêchait l'upload des documents de fonctionner
let candidatureActuelle = null;

// Sécurité : redirige si non connecté
if (!token) {
  window.location.href = 'login.html';
  throw new Error('Non connecté - arrêt du script concours.js');
}

document.getElementById('nomUser').textContent = `👤 ${user.nom || ''}`;

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

// ===== Charger les concours =====
async function chargerConcours() {
  try {
    const res = await fetch(`${API}/concours`, { headers: { 'Authorization': `Bearer ${token}` } });
    const concours = await res.json();
    document.getElementById('loading').style.display = 'none';

    if (!concours.length) {
      document.getElementById('listeConcours').innerHTML = '<p class="text-muted">Aucun concours disponible pour le moment.</p>';
      return;
    }

    const html = concours.map(c => `
      <div class="col-md-6">
        <div class="concours-card card p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="fw-bold mb-0" style="color:#1a3a6b;">${escapeHtml(c.titre)}</h6>
            <span class="badge ${c.statut === 'ouvert' ? 'badge-ouvert' : 'badge-ferme'} px-2 py-1 rounded-pill" style="font-size:11px;">
              ${c.statut === 'ouvert' ? '✅ Ouvert' : '❌ Fermé'}
            </span>
          </div>
          <p class="text-muted mb-2" style="font-size:13px;">${escapeHtml(c.description) || 'Aucune description.'}</p>
          <div class="d-flex justify-content-between align-items-center">
            <small class="text-muted">
              📅 ${new Date(c.date_debut).toLocaleDateString('fr-FR')} → ${new Date(c.date_fin).toLocaleDateString('fr-FR')}
            </small>
            <button class="btn-postuler"
              id="btn-${c.id}"
              ${c.statut !== 'ouvert' ? 'disabled' : ''}
              onclick="postuler(${c.id})">
              Postuler
            </button>
          </div>
        </div>
      </div>
    `).join('');

    document.getElementById('listeConcours').innerHTML = html;
  } catch {
    document.getElementById('loading').textContent = 'Erreur de chargement.';
  }
}

// ===== Postuler à un concours =====
async function postuler(concoursId) {
  const btn = document.getElementById(`btn-${concoursId}`);
  btn.disabled = true;
  btn.textContent = 'Envoi...';

  try {
    const res = await fetch(`${API}/candidatures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ concours_id: concoursId })
    });
    const data = await res.json();

    if (res.ok) {
      btn.textContent = '✅ Envoyée';
      btn.style.background = '#059669';
      chargerCandidatures();
      ouvrirModalDocuments(data.candidature_id);
    } else if (res.status === 409) {
      btn.textContent = 'Déjà postulé';
      btn.style.background = '#6b7280';
    } else {
      btn.disabled = false;
      btn.textContent = 'Postuler';
      alert(data.message || 'Erreur');
    }
  } catch {
    btn.disabled = false;
    btn.textContent = 'Postuler';
    alert('Erreur réseau.');
  }
}

// ===== Charger mes candidatures =====
async function chargerCandidatures() {
  try {
    const res = await fetch(`${API}/candidatures`, { headers: { 'Authorization': `Bearer ${token}` } });
    const candidatures = await res.json();

    if (!candidatures.length) {
      document.getElementById('listeCandidatures').innerHTML =
        '<p class="text-muted" style="font-size:14px;">Vous n\'avez pas encore postulé à un concours.</p>';
      return;
    }

    const html = candidatures.map(c => `
      <div class="candidature-item d-flex justify-content-between align-items-center">
        <div>
          <strong style="font-size:14px;">${escapeHtml(c.titre)}</strong>
          <div class="text-muted" style="font-size:12px;">
            Du ${new Date(c.date_debut).toLocaleDateString('fr-FR')} au ${new Date(c.date_fin).toLocaleDateString('fr-FR')}
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="status-badge status-${c.statut}">
            ${c.statut === 'en_attente' ? '⏳ En attente' : c.statut === 'validé' ? '✅ Validé' : '❌ Refusé'}
          </span>
          <button class="btn btn-sm btn-outline-primary" onclick="ouvrirModalDocuments(${c.id})">
            📎 Compléter mon dossier
          </button>
        </div>
      </div>
    `).join('');

    document.getElementById('listeCandidatures').innerHTML = html;
  } catch {
    document.getElementById('listeCandidatures').innerHTML =
      '<p class="text-danger" style="font-size:14px;">Erreur de chargement.</p>';
  }
}

function ouvrirModalDocuments(candidatureId) {
  candidatureActuelle = candidatureId;
  document.getElementById('modalDocuments').style.display = 'flex';
  document.getElementById('msgDocuments').textContent = '';
}

function fermerModalDocuments() {
  document.getElementById('modalDocuments').style.display = 'none';
  candidatureActuelle = null;
}

async function envoyerDocuments() {
  // Garde-fou : sans candidature active, l'envoi n'a pas de sens
  if (!candidatureActuelle) {
    alert('Aucune candidature sélectionnée.');
    return;
  }

  const formData = new FormData();
  formData.append('candidature_id', candidatureActuelle);

  const champs = ['cin', 'photo', 'cv', 'diplome', 'acte'];
  let tousRemplis = true;

  for (const champ of champs) {
    const input = document.getElementById(`doc_${champ}`);
    if (!input.files[0]) {
      alert(`⚠️ Veuillez choisir un fichier pour : ${champ}`);
      tousRemplis = false;
      break;
    }
    formData.append(champ, input.files[0]);
  }

  if (!tousRemplis) return;

  const msg = document.getElementById('msgDocuments');
  msg.textContent = 'Envoi en cours...';
  msg.style.color = '#6b7280';

  try {
    const res = await fetch(`${API}/documents`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();

    if (res.ok) {
      msg.textContent = '✅ ' + data.message;
      msg.style.color = '#059669';
      setTimeout(fermerModalDocuments, 1500);
    } else {
      msg.textContent = '❌ ' + (data.erreurs ? data.erreurs.join(', ') : data.message);
      msg.style.color = '#dc2626';
    }
  } catch {
    msg.textContent = '❌ Erreur réseau.';
    msg.style.color = '#dc2626';
  }
}

chargerConcours();
chargerCandidatures();