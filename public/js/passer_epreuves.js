// ===============================
// passer_epreuves.js — Passage d'une épreuve par le candidat
// ===============================
// Ce fichier gère tout le déroulement d'un examen en ligne :
// - vérification d'accès (déjà soumis ? déjà exclu ?)
// - passage en plein écran + minuteur
// - surveillance anti-fraude (changement d'onglet, perte de focus, sortie du plein écran)
// - soumission des réponses (manuelle ou automatique en cas de fraude / temps écoulé)

const API = '/api/index.php';

let epreuveCommencee = false;        // passe à true seulement après le clic sur "Commencer"
let epreuveActuelleGlobale = null;   // stocke les infos de l'épreuve (dont la durée, utilisée par le minuteur)
let intervalMinuteur = null;         // référence du setInterval, pour pouvoir l'arrêter proprement
let epreuveExclue = false;           // empêche de déclencher plusieurs exclusions en même temps

const token = localStorage.getItem('token');
if (!token) {
  window.location.href = 'login.html';
}

// Récupère l'id de l'épreuve et de la candidature depuis l'URL (ex: passer_epreuves.html?id=4&candidature_id=12)
const params = new URLSearchParams(window.location.search);
const epreuveId = params.get('id');
const candidatureId = params.get('candidature_id');

if (!epreuveId) {
  document.getElementById('questions-container').innerHTML =
    '<p class="text-danger">Aucune épreuve spécifiée.</p>';
}

// ===== Vérifie si le candidat a déjà soumis cette épreuve =====
async function verifierDejaSoumise() {
  try {
    const res = await fetch(`${API}/epreuves?mes_epreuves=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const epreuves = await res.json();
    const epreuveActuelle = epreuves.find(ep => ep.id == epreuveId);

    if (epreuveActuelle && epreuveActuelle.deja_soumise == 1) {
      document.getElementById('questions-container').innerHTML =
        '<p class="text-danger fw-bold">Vous avez déjà soumis cette épreuve. Accès non autorisé.</p>';
      document.getElementById('btn-soumettre').style.display = 'none';
      return true;
    }
    return false;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ===== Charge les questions de l'épreuve et construit le formulaire =====
async function chargerQuestions() {
  const bloque = await verifierDejaSoumise();
  if (bloque) return;

  try {
    const res = await fetch(`${API}/questions?epreuve_id=${epreuveId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const questions = await res.json();
    const conteneur = document.getElementById('questions-container');
    conteneur.innerHTML = '';

    if (questions.length === 0) {
      conteneur.innerHTML = '<p class="text-muted">Aucune question pour cette épreuve.</p>';
      return;
    }

    questions.forEach((q, index) => {
      const carte = document.createElement('div');
      carte.className = 'card shadow-sm p-3';

      const choix = JSON.parse(q.choix);

      let choixHtml = '';
      if (choix && choix.length > 0 && choix[0].id !== null) {
        // Question à choix (QCM/QRM) -> des boutons radio
        choixHtml = choix.map(c => `
          <div class="form-check">
            <input class="form-check-input" type="radio" name="question_${q.id}" value="${c.id}">
            <label class="form-check-label">${c.texte}</label>
          </div>
        `).join('');
      } else {
        // Question ouverte -> une zone de texte libre
        choixHtml = `
          <textarea class="form-control" name="question_${q.id}" rows="4" placeholder="Votre réponse..."></textarea>
        `;
      }

      carte.innerHTML = `
        <h6>Question ${index + 1} (${q.points} pts)</h6>
        <p>${q.enonce}</p>
        ${choixHtml}
      `;

      conteneur.appendChild(carte);
    });

  } catch (err) {
    console.error(err);
    document.getElementById('questions-container').innerHTML =
      '<p class="text-danger">Erreur de chargement des questions.</p>';
  }
}

// ===== Récupère les réponses actuellement remplies dans le formulaire =====
// Fonction commune utilisée par la soumission manuelle ET la soumission automatique,
// pour ne jamais avoir deux bouts de code qui font la même chose différemment
function recupererReponsesFormulaire() {
  const reponses = [];
  const cartesQuestions = document.querySelectorAll('#questions-container .card');

  cartesQuestions.forEach(carte => {
    const radioCoche = carte.querySelector('input[type="radio"]:checked');
    const zoneTexte = carte.querySelector('textarea');

    if (radioCoche) {
      const questionId = radioCoche.name.replace('question_', '');
      reponses.push({
        question_id: parseInt(questionId),
        choix_id: parseInt(radioCoche.value)
      });
    } else if (zoneTexte && zoneTexte.value.trim() !== '') {
      const questionId = zoneTexte.name.replace('question_', '');
      reponses.push({
        question_id: parseInt(questionId),
        texte_reponse: zoneTexte.value.trim()
      });
    }
  });

  return reponses;
}

// ===== Soumission manuelle (le candidat clique sur "Soumettre") =====
async function soumettreEpreuve() {
  if (!candidatureId) {
    alert("Erreur : candidature introuvable.");
    return;
  }

  const confirmation = confirm("Une fois soumise, l'épreuve ne pourra plus être modifiée. Confirmer ?");
  if (!confirmation) return;

  const reponses = recupererReponsesFormulaire();

  if (reponses.length === 0) {
    alert("Vous n'avez répondu à aucune question.");
    return;
  }

  document.getElementById('btn-soumettre').disabled = true;
  document.getElementById('btn-soumettre').textContent = "Envoi en cours...";

  try {
    const res = await fetch(`${API}/reponses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        candidature_id: parseInt(candidatureId),
        reponses: reponses
      })
    });

    const result = await res.json();

    if (res.ok) {
      alert("Épreuve soumise avec succès ✅");
      window.location.href = 'epreuves.html';
    } else {
      alert("Erreur : " + result.message);
      document.getElementById('btn-soumettre').disabled = false;
      document.getElementById('btn-soumettre').textContent = "Soumettre l'épreuve";
    }

  } catch (err) {
    console.error(err);
    alert("Erreur réseau lors de la soumission.");
    document.getElementById('btn-soumettre').disabled = false;
    document.getElementById('btn-soumettre').textContent = "Soumettre l'épreuve";
  }
}

// ===== Soumission automatique (temps écoulé ou exclusion pour fraude) =====
// Pas de confirm() ici : le candidat n'a pas son mot à dire, la soumission est forcée
async function soumettreEpreuveAutomatique() {
  if (!candidatureId) return;

  const reponses = recupererReponsesFormulaire();

  try {
    await fetch(`${API}/reponses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        candidature_id: parseInt(candidatureId),
        reponses: reponses
      })
    });
  } catch (err) {
    console.error("Erreur soumission automatique :", err);
  }
}

// ===== Démarrage de l'épreuve : plein écran obligatoire + minuteur =====
function commencerEpreuve() {
  const elem = document.documentElement;

  const promesse = elem.requestFullscreen
    ? elem.requestFullscreen()
    : elem.webkitRequestFullscreen
      ? elem.webkitRequestFullscreen()
      : null;

  if (!promesse) {
    alert("Le mode plein écran n'est pas supporté par votre navigateur.");
    return;
  }

  promesse.then(async () => {
    epreuveCommencee = true;
    document.getElementById('ecran-demarrage').classList.add('d-none');
    document.getElementById('zone-epreuve').classList.remove('d-none');

    // Important : on attend que les questions soient chargées avant de démarrer le minuteur,
    // pour être sûr que epreuveActuelleGlobale (rempli par verifierAcces) est bien disponible
    if (epreuveId) {
      await chargerQuestions();
    }

    demarrerMinuteur();
  }).catch(err => {
    alert("Vous devez accepter le mode plein écran pour passer l'épreuve.");
    console.error(err);
  });
}

// ===== Affiche l'écran noir "Exclu" en remplaçant toute la page =====
function afficherEcranExclusion(raison) {
  if (intervalMinuteur) {
    clearInterval(intervalMinuteur);
  }
  document.body.innerHTML = `
    <div style="
      position: fixed; top:0; left:0; width:100%; height:100%;
      background:black; color:red; display:flex;
      flex-direction:column; align-items:center; justify-content:center;
      text-align:center; z-index:9999; font-family:sans-serif;
    ">
      <h1>🚫 VOUS ÊTES EXCLU(E) DE L'EXAMEN</h1>
      <p style="color:white; margin-top:1rem;">
        Tentative de fraude détectée : ${raison}
      </p>
    </div>
  `;
}

// ===== Enregistre l'exclusion côté serveur (pour que ce soit permanent, pas juste visuel) =====
async function enregistrerExclusion(raison) {
  try {
    await fetch(`${API}/exclusions`, {
      method: 'POST',
      keepalive: true, // permet à la requête de finir même si l'onglet se ferme juste après
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        candidature_id: parseInt(candidatureId),
        epreuve_id: parseInt(epreuveId),
        raison: raison
      })
    });
  } catch (err) {
    console.error("Erreur enregistrement exclusion :", err);
  }
}

// ===== Déclenche l'exclusion complète du candidat =====
function exclureCandidat(raison) {
  if (epreuveExclue) return; // évite de déclencher l'exclusion plusieurs fois d'affilée
  epreuveExclue = true;

  console.warn("Exclusion déclenchée :", raison);

  (async () => {
    await enregistrerExclusion(raison);
    await soumettreEpreuveAutomatique(); // on sauvegarde quand même ce qui était rempli avant la triche
    afficherEcranExclusion(raison);
  })();
}

// --- Les 3 "vigiles" anti-fraude ---
// Chacun surveille un comportement suspect différent pendant l'épreuve

// Vigile 1 : le candidat change d'onglet ou réduit la fenêtre
document.addEventListener('visibilitychange', function () {
  if (epreuveCommencee && document.hidden && !epreuveExclue) {
    exclureCandidat("changement d'onglet ou réduction de fenêtre");
  }
});

// Vigile 2 : la fenêtre du navigateur perd le focus (une autre appli passe au premier plan)
// Le petit délai (300ms) évite les faux positifs lors d'un simple clic sur une notification système
window.addEventListener('blur', function () {
  setTimeout(() => {
    if (epreuveCommencee && !document.hasFocus() && !epreuveExclue) {
      exclureCandidat("perte de focus (autre application ouverte)");
    }
  }, 300);
});

// Vigile 3 : le candidat sort du mode plein écran (touche Échap par exemple)
document.addEventListener('fullscreenchange', function () {
  if (epreuveCommencee && !document.fullscreenElement && !epreuveExclue) {
    exclureCandidat("sortie du mode plein écran");
  }
});

// ===== Minuteur =====
function demarrerMinuteur() {
  if (!epreuveActuelleGlobale || !epreuveActuelleGlobale.duree) {
    console.warn("Durée de l'épreuve introuvable, minuteur non démarré.");
    return;
  }

  let secondesRestantes = epreuveActuelleGlobale.duree * 60;

  afficherMinuteur(secondesRestantes);

  intervalMinuteur = setInterval(() => {
    secondesRestantes--;

    afficherMinuteur(secondesRestantes);

    if (secondesRestantes <= 0) {
      clearInterval(intervalMinuteur);
      tempsEcoule();
    }
  }, 1000);
}

// Affiche le temps restant au format "00h 05min 30s", et passe en rouge sous 1 minute
function afficherMinuteur(secondesRestantes) {
  const heures = Math.floor(secondesRestantes / 3600);
  const minutes = Math.floor((secondesRestantes % 3600) / 60);
  const secondes = secondesRestantes % 60;

  const texte = `${String(heures).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}min ${String(secondes).padStart(2, '0')}s`;
  document.getElementById('minuteur-texte').textContent = texte;

  const boiteMinuteur = document.getElementById('minuteur');
  if (secondesRestantes <= 60) {
    boiteMinuteur.classList.remove('alert-info');
    boiteMinuteur.classList.add('alert-danger');
  }
}

// Appelé automatiquement quand le minuteur arrive à zéro
function tempsEcoule() {
  if (epreuveExclue) return; // si déjà exclu, pas besoin de refaire une soumission

  alert("⏰ Le temps imparti est écoulé. Votre épreuve va être soumise automatiquement.");
  soumettreEpreuveAutomatique();
  window.location.href = 'epreuves.html';
}

// ===== Vérifie l'accès à l'épreuve avant même d'afficher le bouton "Commencer" =====
// (bloque si déjà exclu, sinon prépare epreuveActuelleGlobale pour le minuteur)
async function verifierAcces() {
  try {
    const res = await fetch(`${API}/epreuves?mes_epreuves=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const epreuves = await res.json();
    const epreuveActuelle = epreuves.find(ep => ep.id == epreuveId);
    epreuveActuelleGlobale = epreuveActuelle || null;

    if (epreuveActuelle && epreuveActuelle.est_exclu == 1) {
      afficherEcranExclusion("accès bloqué suite à une exclusion déjà enregistrée");
      return;
    }

    document.getElementById('ecran-demarrage').classList.remove('d-none');

  } catch (err) {
    console.error(err);
    // Correction : on informe le candidat au lieu de le laisser devant un écran vide sans explication
    document.getElementById('questions-container').innerHTML =
      '<p class="text-danger">Impossible de vérifier l\'accès à l\'épreuve. Rechargez la page ou contactez un administrateur.</p>';
    document.getElementById('ecran-demarrage').classList.remove('d-none');
  }
}

if (epreuveId) {
  verifierAcces();
}