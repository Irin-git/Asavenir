const API = '/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Pour éviter le bug qui empêchait l'upload des documents de fonctionner
let candidatureActuelle = null;

// ⚠️ NOUVEAU — mémorise l'ID de l'intervalle de polling des notifications,
// pour pouvoir l'arrêter proprement si jamais on en a besoin (ex: déconnexion)
let intervalNotifications = null;

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
  if (intervalNotifications) clearInterval(intervalNotifications);
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

// ⚠️ NOUVEAU — révèle le bouton "Mes résultats" dans la navbar uniquement si
// au moins un concours a un résultat publié ET disponible pour ce candidat.
async function verifierResultatsDisponibles() {
  try {
    const res = await fetch(`${API}/resultats?mes_resultats=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok || !Array.isArray(data)) return;

    const auMoinsUnDisponible = data.some(item => item.resultat_disponible);
    if (auMoinsUnDisponible) {
      document.getElementById('btnMesResultats').style.display = '';
    }
  } catch {
    // Si l'appel échoue, on laisse simplement le bouton caché — pas bloquant
  }
}

// ==========================================================================
// ⚠️ NOUVEAU — Notifications (cloche + panneau + polling)
// ==========================================================================

// Ouvre/ferme le panneau déroulant. Rafraîchit la liste à chaque ouverture,
// pour être sûr d'avoir les toutes dernières notifications sans attendre le polling.
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const estOuvert = panel.classList.toggle('open');
  if (estOuvert) chargerNotifications();
}

// Va chercher les notifications côté serveur (route validée à l'étape 2) et met
// à jour à la fois le badge de compteur et le contenu du panneau.
async function chargerNotifications() {
  try {
    const res = await fetch(`${API}/notifications`, { headers: { 'Authorization': `Bearer ${token}` } });
    const notifications = await res.json();

    if (!res.ok || !Array.isArray(notifications)) return;

    afficherBadgeNotif(notifications);
    afficherListeNotif(notifications);
  } catch {
    // Silencieux : le polling réessaiera automatiquement au prochain passage
  }
}

function afficherBadgeNotif(notifications) {
  const badge = document.getElementById('notifBadge');
  const nonLues = notifications.filter(n => n.lu == 0).length;

  if (nonLues > 0) {
    badge.textContent = nonLues > 9 ? '9+' : nonLues;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function afficherListeNotif(notifications) {
  const container = document.getElementById('notifListe');

  if (!notifications.length) {
    container.innerHTML = '<p class="notif-empty">Aucune notification pour le moment.</p>';
    return;
  }

  container.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.lu == 0 ? 'non-lue' : ''} notif-type-${escapeHtml(n.type)}"
         onclick="clicNotif(${n.id}, ${n.lien ? `'${escapeHtml(n.lien)}'` : 'null'})">
      <div class="notif-item-titre">
        <span class="notif-dot"></span>
        ${escapeHtml(n.titre)}
      </div>
      <div class="notif-item-message">${escapeHtml(n.message)}</div>
      <div class="notif-item-date">${new Date(n.created_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>
    </div>
  `).join('');
}

// Marque la notification comme lue, puis redirige vers son lien si elle en a un
async function clicNotif(id, lien) {
  try {
    await fetch(`${API}/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id })
    });
  } catch {
    // Même si la mise à jour échoue, on laisse le candidat suivre le lien
  }

  chargerNotifications();
  if (lien) window.location.href = lien;
}

// Démarre le polling : vérifie les nouvelles notifications toutes les 25 secondes
function demarrerPollingNotifications() {
  chargerNotifications();
  intervalNotifications = setInterval(chargerNotifications, 25000);
}

chargerConcours();
chargerCandidatures();
verifierResultatsDisponibles();
demarrerPollingNotifications();