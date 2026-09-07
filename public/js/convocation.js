const API = '/api/index.php';
const token = localStorage.getItem('token');

if (!token) {
  window.location.href = 'login.html';
  throw new Error('Non connecté - arrêt du script convocation.js');
}

const user = JSON.parse(localStorage.getItem('user') || '{}');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#039;')
    .replace(/"/g, '&quot;');
}

async function chargerConvocation() {
  const feuille = document.getElementById('feuilleConvocation');

  try {
    const res = await fetch(`${API}/convocation`, { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    if (!data.epreuves.length) {
      feuille.innerHTML = `
        <p class="text-muted text-center py-5">
          Aucune épreuve à afficher pour le moment.<br>
          Votre convocation apparaîtra ici une fois votre candidature validée et vos épreuves programmées.
        </p>`;
      return;
    }

    const dateEdition = new Date().toLocaleDateString('fr-FR');

    feuille.innerHTML = `
      <div class="entete-convocation">
        <div class="glyph-convocation">A</div>
        <div>
          <div class="titre-plateforme">Asavenir</div>
          <div class="sous-titre-plateforme">Plateforme des concours de la fonction publique</div>
        </div>
      </div>

      <h2 class="titre-convocation">Convocation aux épreuves</h2>

      <div class="bloc-infos-candidat">
        <p><strong>Candidat :</strong> ${escapeHtml(data.candidat.nom)}</p>
        <p><strong>Email :</strong> ${escapeHtml(data.candidat.email)}</p>
        <p><strong>Document édité le :</strong> ${dateEdition}</p>
      </div>

      <table class="table table-bordered tableau-convocation">
        <thead>
          <tr>
            <th>Concours</th>
            <th>Épreuve</th>
            <th>Date &amp; heure</th>
            <th>Durée</th>
            <th>Salle</th>
          </tr>
        </thead>
        <tbody>
          ${data.epreuves.map(e => `
            <tr>
              <td>${escapeHtml(e.concours_titre)}</td>
              <td>${escapeHtml(e.titre)}</td>
              <td>${new Date(e.date_epreuve).toLocaleString('fr-FR')}</td>
              <td>${e.duree} min</td>
              <td>${e.ma_salle ? escapeHtml(e.ma_salle) : '<em>À communiquer</em>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <p class="note-convocation">
        Merci de vous présenter au moins 30 minutes avant le début de chaque épreuve, muni(e) d'une pièce d'identité valide.
      </p>
    `;
  } catch (err) {
    console.error(err);
    feuille.innerHTML = '<p class="text-danger text-center py-5">Erreur de chargement de la convocation.</p>';
  }
}

chargerConvocation();
