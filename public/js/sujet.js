// ===============================
// sujet.js — Aperçu du sujet complet d'une épreuve (vue admin)
// ===============================
// Ce fichier affiche toutes les questions d'une épreuve avec leurs bonnes réponses
// C'est une vue de RELECTURE pour l'admin, avant validation d'une épreuve -> pas de modification possible ici

const API = '/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Garde d'accès : seul un admin connecté peut voir le sujet complet (avec les bonnes réponses affichées)
if (!token || user.role !== 'admin') {
  window.location.href = 'login.html';
}

// Récupère l'ID de l'épreuve à afficher depuis l'URL (ex: sujet.html?id=5)
const params = new URLSearchParams(window.location.search);
const epreuveId = params.get('id');

if (!epreuveId) {
  document.getElementById('listeQuestions').innerHTML =
    '<p class="text-danger">ID épreuve manquant dans l\'URL.</p>';
} else {
  chargerSujet();
}

function showAlert(msg, type = 'danger') {
  document.getElementById('alertMsg').innerHTML =
    `<div class="alert alert-${type} alert-dismissible">${msg}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
}

// ===== Chargement et affichage de toutes les questions du sujet =====
async function chargerSujet() {
  const res = await fetch(`${API}/questions?epreuve_id=${epreuveId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const questions = await res.json();

  // Correspondance entre le code technique du type de question et son libellé affiché
  const labels = {
    qcm: 'QCM', qrm: 'QRM', vrai_faux: 'Vrai/Faux',
    completion: 'Complétion', calcul: 'Calcul',
    ouverte_courte: 'Ouverte courte', ouverte_longue: 'Ouverte longue',
    etude_de_cas: 'Étude de cas'
  };

  const container = document.getElementById('listeQuestions');

  if (!questions.length) {
    container.innerHTML = '<p class="text-muted text-center">Aucune question trouvée.</p>';
    return;
  }

  container.innerHTML = questions.map((q, i) => {
    // On ne garde que les choix qui ont un texte rempli (évite d'afficher des lignes vides)
    const choix = JSON.parse(q.choix || '[]').filter(c => c.texte);

    // La bonne réponse est affichée en vert avec un ✅, les autres en gris avec un ○
    const choixHtml = choix.map(c => `
      <div style="color: ${c.est_correcte ? 'green' : '#666'}; margin-bottom: 4px;">
        ${c.est_correcte ? '✅' : '○'} ${c.texte}
      </div>
    `).join('');

    return `
      <div class="question-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <span class="fw-semibold">Q${i+1}. ${q.enonce}</span>
          <div class="d-flex gap-2">
            <span class="badge-type">${labels[q.type] || q.type}</span>
            <span class="badge bg-secondary">${q.points} pt(s)</span>
          </div>
        </div>
        ${choixHtml || '<small class="text-muted">Correction manuelle par le jury</small>'}
      </div>
    `;
  }).join('');
}