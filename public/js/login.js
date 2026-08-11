// ===============================
// login.js — Page de connexion / inscription / mot de passe oublié
// ===============================
// Ce fichier gère 4 écrans dans la carte d'authentification :
// - loginView       : connexion (candidat, jury, admin)
// - registerView    : inscription (candidats uniquement)
// - forgotEmailView : demande du code de réinitialisation (saisie email)
// - forgotResetView : saisie du code reçu + nouveau mot de passe

const API = '/api/index.php';

// ===== Affichage / masquage du mot de passe (icône œil) =====
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? eyeIcon : eyeOffIcon;
}

const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;

const eyeOffIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

// ===== Bascule entre les 4 écrans (login / register / forgotEmail / forgotReset) =====
// Le switch pilule (Connexion/Inscription) n'est visible que pour login/register.
function showTab(tab) {
  const views = {
    login: document.getElementById('loginView'),
    register: document.getElementById('registerView'),
    forgotEmail: document.getElementById('forgotEmailView'),
    forgotReset: document.getElementById('forgotResetView')
  };
  const forms = {
    login: document.getElementById('loginForm'),
    register: document.getElementById('registerForm')
  };

  Object.keys(views).forEach(key => {
    views[key].classList.toggle('visible', key === tab);
  });

  const authTab = document.getElementById('authTab');
  const isAuthTab = (tab === 'login' || tab === 'register');
  authTab.style.display = isAuthTab ? 'flex' : 'none';

  if (isAuthTab) {
    authTab.classList.toggle('reg', tab === 'register');
    forms.login.classList.toggle('visible', tab === 'login');
    forms.register.classList.toggle('visible', tab === 'register');
    document.querySelectorAll('#authTab button').forEach((btn, i) => {
      btn.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
    });
  }

  document.getElementById('alertMsg').innerHTML = '';
}

function showAlert(msg, type = 'danger') {
  const container = document.getElementById('alertMsg');
  container.innerHTML = '';

  const box = document.createElement('div');
  box.className = `alert alert-${type}`;
  box.textContent = msg;

  container.appendChild(box);
}

function showForgotPassword() {
  showTab('forgotEmail');
}

function showSuccessTransition(user) {
  const overlay = document.getElementById('successOverlay');
  const title = document.getElementById('successTitle');
  const sub = document.getElementById('successSub');

  const prenom = (user.nom || '').split(' ')[0];
  const libelleRole = user.role === 'admin' ? 'espace administrateur'
                     : user.role === 'jury' ? 'espace jury'
                     : 'espace candidat';

  title.textContent = prenom ? `Bienvenue, ${prenom}` : 'Bienvenue';
  sub.textContent = `Ouverture de votre ${libelleRole}...`;

  overlay.classList.add('show');

  setTimeout(() => {
    if (user.role === 'admin') window.location.href = 'admin.html';
    else if (user.role === 'jury') window.location.href = 'jury.html';
    else window.location.href = 'concours.html';
  }, 1600);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

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
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      showSuccessTransition(data.user);
    } else {
      showAlert(data.message || 'Erreur de connexion');
    }
  } catch {
    showAlert('Impossible de contacter le serveur.');
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nom = document.getElementById('regNom').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', nom, email, password, role: 'candidat' })
    });
    const data = await res.json();

    if (res.ok) {
      showAlert('Compte créé ! Connectez-vous maintenant.', 'success');
      showTab('login');
    } else {
      showAlert(data.message || 'Erreur lors de l\'inscription');
    }
  } catch {
    showAlert('Impossible de contacter le serveur.');
  }
});

document.getElementById('forgotEmailForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('forgotEmail').value;

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'forgot_password', email })
    });
    await res.json();

    document.getElementById('forgotResetView').dataset.email = email;
    showTab('forgotReset');
  } catch {
    showAlert('Impossible de contacter le serveur.');
  }
});

document.getElementById('forgotResetForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('forgotResetView').dataset.email;
  const code = document.getElementById('forgotCode').value;
  const new_password = document.getElementById('forgotNewPassword').value;

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_password', email, code, new_password })
    });
    const data = await res.json();

    if (res.ok) {
      showTab('login');
      showAlert('Mot de passe réinitialisé ✅ Vous pouvez vous connecter.', 'success');
    } else {
      showAlert(data.message || 'Code invalide ou expiré');
    }
  } catch {
    showAlert('Impossible de contacter le serveur.');
  }
});

if (localStorage.getItem('token')) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'admin') window.location.href = 'admin.html';
  else if (user.role === 'jury') window.location.href = 'jury.html';
  else window.location.href = 'concours.html';
}