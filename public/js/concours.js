const API = '/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Pour éviter le bug qui empêchait l'upload des documents de fonctionner
let candidatureActuelle = null;

// ⚠️ NOUVEAU — mémorise l'ID de l'intervalle de polling des notifications,
// pour pouvoir l'arrêter proprement si jamais on en a besoin (ex: déconnexion)
let intervalNotifications = null;

// Chantier 4 : mémorise la liste complète pour filtrer par catégorie sans re-fetch
let concoursCache = [];

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
    concoursCache = await res.json(); // Chantier 5 : on garde la liste complète en mémoire pour le filtre
    document.getElementById('loading').style.display = 'none';

    afficherConcours(concoursCache);
  } catch {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('listeConcours').innerHTML = '<p class="text-danger">Erreur de chargement des concours.</p>';
  }
}

// Chantier 5 : affiche une liste (filtrée ou non) de concours — séparé de chargerConcours()
// pour pouvoir être rappelé par le filtre catégorie sans refaire une requête réseau
function afficherConcours(concours) {
  if (!concours.length) {
    document.getElementById('listeConcours').innerHTML = '<p class="text-muted">Aucun concours disponible pour le moment.</p>';
    return;
  }

  const html = concours.map(c => {
    // Bug fix : un concours dont la date de fin est dépassée n'est plus postulable,
    // même si l'admin a oublié de changer son statut manuellement en "fermé"
    const estExpire = new Date(c.date_fin) < new Date();
    const estOuvert = c.statut === 'ouvert' && !estExpire;

    // Chantier 5 : conditions d'éligibilité, affichées uniquement si au moins une est renseignée
    const conditions = [];
    if (c.diplome_requis) conditions.push(`🎓 ${escapeHtml(c.diplome_requis)}`);
    if (c.age_min || c.age_max) {
      if (c.age_min && c.age_max) conditions.push(`🎂 ${c.age_min}-${c.age_max} ans`);
      else if (c.age_min) conditions.push(`🎂 ${c.age_min} ans minimum`);
      else conditions.push(`🎂 ${c.age_max} ans maximum`);
    }
    if (c.conditions_autres) conditions.push(escapeHtml(c.conditions_autres));

    return `
      <div class="col-md-6">
        <div class="concours-card card p-3" style="cursor:pointer;" onclick="voirDetailsConcours(${c.id})">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="fw-bold mb-0" style="color:#1a3a6b;">${escapeHtml(c.titre)}</h6>
            <span class="badge ${estOuvert ? 'badge-ouvert' : 'badge-ferme'} px-2 py-1 rounded-pill" style="font-size:11px;">
              ${estOuvert ? '✅ Ouvert' : estExpire ? '⏱️ Clôturé' : '❌ Fermé'}
            </span>
          </div>
          ${c.categorie ? `<span class="badge bg-light text-dark mb-2" style="font-size:11px;">🏷️ ${escapeHtml(c.categorie)}</span>` : ''}
          <p class="text-muted mb-2" style="font-size:13px;">${escapeHtml(c.description) || 'Aucune description.'}</p>
          ${conditions.length ? `<p class="mb-2" style="font-size:12px;color:#555;">${conditions.join(' • ')}</p>` : ''}
          ${c.frais_montant ? `<p class="mb-2" style="font-size:12px;color:#8a5a00;">💰 Frais : ${c.frais_montant} Ar${c.frais_description ? ` — ${escapeHtml(c.frais_description)}` : ''}</p>` : ''}
          <div class="d-flex justify-content-between align-items-center">
            <small class="text-muted">
              📅 ${new Date(c.date_debut).toLocaleDateString('fr-FR')} → ${new Date(c.date_fin).toLocaleDateString('fr-FR')}
            </small>
            <button class="btn-postuler"
              id="btn-${c.id}"
              ${!estOuvert ? 'disabled' : ''}
              onclick="event.stopPropagation(); postuler(${c.id})">
              ${estExpire ? 'Concours clôturé' : estOuvert ? 'Postuler' : 'Fermé'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('listeConcours').innerHTML = html;
}

// === NOUVEAU : ouvre le détail complet d'un concours — description, conditions, frais
// et surtout la liste des épreuves (date, heure, coefficient) avant même de postuler ===
async function voirDetailsConcours(concoursId) {
  const c = concoursCache.find(x => x.id == concoursId);
  if (!c) return;

  document.getElementById('detailsConcoursTitre').textContent = c.titre;
  document.getElementById('modalDetailsConcours').style.display = 'flex';

  const conditions = [];
  if (c.diplome_requis) conditions.push(`🎓 Diplôme requis : ${escapeHtml(c.diplome_requis)}`);
  if (c.age_min || c.age_max) {
    if (c.age_min && c.age_max) conditions.push(`🎂 Âge : ${c.age_min} à ${c.age_max} ans`);
    else if (c.age_min) conditions.push(`🎂 Âge minimum : ${c.age_min} ans`);
    else conditions.push(`🎂 Âge maximum : ${c.age_max} ans`);
  }
  if (c.conditions_autres) conditions.push(escapeHtml(c.conditions_autres));

  let html = `<p style="font-size:14px;">${escapeHtml(c.description) || 'Aucune description.'}</p>`;

  if (conditions.length) {
    html += `<p class="fw-semibold mb-1" style="font-size:13px;">📋 Conditions d'éligibilité</p>
      <ul style="font-size:13px;">${conditions.map(cond => `<li>${cond}</li>`).join('')}</ul>`;
  }

  if (c.frais_montant) {
    html += `<p style="font-size:13px;color:#8a5a00;">💰 <strong>${c.frais_montant} Ar</strong>${c.frais_description ? ` — ${escapeHtml(c.frais_description)}` : ''}</p>`;
  }

  html += `<hr><p class="fw-semibold mb-2" style="font-size:13px;">📝 Programme des épreuves</p>
    <div id="listeEpreuvesDetailsConcours"><p class="text-muted" style="font-size:13px;">Chargement des épreuves...</p></div>`;

  document.getElementById('detailsConcoursContenu').innerHTML = html;

  // Les épreuves sont chargées séparément : un concours peut ne pas encore en avoir
  try {
    const res = await fetch(`${API}/epreuves?concours_id=${concoursId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const epreuves = await res.json();

    const zoneEpreuves = document.getElementById('listeEpreuvesDetailsConcours');
    if (!zoneEpreuves) return; // la modale a pu être fermée entre-temps

    if (!Array.isArray(epreuves) || !epreuves.length) {
      zoneEpreuves.innerHTML = '<p class="text-muted" style="font-size:13px;">Le programme des épreuves sera communiqué ultérieurement.</p>';
      return;
    }

    zoneEpreuves.innerHTML = epreuves.map(e => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2" style="font-size:13px;">
        <div>
          <strong>${escapeHtml(e.titre)}</strong>
          <div class="text-muted" style="font-size:12px;">${escapeHtml(e.type)} • ${e.duree} min</div>
        </div>
        <div class="text-end">
          <div>📅 ${new Date(e.date_epreuve).toLocaleString('fr-FR')}</div>
          <div class="text-muted" style="font-size:12px;">Coefficient ${e.coefficient ?? 1}</div>
        </div>
      </div>
    `).join('');
  } catch {
    const zoneEpreuves = document.getElementById('listeEpreuvesDetailsConcours');
    if (zoneEpreuves) zoneEpreuves.innerHTML = '<p class="text-danger" style="font-size:13px;">Erreur de chargement du programme.</p>';
  }
}

function fermerModalDetailsConcours() {
  document.getElementById('modalDetailsConcours').style.display = 'none';
}

// Chantier 5 : filtre côté client (pas de nouvelle requête, on utilise le cache)
function filtrerConcoursParCategorie() {
  const categorie = document.getElementById('filtreCategorie').value;
  const filtres = categorie ? concoursCache.filter(c => c.categorie === categorie) : concoursCache;
  afficherConcours(filtres);
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

    const html = candidatures.map(c => {
      // Chantier 5 : badge historique — un concours dont la date de fin est dépassée est "archivé"
      const estArchive = new Date(c.date_fin) < new Date();

      return `
      <div class="candidature-item d-flex justify-content-between align-items-center">
        <div>
          <strong style="font-size:14px;">${escapeHtml(c.titre)}</strong>
          ${estArchive ? '<span class="badge bg-secondary ms-2" style="font-size:10px;">📁 Archivé</span>' : ''}
          <div class="text-muted" style="font-size:12px;">
            Du ${new Date(c.date_debut).toLocaleDateString('fr-FR')} au ${new Date(c.date_fin).toLocaleDateString('fr-FR')}
          </div>
          ${c.frais_montant ? `<div style="font-size:12px;color:#8a5a00;">💰 Frais : ${c.frais_montant} Ar — ${c.paiement_effectue == 1 ? '✅ Payé' : '⏳ En attente de paiement'}</div>` : ''}
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
    `;
    }).join('');

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