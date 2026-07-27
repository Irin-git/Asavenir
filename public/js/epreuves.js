const API = '/concours_fp/api/index.php';
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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function chargerEpreuves() {
  const conteneur = document.getElementById('liste-epreuves');

  try {
    // Avant : l'URL était codée en dur en "http://localhost/..." — ça cassait
    // dès qu'on n'était plus sur localhost. On utilise maintenant la même
    // constante API relative que le reste du projet.
    const res = await fetch(`${API}/epreuves?mes_epreuves=1`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    const epreuves = await res.json();
    conteneur.innerHTML = '';

    if (epreuves.length === 0) {
      conteneur.innerHTML = '<p class="text-muted">Aucune épreuve disponible pour le moment.</p>';
      return;
    }

    epreuves.forEach(ep => {
      const carte = document.createElement('div');
      carte.className = 'card shadow-sm';

      const dateFormatee = new Date(ep.date_epreuve).toLocaleString('fr-FR');

      carte.innerHTML = `
        <div class="card-body">
          <h5 class="card-title">${escapeHtml(ep.titre)}</h5>
          <p class="card-text mb-1"><strong>Concours :</strong> ${escapeHtml(ep.concours_titre)}</p>
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
      `;

      conteneur.appendChild(carte);
    });

    // On attache l'écouteur après coup plutôt qu'un onclick avec valeurs
    // interpolées directement dans le HTML
    conteneur.querySelectorAll('.btn-passer-epreuve').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.href = `passer_epreuves.html?id=${btn.dataset.id}&candidature_id=${btn.dataset.candidature}`;
      });
    });

  } catch (err) {
    console.error(err);
    conteneur.innerHTML = '<p class="text-danger">Erreur de chargement des épreuves.</p>';
  }
}

chargerEpreuves();