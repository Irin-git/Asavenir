<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

$secretKey = "concours_fp_secret_2024_plateforme_Madagascar_@#!";
$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

if ($method === 'POST' && isset($data['action']) && $data['action'] === 'register') {
    $db = new Database();
    $conn = $db->connect();

    $nom = $data['nom'];
    $email = $data['email'];
    $password = password_hash($data['password'], PASSWORD_BCRYPT);
    $role = $data['role'] ?? 'candidat';

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
    $db = new Database();
    $conn = $db->connect();

    $email = $data['email'];
    $password = $data['password'];

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user || !password_verify($password, $user['password'])) {
        http_response_code(401);
        echo json_encode(["message" => "Email ou mot de passe incorrect"]);
        exit();
    }

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

else {
    http_response_code(400);
    echo json_encode(["message" => "Action non reconnue"]);
}