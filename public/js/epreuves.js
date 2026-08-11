const API = '/api/index.php';
const token = localStorage.getItem('token');

if (!token) {
  window.location.href = 'login.html';
  throw new Error('Non connecté - arrêt du script epreuves.js');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#039;')
    .replace(/"/g, '&quot;');
}

// Construit le HTML d'une seule carte d'épreuve (INCHANGÉ depuis le début)
function construireCarteEpreuve(ep) {
  const dateFormatee = new Date(ep.date_epreuve).toLocaleString('fr-FR');

  return `
    <div class="card epreuve-card shadow-sm">
      <div class="card-body">
        <h5 class="card-title">${escapeHtml(ep.titre)}</h5>
        <p class="card-text mb-1"><strong>Type :</strong> ${escapeHtml(ep.type)}</p>
        <p class="card-text mb-1"><strong>Durée :</strong> ${ep.duree} min</p>
        <p class="card-text mb-2"><strong>Date :</strong> ${dateFormatee}</p>
        ${ep.est_exclu == 1
          ? `<button class="btn btn-dark w-100" disabled>🚫 Exclu(e) de l'épreuve</button>`
          : ep.deja_soumise == 1
            ? `<button class="btn btn-danger w-100" disabled>✅ Épreuve déjà soumise</button>`
            : ep.est_accessible == 1
              ? `<button class="btn btn-success w-100 btn-passer-epreuve" data-id="${ep.id}" data-candidature="${ep.candidature_id}">Passer l'épreuve</button>`
              : `<button class="btn btn-secondary w-100" disabled>Pas encore accessible</button>`
        }
      </div>
    </div>
  `;
}

// ===== Stockage global des groupes une fois chargés, pour pouvoir =====
// ===== revenir à l'écran A sans refaire un appel API =====
let groupesConcours = new Map();

// ===== ÉCRAN A : liste des concours (cartes cliquables) =====
function afficherListeConcours() {
  const conteneur = document.getElementById('liste-epreuves');

  if (groupesConcours.size === 0) {
    conteneur.innerHTML = '<p class="text-muted">Aucune épreuve disponible pour le moment.</p>';
    return;
  }

  // Petit sous-titre d'accroche au-dessus de la liste
  conteneur.innerHTML = `<p class="sous-titre-ecran">Sélectionnez le concours pour lequel vous souhaitez passer une épreuve.</p>`;

  const wrapper = document.createElement('div');
  wrapper.className = 'liste-concours-epreuves';

  groupesConcours.forEach((listeEpreuves, titreConcours) => {
    const carte = document.createElement('div');
    carte.className = 'carte-concours-select';

    // Initiale du concours pour l'icône ronde décorative
    const initiale = titreConcours.trim().charAt(0).toUpperCase();

    carte.innerHTML = `
      <div class="icone-concours-rond">${escapeHtml(initiale)}</div>
      <div class="carte-concours-select-texte">
        <div class="carte-concours-select-titre">${escapeHtml(titreConcours)}</div>
        <div class="carte-concours-select-sous-texte">Cliquez pour voir les épreuves</div>
      </div>
      <span class="badge-count">${listeEpreuves.length} épreuve${listeEpreuves.length > 1 ? 's' : ''}</span>
      <span class="chevron-concours">→</span>
    `;

    carte.addEventListener('click', () => afficherEpreuvesDuConcours(titreConcours));
    wrapper.appendChild(carte);
  });

  conteneur.appendChild(wrapper);
}

// ===== ÉCRAN B : épreuves du concours sélectionné + bouton retour =====
function afficherEpreuvesDuConcours(titreConcours) {
  const conteneur = document.getElementById('liste-epreuves');
  const listeEpreuves = groupesConcours.get(titreConcours) || [];

  conteneur.innerHTML = `
    <button type="button" class="btn-retour-concours">← Retour à mes concours</button>
    <h4 class="titre-concours-actif">${escapeHtml(titreConcours)}</h4>
    <div class="contenu-epreuves-concours">
      ${listeEpreuves.map(construireCarteEpreuve).join('')}
    </div>
  `;

  conteneur.querySelector('.btn-retour-concours').addEventListener('click', afficherListeConcours);

  // Écouteurs des boutons "Passer l'épreuve", identique à avant
  conteneur.querySelectorAll('.btn-passer-epreuve').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `passer_epreuves.html?id=${btn.dataset.id}&candidature_id=${btn.dataset.candidature}`;
    });
  });
}

async function chargerEpreuves() {
  const conteneur = document.getElementById('liste-epreuves');

  try {
    const res = await fetch(`${API}/epreuves?mes_epreuves=1`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    const epreuves = await res.json();

    if (epreuves.length === 0) {
      conteneur.innerHTML = '<p class="text-muted">Aucune épreuve disponible pour le moment.</p>';
      return;
    }

    // ===== Regroupement par concours (INCHANGÉ) =====
    groupesConcours = new Map();
    epreuves.forEach(ep => {
      const cle = ep.concours_titre || 'Concours non précisé';
      if (!groupesConcours.has(cle)) groupesConcours.set(cle, []);
      groupesConcours.get(cle).push(ep);
    });

    afficherListeConcours();

  } catch (err) {
    console.error(err);
    conteneur.innerHTML = '<p class="text-danger">Erreur de chargement des épreuves.</p>';
  }
}

chargerEpreuves();