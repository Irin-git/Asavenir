// ===============================
// passer_epreuves.js — Passage d'une épreuve par le candidat
// ===============================
// Ce fichier gère tout le déroulement d'un examen en ligne :
// - vérification d'accès (déjà soumis ? déjà exclu ?)
// - passage en plein écran + minuteur
// - surveillance anti-fraude (changement d'onglet, perte de focus, sortie du plein écran)
// - soumission des réponses (manuelle ou automatique en cas de fraude / temps écoulé)
//
// CORRECTIF (checklist soutenance) : les fonctions natives confirm() et alert()
// font quitter le mode plein écran automatiquement dans la plupart des navigateurs.
// Ça déclenchait le "Vigile 3" (fullscreenchange) à tort, causant une fausse exclusion
// à chaque clic sur "Soumettre" (annulé ou confirmé) et au moment du message de succès.
// On remplace donc confirm()/alert() par une mini-modale maison qui ne touche jamais
// au plein écran, et on ajoute un drapeau "epreuveTerminee" pour désarmer les vigiles
// une fois l'épreuve légitimement finie (succès ou temps écoulé).

const API = '/api/index.php';

let epreuveCommencee = false;        // passe à true seulement après le clic sur "Commencer"
let epreuveActuelleGlobale = null;   // stocke les infos de l'épreuve (dont la durée, utilisée par le minuteur)
let intervalMinuteur = null;         // référence du setInterval, pour pouvoir l'arrêter proprement
let epreuveExclue = false;           // empêche de déclencher plusieurs exclusions en même temps
let epreuveTerminee = false;         // NOUVEAU : true dès que l'épreuve se termine normalement (succès ou temps écoulé) -> désarme les vigiles

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

// ===============================
// NOUVEAU : mini-modale maison (remplace confirm() et alert())
// ===============================
// Elle ne déclenche AUCUN événement fullscreenchange/blur, contrairement aux
// boîtes de dialogue natives du navigateur. C'est la correction centrale des bugs 1, 2 et 3.
function afficherModale({ titre, message, boutons }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top:0; left:0; width:100%; height:100%;
      background: rgba(0,0,0,0.6); z-index: 99999;
      display:flex; align-items:center; justify-content:center;
    `;

    const boite = document.createElement('div');
    boite.style.cssText = `
      background:#fff; border-radius:12px; padding:2rem;
      max-width:420px; width:90%; text-align:center;
      font-family: Inter, sans-serif; box-shadow:0 10px 40px rgba(0,0,0,0.3);
    `;

    const titreEl = document.createElement('h5');
    titreEl.textContent = titre;
    titreEl.style.marginBottom = '0.75rem';

    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.color = '#555';
    messageEl.style.marginBottom = '1.5rem';

    const zoneBoutons = document.createElement('div');
    zoneBoutons.style.cssText = 'display:flex; gap:0.75rem; justify-content:center;';

    boutons.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.texte;
      btn.className = 'btn ' + (b.style || 'btn-secondary');
      btn.style.minWidth = '110px';
      btn.onclick = () => {
        document.body.removeChild(overlay);
        resolve(b.valeur);
      };
      zoneBoutons.appendChild(btn);
    });

    boite.appendChild(titreEl);
    boite.appendChild(messageEl);
    boite.appendChild(zoneBoutons);
    overlay.appendChild(boite);
    document.body.appendChild(overlay);
  });
}

// Petit toast de succès non bloquant (remplace alert() côté succès)
function afficherToastSucces(message, dureeMs = 1800) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; top:20px; left:50%; transform:translateX(-50%);
    background:#198754; color:#fff; padding:0.9rem 1.5rem;
    border-radius:8px; z-index:99999; font-family: Inter, sans-serif;
    box-shadow:0 6px 20px rgba(0,0,0,0.25);
  `;
  document.body.appendChild(toast);
  return new Promise(resolve => setTimeout(() => {
    document.body.removeChild(toast);
    resolve();
  }, dureeMs));
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
        '<p class="text-danger fw-bold">Vous avez déjà soumis cette épreuve. Redirection...</p>';
      document.getElementById('btn-soumettre').style.display = 'none';
      // Bug fix : on ne laisse jamais le candidat rester sur la page d'examen une fois soumise,
      // même s'il y accède directement par une ancienne URL ou un signet
      setTimeout(() => window.location.replace('concours.html'), 1200);
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

      // NOUVEAU (bug 4) : affichage du média joint à la question (image ou PDF).
      // q.media contient uniquement le nom du fichier stocké par questions.php
      // (dossier uploads/medias/), servi ici via une URL statique classique.
      let mediaHtml = '';
      if (q.media) {
        const extension = q.media.split('.').pop().toLowerCase();
        const urlMedia = `/uploads/medias/${q.media}`;

        if (['jpg', 'jpeg', 'png'].includes(extension)) {
          mediaHtml = `
            <div class="mb-3">
              <img src="${urlMedia}" alt="Document de la question" class="img-fluid rounded border" style="max-height:400px;">
            </div>
          `;
        } else if (extension === 'pdf') {
          mediaHtml = `
            <div class="mb-3">
              <a href="${urlMedia}" target="_blank" rel="noopener" class="btn btn-outline-secondary btn-sm">
                📄 Voir le document joint (PDF)
              </a>
            </div>
          `;
        }
      }

      carte.innerHTML = `
        <h6>Question ${index + 1} (${q.points} pts)</h6>
        <p>${q.enonce}</p>
        ${mediaHtml}
        ${choixHtml}
      `;

      conteneur.appendChild(carte);
    });

    rendreMathDans(conteneur); // Chantier 4

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
// CORRIGÉ (bugs 1 et 2) : confirm() natif remplacé par afficherModale(), qui ne
// casse jamais le plein écran. Si le candidat annule, rien ne se passe : il reste
// dans son épreuve, en plein écran, sans exclusion. Si il valide, on désarme les
// vigiles AVANT toute sortie de plein écran, pour que le succès ne déclenche pas
// une fausse exclusion (bug 3).
async function soumettreEpreuve() {
  if (!candidatureId) {
    await afficherModale({
      titre: 'Erreur',
      message: 'Candidature introuvable.',
      boutons: [{ texte: 'OK', style: 'btn-danger', valeur: true }]
    });
    return;
  }

  const confirmation = await afficherModale({
    titre: 'Confirmer la soumission',
    message: "Une fois soumise, l'épreuve ne pourra plus être modifiée. Confirmer ?",
    boutons: [
      { texte: 'Annuler', style: 'btn-secondary', valeur: false },
      { texte: 'Confirmer', style: 'btn-primary', valeur: true }
    ]
  });

  // Le candidat a cliqué "Annuler" : on ne fait RIEN d'autre. Pas d'exclusion,
  // pas de sortie de plein écran, il peut juste revérifier son épreuve tranquillement.
  if (!confirmation) return;

  const reponses = recupererReponsesFormulaire();

  if (reponses.length === 0) {
    await afficherModale({
      titre: 'Formulaire vide',
      message: "Vous n'avez répondu à aucune question.",
      boutons: [{ texte: 'OK', style: 'btn-primary', valeur: true }]
    });
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
      // On désarme les vigiles AVANT toute sortie de plein écran ou redirection,
      // sinon la sortie de plein écran déclenchée juste après serait interprétée
      // comme une fraude par le Vigile 3 -> fausse exclusion (bug 3 corrigé ici).
      epreuveTerminee = true;
      if (intervalMinuteur) clearInterval(intervalMinuteur);

      await afficherToastSucces("Épreuve soumise avec succès ✅");

      // Sortie propre et volontaire du plein écran, une fois les vigiles désarmés
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }

      // Bug fix : replace() (pas href) pour que la page d'examen soit RETIRÉE de l'historique —
      // le bouton retour du navigateur ne pourra donc jamais y ramener le candidat
      window.location.replace('concours.html');
    } else {
      document.getElementById('btn-soumettre').disabled = false;
      document.getElementById('btn-soumettre').textContent = "Soumettre l'épreuve";
      await afficherModale({
        titre: 'Erreur',
        message: result.message || "Une erreur est survenue.",
        boutons: [{ texte: 'OK', style: 'btn-danger', valeur: true }]
      });
    }

  } catch (err) {
    console.error(err);
    document.getElementById('btn-soumettre').disabled = false;
    document.getElementById('btn-soumettre').textContent = "Soumettre l'épreuve";
    await afficherModale({
      titre: 'Erreur réseau',
      message: "La soumission a échoué. Vérifiez votre connexion et réessayez.",
      boutons: [{ texte: 'OK', style: 'btn-danger', valeur: true }]
    });
  }
}

// ===== Soumission automatique (temps écoulé ou exclusion pour fraude) =====
// Pas de confirmation ici : le candidat n'a pas son mot à dire, la soumission est forcée
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
    afficherModale({
      titre: 'Non supporté',
      message: "Le mode plein écran n'est pas supporté par votre navigateur.",
      boutons: [{ texte: 'OK', style: 'btn-danger', valeur: true }]
    });
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
    afficherModale({
      titre: 'Plein écran requis',
      message: "Vous devez accepter le mode plein écran pour passer l'épreuve.",
      boutons: [{ texte: 'OK', style: 'btn-danger', valeur: true }]
    });
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
  if (epreuveExclue || epreuveTerminee) return; // NOUVEAU : plus d'exclusion possible une fois l'épreuve terminée normalement
  epreuveExclue = true;

  console.warn("Exclusion déclenchée :", raison);

  (async () => {
    await enregistrerExclusion(raison);
    await soumettreEpreuveAutomatique(); // on sauvegarde quand même ce qui était rempli avant la triche
    afficherEcranExclusion(raison);
  })();
}

// --- Les 3 "vigiles" anti-fraude ---
// Chacun surveille un comportement suspect différent pendant l'épreuve.
// NOUVEAU : chaque vigile vérifie désormais aussi "!epreuveTerminee", pour ne
// jamais se déclencher pendant/après une fin d'épreuve légitime (succès ou temps écoulé).

// Vigile 1 : le candidat change d'onglet ou réduit la fenêtre
document.addEventListener('visibilitychange', function () {
  if (epreuveCommencee && document.hidden && !epreuveExclue && !epreuveTerminee) {
    exclureCandidat("changement d'onglet ou réduction de fenêtre");
  }
});

// Vigile 2 : la fenêtre du navigateur perd le focus (une autre appli passe au premier plan)
// Le petit délai (300ms) évite les faux positifs lors d'un simple clic sur une notification système
window.addEventListener('blur', function () {
  setTimeout(() => {
    if (epreuveCommencee && !document.hasFocus() && !epreuveExclue && !epreuveTerminee) {
      exclureCandidat("perte de focus (autre application ouverte)");
    }
  }, 300);
});

// Vigile 3 : le candidat sort du mode plein écran (touche Échap par exemple)
document.addEventListener('fullscreenchange', function () {
  if (epreuveCommencee && !document.fullscreenElement && !epreuveExclue && !epreuveTerminee) {
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
// CORRIGÉ (même logique que soumettreEpreuve) : on désarme les vigiles avant de
// sortir du plein écran, pour ne pas déclencher une fausse exclusion ici non plus.
async function tempsEcoule() {
  if (epreuveExclue || epreuveTerminee) return; // si déjà exclu/terminé, pas besoin de refaire une soumission

  epreuveTerminee = true;

  await afficherModale({
    titre: 'Temps écoulé',
    message: "Le temps imparti est écoulé. Votre épreuve va être soumise automatiquement.",
    boutons: [{ texte: 'OK', style: 'btn-primary', valeur: true }]
  });

  await soumettreEpreuveAutomatique();

  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }

  window.location.replace('concours.html');
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
