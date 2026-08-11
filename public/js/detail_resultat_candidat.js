const API = '/concours_fp/api/index.php';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

if (!token) {
  window.location.href = 'login.html';
  throw new Error('Non connecté - arrêt du script detail_resultat_candidat.js');
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

// Associe chaque mention à une classe CSS, réutilisée sur plusieurs blocs de la page
const CLASSES_MENTION = {
  'Admis': 'mention-admis',
  'Ajourné': 'mention-ajourne',
  'Rejeté': 'mention-rejete'
};

// Couleur de la mini-barre de progression d'une épreuve, selon la note obtenue sur 20
function couleurNote(note) {
  if (note >= 14) return 'linear-gradient(90deg, #00C896, #00A67D)';
  if (note >= 10) return 'linear-gradient(90deg, #F0C48A, #E0A72E)';
  return 'linear-gradient(90deg, #E88A6A, #E4574C)';
}

// ⚠️ MODIFIÉ — l'anneau circulaire a été entièrement retiré (source du problème de
// superposition). La moyenne s'affiche maintenant en simple texte, sans forme autour.
function construireMoyenneAffichage(note) {
  return `
    <div class="moyenne-affichage">
      <span class="moyenne-num">${note}</span><span class="moyenne-suffix">/20</span>
    </div>
  `;
}

// ===== Médaillon SVG pour le bandeau de félicitations =====
// Version finale validée : bordure ondulée jaune-orangé (contour calculé par boucle
// trigonométrique pour un tracé net), intérieur assombri (ambre foncé), motifs blancs
// réduits (feuilles de laurier, étoiles, coche) tenant entièrement dans la zone sombre,
// rubans rouges agrandis et écartés (±38°) remontés derrière le médaillon (croisement
// caché), avec points de couture blancs sur les deux bords de chaque ruban.
function construireMedaillonSvg() {
  const cx = 340, cy = 200, base = 118, amp = 6, bumps = 10, res = 160;
  let contour = '';
  for (let i = 0; i <= res; i++) {
    const angle = (i / res) * Math.PI * 2;
    const r = base + amp * Math.cos(bumps * angle);
    const x = (cx + r * Math.cos(angle)).toFixed(1);
    const y = (cy + r * Math.sin(angle)).toFixed(1);
    contour += (i === 0 ? `M${x},${y} ` : `L${x},${y} `);
  }
  contour += 'Z';

  return `
    <svg class="medaillon-svg" viewBox="0 0 680 520" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
      <g transform="rotate(-38 340 265)">
        <polygon points="307,265 373,265 373,470 340,417 307,470" fill="#E63946" />
        <line x1="310" y1="282" x2="310" y2="453" stroke="white" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round" />
        <line x1="370" y1="282" x2="370" y2="453" stroke="white" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round" />
      </g>
      <g transform="rotate(38 340 265)">
        <polygon points="307,265 373,265 373,470 340,417 307,470" fill="#D62E3F" />
        <line x1="310" y1="282" x2="310" y2="453" stroke="white" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round" />
        <line x1="370" y1="282" x2="370" y2="453" stroke="white" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round" />
      </g>
      <path d="${contour}" fill="#FF9F1C" />
      <circle cx="340" cy="200" r="95" fill="#8C5509" />
      <path d="M300,204 L328,232 L385,168" stroke="#FFF3D0" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

async function chargerDetailResultat() {
  const conteneur = document.getElementById('contenu-detail');
  const params = new URLSearchParams(window.location.search);
  const concoursId = params.get('concours_id');

  if (!concoursId) {
    conteneur.innerHTML = '<p class="text-danger text-center py-5">Aucun concours précisé.</p>';
    return;
  }

  try {
    // On repart de la route d'ownership déjà sécurisée (mes_resultats) et on filtre
    // côté client sur le concours demandé — aucune donnée d'un autre candidat n'est
    // jamais exposée, puisque le serveur ne renvoie déjà que les résultats du token connecté.
    const res = await fetch(`${API}/resultats?mes_resultats=1`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const liste = await res.json();

    if (!res.ok) {
      conteneur.innerHTML = '<p class="text-danger text-center py-5">Erreur lors du chargement de votre résultat.</p>';
      return;
    }

    const item = liste.find(r => String(r.concours_id) === String(concoursId));

    if (!item || !item.resultat_disponible) {
      conteneur.innerHTML = '<p class="text-muted text-center py-5">Ce résultat n\'est pas disponible.</p>';
      return;
    }

    const classeMention = CLASSES_MENTION[item.mention] || 'mention-ajourne';
    const estAdmis = item.mention === 'Admis';

    const lignesTableau = item.epreuves.map((ep, i) => `
      <tr class="ligne-note" style="animation-delay:${i * 0.06}s">
        <td class="col-epreuve">${escapeHtml(ep.titre)}</td>
        <td class="col-coef">${ep.coefficient}</td>
        <td class="col-note">
          <div class="note-cell">
            <span class="note-valeur">${ep.note_sur_20}/20</span>
            <div class="mini-barre">
              <div class="mini-barre-remplissage" style="width:${(ep.note_sur_20 / 20) * 100}%; background:${couleurNote(ep.note_sur_20)};"></div>
            </div>
          </div>
        </td>
      </tr>
    `).join('');

    conteneur.innerHTML = `
      <div class="detail-header-card ${classeMention}">
        <div class="hero-shape shape-1"></div>
        <div class="hero-shape shape-2"></div>
        <div class="hero-shape shape-3"></div>

        <h4 class="detail-header-titre">${escapeHtml(item.concours_titre)}</h4>

        <div class="detail-header-body">
          ${construireMoyenneAffichage(item.note_totale)}
          <div class="detail-header-infos">
            <span class="badge-mention-lg ${classeMention}">${escapeHtml(item.mention)}</span>
            <span class="rang-info-lg">🥇 Rang ${item.rang}</span>
          </div>
        </div>
      </div>

      ${estAdmis ? `
        <div class="felicitation-banner">
          ${construireMedaillonSvg()}
          <div class="felicitation-texte">
            <div class="felicitation-titre">Félicitations, vous êtes admis(e) !</div>
            <div class="felicitation-sous-titre">Votre classement vous place parmi les lauréats de ce concours.</div>
          </div>
        </div>
      ` : ''}

      <div class="tableau-notes-card">
        <p class="tableau-titre">Détail des notes par épreuve</p>
        <table class="tableau-notes">
          <thead>
            <tr>
              <th>Épreuve</th>
              <th>Coefficient</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${lignesTableau}
          </tbody>
        </table>
      </div>
    `;

  } catch (err) {
    console.error(err);
    conteneur.innerHTML = '<p class="text-danger text-center py-5">Erreur de chargement de votre résultat.</p>';
  }
}

chargerDetailResultat();  