<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

if ($method === 'POST') {

    if ($user->role !== 'candidat') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    $candidature_id = $data['candidature_id'] ?? null;
    $epreuve_id = $data['epreuve_id'] ?? null;
    $raison = $data['raison'] ?? 'Raison non précisée';

    if (!$candidature_id || !$epreuve_id) {
        http_response_code(400);
        echo json_encode(["message" => "Données manquantes (candidature_id ou epreuve_id)"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Sécurité : la candidature doit appartenir au candidat connecté
    $verif = $conn->prepare("SELECT id FROM candidatures WHERE id = ? AND user_id = ?");
    $verif->execute([$candidature_id, $user->id]);
    if (!$verif->fetch()) {
        http_response_code(403);
        echo json_encode(["message" => "Cette candidature ne vous appartient pas"]);
        exit();
    }

    try {
        $stmt = $conn->prepare("
            INSERT INTO exclusions (candidature_id, epreuve_id, raison)
            VALUES (?, ?, ?)
        ");
        $stmt->execute([$candidature_id, $epreuve_id, $raison]);

        echo json_encode(["message" => "Exclusion enregistrée"]);

    } catch (Exception $e) {
        // Si la contrainte UNIQUE bloque (déjà exclu), ce n'est pas une erreur grave :
        // on répond quand même succès pour ne pas bloquer le front
        echo json_encode(["message" => "Exclusion déjà enregistrée"]);
    }

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}