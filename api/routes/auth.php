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

else {
    http_response_code(400);
    echo json_encode(["message" => "Action non reconnue"]);
}