const API = '/concours_fp/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Cette page est partagée par deux rôles :
// - admin : consulte le dossier ET prend la décision finale (Valider/Rejeter)
// - jury  : consulte le dossier uniquement, pour se forger un avis (les boutons de décision sont masqués plus bas)
if (!token || !['admin', 'jury'].includes(user.role)) {
  window.location.href = 'login.html';
  throw new Error('Accès non autorisé - arrêt du script dossier.js');
}

// Seul l'admin voit la zone Valider/Rejeter — affichage explicite plutôt que masquage conditionnel
if (user.role === 'admin') {
  const zoneDecision = document.getElementById('zoneDecisionAdmin');
  if (zoneDecision) zoneDecision.style.display = 'flex';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const params = new URLSearchParams(window.location.search);
const candidatureIdRaw = params.get('id');
const nomCandidat = params.get('nom');

// On s'assure que l'id est bien un nombre avant de s'en servir dans les
// appels API (sinon un id du style "1 OR 1=1" partirait tel quel vers le serveur)
const candidatureId = candidatureIdRaw && /^\d+$/.test(candidatureIdRaw) ? candidatureIdRaw : null;

// ===== Petite bibliothèque d'icônes SVG inline (aucun emoji dans l'interface) =====
const svgIcons = {
  cin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="14" y1="10" x2="19" y2="10"/><line x1="14" y1="14" x2="19" y2="14"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-4 4-3-3-6 6"/></svg>',
  cv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
  diplome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
  acte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/></svg>',
  defaut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

const labels = {
  cin: 'Carte d\'identité nationale',
  photo: 'Photo d\'identité',
  cv: 'Curriculum vitae',
  diplome: 'Diplôme',
  acte: 'Acte de naissance'
};

if (!candidatureId) {
  document.getElementById('listeDocuments').innerHTML = '<p class="text-danger">ID candidature manquant ou invalide.</p>';
  // On désactive les boutons Valider/Rejeter tant qu'on n'a pas d'id exploitable
  document.querySelectorAll('.btn-valider-dossier, .btn-rejeter-dossier')
    .forEach(btn => btn.disabled = true);
} else {
  document.getElementById('titreCandidat').textContent = nomCandidat || 'Candidat';
  document.getElementById('infoCandidature').textContent = `Candidature #${candidatureId} — pièces à vérifier avant décision.`;
  chargerDocuments();
}

function showAlert(msg, type = 'danger') {
  const map = { danger: 'alert-danger-d', success: 'alert-success-d', warning: 'alert-warning-d' };
  const icon = type === 'success' ? svgIcons.check : (type === 'warning' ? svgIcons.cross : svgIcons.cross);
  document.getElementById('alertMsg').innerHTML =
    `<div class="alert-dossier ${map[type] || 'alert-danger-d'}"><span style="width:16px;height:16px;">${icon}</span>${msg}</div>`;
}

async function chargerDocuments() {
  const container = document.getElementById('listeDocuments');
  container.innerHTML = '<p class="text-muted-center">Chargement...</p>';

  try {
    const res = await fetch(`${API}/documents?candidature_id=${candidatureId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const docs = await res.json();

    if (!docs.length) {
      container.innerHTML = '<p class="text-muted-center">Aucun document soumis.</p>';
      return;
    }

    container.innerHTML = docs.map(d => `
      <div class="doc-item">
        <div class="doc-left">
          <span class="doc-icon">${svgIcons[d.type] || svgIcons.defaut}</span>
          <div>
            <div class="doc-name">${escapeHtml(labels[d.type] || d.type)}</div>
            <div class="doc-filename">${escapeHtml(d.nom_fichier)}</div>
          </div>
        </div>
        <a href="/concours_fp/${encodeURI(d.chemin)}" target="_blank" class="btn-doc-open">
          ${svgIcons.eye} Ouvrir
        </a>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<p class="text-danger text-center">Erreur de chargement des documents.</p>';
  }
}

// Réservé à l'admin : le bouton correspondant est masqué pour le jury, donc cette fonction
// n'est jamais appelable depuis l'interface jury (elle reste aussi protégée côté serveur, voir candidatures.php)
async function valider(statut) {
  // On ne laisse jamais partir un appel avec un id absent
  if (!candidatureId) {
    showAlert('Impossible : identifiant de candidature manquant.');
    return;
  }

  try {
    const res = await fetch(`${API}/candidatures`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id: candidatureId, statut })
    });
    const data = await res.json();

    if (res.ok) {
      showAlert(
        statut === 'validé' ? 'Candidature validée. Fermeture...' : 'Candidature rejetée. Fermeture...',
        statut === 'validé' ? 'success' : 'warning'
      );
      setTimeout(() => window.close(), 2000);
    } else {
      showAlert(escapeHtml(data.message) || 'Erreur.');
    }
  } catch {
    showAlert('Erreur réseau.');
  }
}