const API = '/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

if (!token) {
  window.location.href = 'login.html';
  throw new Error('Non connecté - arrêt du script mes_resultats.js');
}

document.getElementById('nomUser').textContent = `👤 ${user.nom || ''}`;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#039;')
    .replace(/"/g, '&quot;');
}

function deconnexion() {
  localStorage.clear();
  window.location.href = 'login.html';
}

// Construit le HTML d'une seule barre "résultat"
// ⚠️ MODIFIÉ — la barre ne révèle plus jamais la moyenne ni la mention avant le clic,
// même si le résultat est disponible : le candidat doit ouvrir la page dédiée pour les voir.
function construireBarreResultat(item) {
  if (!item.resultat_disponible) {
    return `
      <div class="carte-resultat-select disabled">
        <div class="icone-resultat-rond icone-attente">⏳</div>
        <div class="carte-resultat-texte">
          <div class="carte-resultat-titre">${escapeHtml(item.concours_titre)}</div>
          <div class="carte-resultat-sous-texte">Résultats non encore publiés</div>
        </div>
        <span class="badge-attente">🔒 En attente</span>
      </div>
    `;
  }

  return `
    <div class="carte-resultat-select" data-concours-id="${item.concours_id}">
      <div class="icone-resultat-rond">🏆</div>
      <div class="carte-resultat-texte">
        <div class="carte-resultat-titre">${escapeHtml(item.concours_titre)}</div>
        <div class="carte-resultat-sous-texte">Cliquez pour voir le détail</div>
      </div>
      <span class="chevron-resultat">→</span>
    </div>
  `;
}

function afficherListeResultats(listeResultats) {
  const conteneur = document.getElementById('liste-resultats');

  if (listeResultats.length === 0) {
    conteneur.innerHTML = '<p class="text-muted">Vous n\'avez pas encore de candidature validée.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'liste-concours-resultats';
  wrapper.innerHTML = listeResultats.map(construireBarreResultat).join('');

  conteneur.innerHTML = '';
  conteneur.appendChild(wrapper);

  // ⚠️ MODIFIÉ — le clic navigue désormais vers la page dédiée detail_resultat_candidat.html
  // au lieu d'ouvrir un écran B inline. Seule cette nouvelle page révèle la moyenne et la mention.
  conteneur.querySelectorAll('.carte-resultat-select:not(.disabled)').forEach(el => {
    el.addEventListener('click', () => {
      window.location.href = `detail_resultat_candidat.html?concours_id=${el.dataset.concoursId}`;
    });
  });
}

async function chargerMesResultats() {
  const conteneur = document.getElementById('liste-resultats');

  try {
    const res = await fetch(`${API}/resultats?mes_resultats=1`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    const listeResultats = await res.json();

    if (!res.ok) {
      conteneur.innerHTML = '<p class="text-danger">Erreur lors du chargement de vos résultats.</p>';
      return;
    }

    afficherListeResultats(listeResultats);
  } catch (err) {
    console.error(err);
    conteneur.innerHTML = '<p class="text-danger">Erreur de chargement de vos résultats.</p>';
  }
}

chargerMesResultats();