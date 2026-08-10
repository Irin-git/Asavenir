<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// POST — Enregistre (ou met à jour) l'abonnement Push du candidat connecté
if ($method === 'POST') {
    $user = verifierToken();

    if (empty($data['endpoint']) || empty($data['public_key']) || empty($data['auth_token'])) {
        http_response_code(400);
        echo json_encode(["message" => "Données d'abonnement incomplètes"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // ON DUPLICATE KEY UPDATE : si l'endpoint existe déjà (même appareil déjà abonné),
    // on met juste à jour les clés au lieu de créer un doublon
    $stmt = $conn->prepare("INSERT INTO push_subscriptions 
        (id_utilisateur, endpoint, public_key, auth_token) 
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
        public_key = VALUES(public_key), 
        auth_token = VALUES(auth_token)");

    $stmt->execute([
        $user->id,
        $data['endpoint'],
        $data['public_key'],
        $data['auth_token']
    ]);

    echo json_encode(["message" => "Abonnement Push enregistré ✅"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}