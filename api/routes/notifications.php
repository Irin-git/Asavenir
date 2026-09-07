<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';
require_once __DIR__ . '/../utils/notifier.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// GET — Récupère les notifications du candidat connecté
// (les siennes + les notifications globales, triées des plus récentes aux plus anciennes)
if ($method === 'GET') {
    $user = verifierToken();

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT * FROM notifications 
        WHERE id_destinataire = ? OR id_destinataire IS NULL 
        ORDER BY created_at DESC");
    $stmt->execute([$user->id]);
    $notifications = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($notifications);
}

// POST — Créer une notification manuelle (admin seulement)
elseif ($method === 'POST') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé, admin seulement"]);
        exit();
    }

    // Vérification des champs obligatoires
    if (empty($data['titre']) || empty($data['message'])) {
        http_response_code(400);
        echo json_encode(["message" => "Titre et message sont obligatoires"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    creerNotification(
        $conn,
        $data['id_destinataire'] ?? null,   // null = notification globale
        $data['titre'],
        $data['message'],
        $data['type'] ?? 'info',
        $data['lien'] ?? null,
        $user->id
    );

    echo json_encode(["message" => "Notification créée ✅"]);
}

// PUT — Marquer une notification comme lue (candidat)
elseif ($method === 'PUT') {
    $user = verifierToken();

    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(["message" => "L'identifiant de la notification est obligatoire"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // On vérifie que la notif appartient bien au candidat OU qu'elle est globale
    // pour empêcher de marquer comme lue une notif d'un autre candidat
    $stmt = $conn->prepare("UPDATE notifications 
        SET lu = 1 
        WHERE id = ? AND (id_destinataire = ? OR id_destinataire IS NULL)");
    $stmt->execute([$data['id'], $user->id]);

    echo json_encode(["message" => "Notification marquée comme lue ✅"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}
