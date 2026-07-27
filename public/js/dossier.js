const API = '/concours_fp/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

if (!token || user.role !== 'admin') {
  window.location.href = 'login.html';
  throw new Error('Accès non autorisé - arrêt du script dossier.js');
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

const labels = {
  cin: '🪪 CIN',
  photo: '📷 Photo',
  cv: '📄 CV',
  diplome: '🎓 Diplôme',
  acte: '📜 Acte de naissance'
};

if (!candidatureId) {
  document.getElementById('listeDocuments').innerHTML = '<p class="text-danger">ID candidature manquant ou invalide.</p>';
  // On désactive les boutons Valider/Rejeter tant qu'on n'a pas d'id exploitable
  document.querySelectorAll('.btn-valider-dossier, .btn-rejeter-dossier')
    .forEach(btn => btn.disabled = true);
} else {
  document.getElementById('titreCandidat').textContent = `👤 ${nomCandidat || 'Candidat'}`;
  document.getElementById('infoCandidature').textContent = `Candidature #${candidatureId}`;
  chargerDocuments();
}

function showAlert(msg, type = 'danger') {
  document.getElementById('alertMsg').innerHTML =
    `<div class="alert alert-${type} alert-dismissible">${msg}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
}

async function chargerDocuments() {
  const container = document.getElementById('listeDocuments');
  container.innerHTML = '<p class="text-muted text-center">Chargement...</p>';

  try {
    const res = await fetch(`${API}/documents?candidature_id=${candidatureId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const docs = await res.json();

    if (!docs.length) {
      container.innerHTML = '<p class="text-muted text-center">Aucun document soumis.</p>';
      return;
    }

    container.innerHTML = docs.map(d => `
      <div class="doc-item d-flex justify-content-between align-items-center">
        <div>
          <div class="fw-semibold">${escapeHtml(labels[d.type] || d.type)}</div>
          <div class="text-muted" style="font-size:13px;">${escapeHtml(d.nom_fichier)}</div>
        </div>
        <a href="/concours_fp/${encodeURI(d.chemin)}" target="_blank" class="btn btn-outline-primary btn-sm">
          👁️ Ouvrir
        </a>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<p class="text-danger text-center">Erreur de chargement des documents.</p>';
  }
}

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
        statut === 'validé' ? '✅ Candidature validée ! Retour...' : '❌ Candidature rejetée. Retour...',
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