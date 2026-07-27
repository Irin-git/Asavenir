// ===============================
// login.js — Page de connexion / inscription
// ===============================
// Ce fichier gère les deux formulaires de la page login.html :
// - le formulaire de connexion (candidat, jury, admin)
// - le formulaire d'inscription (uniquement pour les candidats)

const API = '/concours_fp/api/index.php';

// ===== Affichage / masquage du mot de passe (icône œil) =====
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? eyeIcon : eyeOffIcon;
}

// Les deux icônes (œil ouvert / œil barré) en SVG, réutilisées par togglePassword
const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;

const eyeOffIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

// ===== Bascule entre l'onglet "Connexion" et l'onglet "Inscription" =====
function showTab(tab) {
  document.getElementById('loginForm').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('alertMsg').innerHTML = '';
  document.querySelectorAll('.nav-link').forEach((btn, i) => {
    btn.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
  });
}

// Affiche un message d'alerte (erreur par défaut, ou succès si précisé)
function showAlert(msg, type = 'danger') {
  document.getElementById('alertMsg').innerHTML =
    `<div class="alert alert-${type}">${msg}</div>`;
}

// ===== Connexion =====
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); // on empêche le rechargement de page par défaut du formulaire

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email, password })
    });
    const data = await res.json();

    if (res.ok) {
      // On stocke le token et les infos user pour les réutiliser sur les autres pages
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      showAlert('Connexion réussie ! Redirection...', 'success');

      // Petite pause avant de rediriger, le temps que le message s'affiche
      setTimeout(() => {
        if (data.user.role === 'admin') window.location.href = 'admin.html';
        else if (data.user.role === 'jury') window.location.href = 'jury.html';
        else window.location.href = 'concours.html';
      }, 1000);
    } else {
      showAlert(data.message || 'Erreur de connexion');
    }
  } catch {
    showAlert('Impossible de contacter le serveur.');
  }
});

// ===== Inscription =====
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nom = document.getElementById('regNom').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Le rôle est toujours "candidat" ici : personne ne peut s'inscrire en tant que jury ou admin depuis ce formulaire
      body: JSON.stringify({ action: 'register', nom, email, password, role: 'candidat' })
    });
    const data = await res.json();

    if (res.ok) {
      showAlert('Compte créé ! Connectez-vous maintenant.', 'success');
      showTab('login'); // on renvoie directement vers l'onglet connexion
    } else {
      showAlert(data.message || 'Erreur lors de l\'inscription');
    }
  } catch {
    showAlert('Impossible de contacter le serveur.');
  }
});

// ===== Si l'utilisateur est déjà connecté, on ne le laisse pas revenir sur cette page =====
// (Correction : on tenait compte du rôle admin, mais pas du rôle jury -> on complète les 3 cas)
if (localStorage.getItem('token')) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'admin') window.location.href = 'admin.html';
  else if (user.role === 'jury') window.location.href = 'jury.html';
  else window.location.href = 'concours.html';
}