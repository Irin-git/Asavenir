<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

$secretKey = "concours_fp_secret_2024_plateforme_Madagascar_@#!";
$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

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

    // Le token JWT contient l'identité et le rôle, valable 24h
    $payload = [
        "id"    => $user['id'],
        "email" => $user['email'],
        "role"  => $user['role'],
        "exp"   => time() + (60 * 60 * 24)
    ];

    $token = JWT::encode($payload, $secretKey, 'HS256');

    echo json_encode([
        "message" => "Connexion réussie ✅",
        "token"   => $token,
        "user"    => [
            "id"    => $user['id'],
            "nom"   => $user['nom'],
            "email" => $user['email'],
            "role"  => $user['role']
        ]
    ]);
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

else {
    http_response_code(400);
    echo json_encode(["message" => "Action non reconnue"]);
}