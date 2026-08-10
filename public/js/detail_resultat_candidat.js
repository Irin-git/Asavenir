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
// ⚠️ REDESSINÉ — bordure ondulée générée mathématiquement (boucle trigonométrique)
// plutôt qu'avec des formes qui se chevauchent, pour un contour net à toute taille.
// Rubans évasés en diagonale (queue d'aronde) avec liseré blanc en hachures le long
// du bord extérieur. Un logo de marque (type "swoosh") ne peut pas être reproduit ici
// car il s'agit d'un élément protégé : une coche blanche épurée le remplace, dans le
// même esprit minimaliste.
function construireMedaillonSvg() {
  const cx = 50, cy = 45, rayonBase = 34, amplitude = 4, nbBosses = 14, resolution = 140;
  let contour = '';
  for (let i = 0; i <= resolution; i++) {
    const angle = (i / resolution) * Math.PI * 2;
    const r = rayonBase + amplitude * Math.cos(nbBosses * angle);
    const x = (cx + r * Math.cos(angle)).toFixed(2);
    const y = (cy + r * Math.sin(angle)).toFixed(2);
    contour += (i === 0 ? `M${x},${y} ` : `L${x},${y} `);
  }
  contour += 'Z';

  return `
    <svg class="medaillon-svg" viewBox="-15 0 130 150" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
      <!-- Rubans rouges évasés en diagonale, terminaison en queue d'aronde, liseré blanc en hachures -->
      <g transform="rotate(-18 47 74)">
        <polygon points="40,74 54,74 54,124 47,111 40,124" fill="#E63946" />
        <line x1="40" y1="74" x2="40" y2="124" stroke="white" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round" />
      </g>
      <g transform="rotate(18 53 74)">
        <polygon points="46,74 60,74 60,124 53,111 46,124" fill="#D62E3F" />
        <line x1="60" y1="74" x2="60" y2="124" stroke="white" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round" />
      </g>

      <!-- Bordure extérieure ondulée, jaune vif légèrement orangé -->
      <path d="${contour}" fill="#FFA630" />

      <!-- Léger ombrage 2D : disque légèrement décalé en dessous -->
      <circle cx="${cx}" cy="${cy + 3}" r="29" fill="#9C6B12" opacity="0.5" />

      <!-- Fond intérieur, ambre/doré mat -->
      <circle cx="${cx}" cy="${cy}" r="29" fill="#C08B2E" />

      <!-- Coche blanche, propre et minimaliste -->
      <path d="M36 46 L46 56 L68 28" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
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