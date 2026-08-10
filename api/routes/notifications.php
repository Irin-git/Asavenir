<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// Envoie une notification Push à un candidat précis, ou à tous les candidats abonnés si $id_destinataire est null
// "Best effort" : les erreurs d'envoi (appareil hors-ligne, abonnement expiré) sont ignorées sans bloquer la réponse
function envoyerPushNotification($conn, $id_destinataire, $titre, $message, $lien) {
    $vapid = require __DIR__ . '/../config/vapid.php';
    try {
        $webPush = new WebPush([
            'VAPID' => [
                'subject' => $vapid['subject'],
                'publicKey' => $vapid['publicKey'],
                'privateKey' => $vapid['privateKey'],
            ],
        ]);

        // Cible soit un candidat précis, soit tous les abonnés (notification globale)
        if ($id_destinataire) {
            $stmt = $conn->prepare("SELECT * FROM push_subscriptions WHERE id_utilisateur = ?");
            $stmt->execute([$id_destinataire]);
        } else {
            $stmt = $conn->prepare("SELECT * FROM push_subscriptions");
            $stmt->execute();
        }
        $abonnements = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $payload = json_encode([
            'titre' => $titre,
            'message' => $message,
            'lien' => $lien ?? '/concours_fp/public/concours.html'
        ]);

        foreach ($abonnements as $abo) {
            $subscription = Subscription::create([
                'endpoint' => $abo['endpoint'],
                'publicKey' => $abo['public_key'],
                'authToken' => $abo['auth_token'],
            ]);
            $webPush->queueNotification($subscription, $payload);
        }

        // Envoie toutes les notifications en file d'attente et nettoie les abonnements expirés
        foreach ($webPush->flush() as $report) {
            if (!$report->isSuccess() && $report->isSubscriptionExpired()) {
                $endpointExpire = $report->getRequest()->getUri()->__toString();
                $stmtDelete = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
                $stmtDelete->execute([$endpointExpire]);
            }
        }
    } catch (Exception $e) {
        // On log l'erreur côté serveur mais on ne casse jamais la création de notification en base
        error_log("Erreur Web Push : " . $e->getMessage());
    }
}

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

// POST — Créer une notification (admin seulement)
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

    $stmt = $conn->prepare("INSERT INTO notifications 
        (id_destinataire, id_admin_createur, titre, message, type, lien) 
        VALUES (?, ?, ?, ?, ?, ?)");

    $stmt->execute([
        $data['id_destinataire'] ?? null,   // null = notification globale
        $user->id,
        $data['titre'],
        $data['message'],
        $data['type'] ?? 'info',
        $data['lien'] ?? null
    ]);

    // Envoi Web Push en plus de l'insertion en base (best effort : n'empêche jamais la réponse principale)
    envoyerPushNotification($conn, $data['id_destinataire'] ?? null, $data['titre'], $data['message'], $data['lien'] ?? null);

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