<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

$secretKey = "concours_fp_secret_2024_plateforme_Madagascar_@#!";
$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// Rôles pour lesquels la double authentification (2FA) par email est obligatoire.
// Un candidat se connecte directement ; un admin/jury doit valider un code reçu par email.
const ROLES_2FA = ['admin', 'jury'];

// Construit le token JWT + la réponse de connexion réussie (utilisé par login, verify_2fa et google_login)
function genererReponseConnexion($user, $secretKey) {
    $payload = [
        "id"    => $user['id'],
        "email" => $user['email'],
        "role"  => $user['role'],
        "exp"   => time() + (60 * 60 * 24 * 30) // 30 jours (au lieu de 24h) : évite de redemander la 2FA trop souvent
    ];

    $token = JWT::encode($payload, $secretKey, 'HS256');

    return [
        "message" => "Connexion réussie ✅",
        "token"   => $token,
        "user"    => [
            "id"    => $user['id'],
            "nom"   => $user['nom'],
            "email" => $user['email'],
            "role"  => $user['role']
        ]
    ];
}

// Génère un code à 6 chiffres, l'enregistre en base et l'envoie par email.
// Renvoie true/false selon le succès de l'envoi.
function envoyerCode2FA($conn, $user) {
    $code = strval(random_int(100000, 999999));

    $insert = $conn->prepare("INSERT INTO two_factor_codes (user_id, code, expire_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))");
    $insert->execute([$user['id'], $code]);

    require_once __DIR__ . '/../utils/mailer_send.php';
    return envoyerEmailCode($user['email'], $user['nom'], $code, '2fa');
}

if ($method === 'POST' && isset($data['action']) && $data['action'] === 'register') {

    // Vérification que tous les champs obligatoires sont bien présents avant de continuer
    if (empty($data['nom']) || empty($data['email']) || empty($data['password'])) {
        http_response_code(400);
        echo json_encode(["message" => "Nom, email et mot de passe sont obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $nom = $data['nom'];
    $email = $data['email'];
    $password = password_hash($data['password'], PASSWORD_BCRYPT); // hachage cryptographique, jamais le mot de passe en clair en base
    $role = 'candidat'; // 🔒 toujours forcé, jamais pris depuis $data (sécurité)

    // On vérifie que l'email n'est pas déjà utilisé par un autre compte
    $check = $conn->prepare("SELECT id FROM users WHERE email = ?");
    $check->execute([$email]);
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(["message" => "Email déjà utilisé"]);
        exit();
    }

    $sql = "INSERT INTO users (nom, email, password, role) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->execute([$nom, $email, $password, $role]);

    echo json_encode(["message" => "Inscription réussie ✅"]);
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'login') {

    if (empty($data['email']) || empty($data['password'])) {
        http_response_code(400);
        echo json_encode(["message" => "Email et mot de passe obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $email = $data['email'];
    $password = $data['password'];

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    // On vérifie le mot de passe avec password_verify, jamais de comparaison directe de chaînes
    if (!$user || !password_verify($password, $user['password'])) {
        http_response_code(401);
        echo json_encode(["message" => "Email ou mot de passe incorrect"]);
        exit();
    }

    // 🔒 2FA obligatoire pour admin/jury : on ne délivre pas le token tout de suite
    if (in_array($user['role'], ROLES_2FA)) {
        $envoye = envoyerCode2FA($conn, $user);
        if (!$envoye) {
            http_response_code(500);
            echo json_encode(["message" => "Erreur lors de l'envoi du code de vérification"]);
            exit();
        }
        echo json_encode([
            "twofa_required" => true,
            "email" => $user['email'],
            "message" => "Un code de vérification a été envoyé à votre adresse email"
        ]);
        exit();
    }

    // Candidat : connexion directe, comme avant
    echo json_encode(genererReponseConnexion($user, $secretKey));
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'verify_2fa') {

    if (empty($data['email']) || empty($data['code'])) {
        http_response_code(400);
        echo json_encode(["message" => "Email et code obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$data['email']]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user || !in_array($user['role'], ROLES_2FA)) {
        http_response_code(400);
        echo json_encode(["message" => "Code invalide ou expiré"]);
        exit();
    }

    // Code correspondant, non utilisé, non expiré
    $stmtCode = $conn->prepare("
        SELECT id FROM two_factor_codes
        WHERE user_id = ? AND code = ? AND utilise = 0 AND expire_at > NOW()
        ORDER BY id DESC LIMIT 1
    ");
    $stmtCode->execute([$user['id'], $data['code']]);
    $twofa = $stmtCode->fetch(PDO::FETCH_ASSOC);

    if (!$twofa) {
        http_response_code(400);
        echo json_encode(["message" => "Code invalide ou expiré"]);
        exit();
    }

    // Le code est marqué comme utilisé — impossible de le réutiliser (même logique que reset_password)
    $invalidate = $conn->prepare("UPDATE two_factor_codes SET utilise = 1 WHERE id = ?");
    $invalidate->execute([$twofa['id']]);

    echo json_encode(genererReponseConnexion($user, $secretKey));
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'resend_2fa') {

    if (empty($data['email'])) {
        http_response_code(400);
        echo json_encode(["message" => "Email obligatoire"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$data['email']]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    // 🔒 Réponse identique dans tous les cas — évite de révéler si l'email existe ou son rôle
    if ($user && in_array($user['role'], ROLES_2FA)) {
        envoyerCode2FA($conn, $user);
    }

    echo json_encode(["message" => "Si un code était en attente, un nouveau a été envoyé ✅"]);
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'google_login') {

    if (empty($data['credential'])) {
        http_response_code(400);
        echo json_encode(["message" => "Jeton Google manquant"]);
        exit();
    }

    // Vérification du jeton directement auprès de Google (pas de librairie lourde nécessaire)
    $googleConfig = require __DIR__ . '/../config/google.php';
    $urlVerif = "https://oauth2.googleapis.com/tokeninfo?id_token=" . urlencode($data['credential']);
    $reponseGoogle = @file_get_contents($urlVerif);
    $payloadGoogle = $reponseGoogle ? json_decode($reponseGoogle, true) : null;

    if (
        !$payloadGoogle ||
        !isset($payloadGoogle['email']) ||
        ($payloadGoogle['email_verified'] ?? 'false') !== 'true' ||
        ($payloadGoogle['aud'] ?? '') !== $googleConfig['client_id']
    ) {
        http_response_code(401);
        echo json_encode(["message" => "Authentification Google invalide"]);
        exit();
    }

    $email = $payloadGoogle['email'];
    $nom = $payloadGoogle['name'] ?? explode('@', $email)[0];

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        // Nouveau compte via Google = toujours candidat (comme l'inscription classique)
        // Mot de passe aléatoire haché : le compte ne sera jamais connecté par mot de passe,
        // mais la colonne password reste NOT NULL en base.
        $motDePasseAleatoire = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT);
        $insert = $conn->prepare("INSERT INTO users (nom, email, password, role) VALUES (?, ?, ?, 'candidat')");
        $insert->execute([$nom, $email, $motDePasseAleatoire]);

        $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
    }

    // Même règle 2FA que la connexion classique pour les admin/jury liés à un compte Google
    if (in_array($user['role'], ROLES_2FA)) {
        $envoye = envoyerCode2FA($conn, $user);
        if (!$envoye) {
            http_response_code(500);
            echo json_encode(["message" => "Erreur lors de l'envoi du code de vérification"]);
            exit();
        }
        echo json_encode([
            "twofa_required" => true,
            "email" => $user['email'],
            "message" => "Un code de vérification a été envoyé à votre adresse email"
        ]);
        exit();
    }

    echo json_encode(genererReponseConnexion($user, $secretKey));
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'create_user') {
    // 🔒 Étape 1 : vérifier qu'on a un token valide dans le header Authorization
    require_once __DIR__ . '/../middleware/auth.php';
    $user = verifierToken(); // renvoie l'objet décodé du JWT (id, role...)

    // 🔒 Étape 2 : vérifier que c'est bien un admin qui appelle
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
        exit();
    }

    if (empty($data['nom']) || empty($data['email']) || empty($data['password'])) {
        http_response_code(400);
        echo json_encode(["message" => "Nom, email et mot de passe sont obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $nom = $data['nom'];
    $email = $data['email'];
    $password = password_hash($data['password'], PASSWORD_BCRYPT);
    $role = $data['role'] ?? 'candidat'; // ✅ ici on AUTORISE le choix, car c'est un admin qui le fait

    // On limite quand même aux 3 rôles valides, pour éviter une faute de frappe ou un rôle inventé
    if (!in_array($role, ['admin', 'jury', 'candidat'])) {
        http_response_code(400);
        echo json_encode(["message" => "Rôle invalide"]);
        exit();
    }

    $check = $conn->prepare("SELECT id FROM users WHERE email = ?");
    $check->execute([$email]);
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(["message" => "Email déjà utilisé"]);
        exit();
    }

    $sql = "INSERT INTO users (nom, email, password, role) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->execute([$nom, $email, $password, $role]);

    echo json_encode(["message" => "Utilisateur créé ✅"]);
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'forgot_password') {

    if (empty($data['email'])) {
        http_response_code(400);
        echo json_encode(["message" => "Email obligatoire"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $email = $data['email'];

    $stmt = $conn->prepare("SELECT id, nom FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    // 🔒 Réponse identique que l'email existe ou non — évite de révéler les comptes inscrits
    if (!$user) {
        echo json_encode(["message" => "Si cet email existe, un code a été envoyé ✅"]);
        exit();
    }

    // Génération du code à 6 chiffres (entre 100000 et 999999, jamais de zéro en tête ambigu)
    $code = strval(random_int(100000, 999999));

    // On laisse MySQL calculer l'expiration (même horloge que expire_at > NOW() plus tard)
    $insert = $conn->prepare("INSERT INTO password_resets (user_id, code, expire_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))");
    $insert->execute([$user['id'], $code]);

    // Envoi de l'email via la fonction utilitaire (fichier séparé, voir plus bas)
    require_once __DIR__ . '/../utils/mailer_send.php';
    $envoye = envoyerEmailCode($email, $user['nom'], $code, 'reset');

    if (!$envoye) {
        http_response_code(500);
        echo json_encode(["message" => "Erreur lors de l'envoi de l'email"]);
        exit();
    }

    echo json_encode(["message" => "Si cet email existe, un code a été envoyé ✅"]);
}

elseif ($method === 'POST' && isset($data['action']) && $data['action'] === 'reset_password') {

    if (empty($data['email']) || empty($data['code']) || empty($data['new_password'])) {
        http_response_code(400);
        echo json_encode(["message" => "Email, code et nouveau mot de passe obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $email = $data['email'];
    $code = $data['code'];
    $newPassword = $data['new_password'];

    // On récupère l'utilisateur
    $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        http_response_code(400);
        echo json_encode(["message" => "Code invalide ou expiré"]);
        exit();
    }

    // On cherche un code valide : correspondant, non utilisé, non expiré
    $stmtCode = $conn->prepare("
        SELECT id FROM password_resets
        WHERE user_id = ? AND code = ? AND utilise = 0 AND expire_at > NOW()
        ORDER BY id DESC LIMIT 1
    ");
    $stmtCode->execute([$user['id'], $code]);
    $reset = $stmtCode->fetch(PDO::FETCH_ASSOC);

    if (!$reset) {
        http_response_code(400);
        echo json_encode(["message" => "Code invalide ou expiré"]);
        exit();
    }

    // Mise à jour du mot de passe (toujours haché, jamais en clair)
    $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
    $update = $conn->prepare("UPDATE users SET password = ? WHERE id = ?");
    $update->execute([$hashedPassword, $user['id']]);

    // Le code est marqué comme utilisé — impossible de le réutiliser
    $invalidate = $conn->prepare("UPDATE password_resets SET utilise = 1 WHERE id = ?");
    $invalidate->execute([$reset['id']]);

    echo json_encode(["message" => "Mot de passe réinitialisé avec succès ✅"]);
}

// === NOUVEAU : GET — Lister les utilisateurs (réservé à l'admin) ===
// Utilisé notamment pour peupler le sélecteur "Choisir un jury" de l'écran
// d'affectation aux concours. Filtre optionnel : ?role=jury / ?role=admin / ?role=candidat
elseif ($method === 'GET') {
    require_once __DIR__ . '/../middleware/auth.php';
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // On ne renvoie jamais le mot de passe (même haché) dans cette liste
    $sql = "SELECT id, nom, email, role FROM users";
    $params = [];

    $rolesValides = ['admin', 'jury', 'candidat'];
    if (!empty($_GET['role']) && in_array($_GET['role'], $rolesValides)) {
        $sql .= " WHERE role = ?";
        $params[] = $_GET['role'];
    }

    $sql .= " ORDER BY nom ASC";

    $stmt = $conn->prepare($sql);
    $stmt->execute($params);
    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($users);
}

else {
    http_response_code(400);
    echo json_encode(["message" => "Action non reconnue"]);
}