<?php
require_once __DIR__ . '/../../vendor/autoload.php';

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

// Envoie une notification Push à un destinataire précis, ou à tous les abonnés si $id_destinataire est null.
// "Best effort" : les erreurs d'envoi (appareil hors-ligne, abonnement expiré) sont ignorées sans bloquer la réponse.
// (déplacée depuis notifications.php pour être réutilisable par candidatures.php, resultats.php et le cron de rappels)
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

        foreach ($webPush->flush() as $report) {
            if (!$report->isSuccess() && $report->isSubscriptionExpired()) {
                $endpointExpire = $report->getRequest()->getUri()->__toString();
                $stmtDelete = $conn->prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
                $stmtDelete->execute([$endpointExpire]);
            }
        }
    } catch (Exception $e) {
        error_log("Erreur Web Push : " . $e->getMessage());
    }
}

// Point d'entrée unique pour créer une notification : insertion en base + tentative de Push.
// C'est cette fonction que les déclencheurs métier (validation candidature, publication résultats,
// rappel d'épreuve) doivent appeler — jamais l'INSERT SQL directement — pour garantir que
// toute notification créée dans l'app déclenche systématiquement le Push associé.
function creerNotification($conn, $id_destinataire, $titre, $message, $type = 'info', $lien = null, $id_admin_createur = null) {
    $stmt = $conn->prepare("INSERT INTO notifications 
        (id_destinataire, id_admin_createur, titre, message, type, lien) 
        VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([$id_destinataire, $id_admin_createur, $titre, $message, $type, $lien]);

    envoyerPushNotification($conn, $id_destinataire, $titre, $message, $lien);
}
