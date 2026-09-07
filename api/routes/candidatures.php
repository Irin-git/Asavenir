<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';
require_once __DIR__ . '/../utils/notifier.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// POST — Postuler à un concours
if ($method === 'POST') {
    $user = verifierToken();

    if (empty($data['concours_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "concours_id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $check = $conn->prepare("SELECT id FROM candidatures 
        WHERE user_id = ? AND concours_id = ?");
    $check->execute([$user->id, $data['concours_id']]);
    
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(["message" => "Vous avez déjà postulé à ce concours"]);
        exit();
    }

    // paiement_effectue démarre toujours à 0 : c'est l'admin qui le coche après vérification du règlement
    $stmt = $conn->prepare("INSERT INTO candidatures 
        (user_id, concours_id, statut, paiement_effectue) 
        VALUES (?, ?, 'en_attente', 0)");
    
    $stmt->execute([$user->id, $data['concours_id']]);

    $candidature_id = $conn->lastInsertId();

    echo json_encode(["message" => "Candidature envoyée ✅", "candidature_id" => $candidature_id]);
}

// GET ALL — Admin voit toutes les candidatures, Jury voit celles en attente
// de décision UNIQUEMENT pour les concours auxquels il est affecté
elseif ($method === 'GET' && isset($_GET['all'])) {
    $user = verifierToken();

    if (!in_array($user->role, ['admin', 'jury'])) {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // paiement_effectue et frais_montant/frais_description : nécessaires pour que l'admin
    // sache, en un coup d'œil, qui a payé ou non (Chantier 5)
    $sql = "SELECT ca.id, ca.statut, ca.avis_jury, ca.created_at, ca.paiement_effectue,
        u.nom AS candidat_nom,
        c.titre AS concours_titre, c.frais_montant, c.frais_description
        FROM candidatures ca
        JOIN users u ON ca.user_id = u.id
        JOIN concours c ON ca.concours_id = c.id";

    $params = [];

    if ($user->role === 'jury') {
        $sql .= " INNER JOIN jury_affectations_concours jac 
                    ON jac.concours_id = ca.concours_id AND jac.jury_id = ?";
        $params[] = $user->id;
        $sql .= " WHERE ca.statut = 'en_attente'";
    }

    $sql .= " ORDER BY ca.created_at DESC";

    $stmt = $conn->prepare($sql);
    $stmt->execute($params);
    $candidatures = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($candidatures);
}

// GET — Voir ses propres candidatures (candidat connecté)
elseif ($method === 'GET') {
    $user = verifierToken();

    $db = new Database();
    $conn = $db->connect();

    // paiement_effectue, frais_montant, frais_description : le candidat doit savoir s'il doit encore payer
    $stmt = $conn->prepare("SELECT ca.id, c.titre, c.date_debut, c.date_fin, 
        ca.statut, ca.created_at, ca.paiement_effectue,
        c.frais_montant, c.frais_description
        FROM candidatures ca
        JOIN concours c ON ca.concours_id = c.id
        WHERE ca.user_id = ?");
    
    $stmt->execute([$user->id]);
    $candidatures = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($candidatures);
}

// PUT — Trois usages distincts selon le champ envoyé :
//   - { id, statut }            -> décision finale, réservée à l'admin
//   - { id, avis_jury }         -> avis consultatif, réservé au jury affecté à ce concours
//   - { id, paiement_effectue } -> suivi manuel du paiement des frais, réservé à l'admin (Chantier 5)
elseif ($method === 'PUT') {
    $user = verifierToken();

    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(["message" => "id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // --- Cas 1 : l'admin change le statut final ---
    if (isset($data['statut'])) {
        if ($user->role !== 'admin') {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : seul l'admin peut valider/rejeter une candidature"]);
            exit();
        }

        $statutsValides = ['en_attente', 'validé', 'rejeté'];
        if (!in_array($data['statut'], $statutsValides)) {
            http_response_code(400);
            echo json_encode(["message" => "Statut invalide"]);
            exit();
        }

        $stmt = $conn->prepare("UPDATE candidatures SET statut = ? WHERE id = ?");
        $stmt->execute([$data['statut'], $data['id']]);

        // === Notification automatique au candidat (Chantier 3) ===
        if (in_array($data['statut'], ['validé', 'rejeté'])) {
            $infoStmt = $conn->prepare("SELECT ca.user_id, c.titre AS concours_titre
                FROM candidatures ca
                JOIN concours c ON c.id = ca.concours_id
                WHERE ca.id = ?");
            $infoStmt->execute([$data['id']]);
            $info = $infoStmt->fetch(PDO::FETCH_ASSOC);

            if ($info) {
                if ($data['statut'] === 'validé') {
                    creerNotification(
                        $conn,
                        $info['user_id'],
                        "Candidature validée",
                        "Votre candidature au concours \"{$info['concours_titre']}\" a été validée. Vous êtes convoqué(e) aux épreuves.",
                        'convocation',
                        '/concours_fp/public/epreuves.html',
                        $user->id
                    );
                } else {
                    creerNotification(
                        $conn,
                        $info['user_id'],
                        "Candidature non retenue",
                        "Votre candidature au concours \"{$info['concours_titre']}\" n'a pas été retenue.",
                        'rejet',
                        '/concours_fp/public/concours.html',
                        $user->id
                    );
                }
            }
        }

        echo json_encode(["message" => "Statut mis à jour ✅"]);
        exit();
    }

    // --- Cas 2 : le jury donne son avis consultatif ---
    if (isset($data['avis_jury'])) {
        if ($user->role !== 'jury') {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : seul le jury peut donner un avis"]);
            exit();
        }

        $avisValides = ['en_attente', 'favorable', 'defavorable'];
        if (!in_array($data['avis_jury'], $avisValides)) {
            http_response_code(400);
            echo json_encode(["message" => "Avis invalide"]);
            exit();
        }

        $verif = $conn->prepare("SELECT ca.id
            FROM candidatures ca
            INNER JOIN jury_affectations_concours jac
                ON jac.concours_id = ca.concours_id AND jac.jury_id = ?
            WHERE ca.id = ?");
        $verif->execute([$user->id, $data['id']]);

        if (!$verif->fetch()) {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : vous n'êtes pas affecté au concours de cette candidature"]);
            exit();
        }

        $stmt = $conn->prepare("UPDATE candidatures SET avis_jury = ? WHERE id = ?");
        $stmt->execute([$data['avis_jury'], $data['id']]);

        echo json_encode(["message" => "Avis enregistré ✅"]);
        exit();
    }

    // --- Cas 3 (NOUVEAU, Chantier 5) : l'admin coche/décoche le paiement des frais d'inscription ---
    if (isset($data['paiement_effectue'])) {
        if ($user->role !== 'admin') {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : seul l'admin peut confirmer un paiement"]);
            exit();
        }

        $stmt = $conn->prepare("UPDATE candidatures SET paiement_effectue = ? WHERE id = ?");
        $stmt->execute([$data['paiement_effectue'] ? 1 : 0, $data['id']]);

        echo json_encode(["message" => "Statut de paiement mis à jour ✅"]);
        exit();
    }

    http_response_code(400);
    echo json_encode(["message" => "Aucune donnée valide à mettre à jour (statut, avis_jury ou paiement_effectue attendu)"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}
