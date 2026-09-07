<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

if ($user->role !== 'admin') {
    http_response_code(403);
    echo json_encode(["message" => "Accès refusé : réservé aux administrateurs"]);
    exit();
}

$conn = (new Database())->connect();

// GET — Liste des candidats validés pour le concours de cette épreuve, avec leur salle actuelle (ou aucune)
if ($method === 'GET') {
    if (empty($_GET['epreuve_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id manquant"]);
        exit();
    }

    $stmtEp = $conn->prepare("SELECT concours_id FROM epreuves WHERE id = ?");
    $stmtEp->execute([$_GET['epreuve_id']]);
    $epreuve = $stmtEp->fetch(PDO::FETCH_ASSOC);

    if (!$epreuve) {
        http_response_code(404);
        echo json_encode(["message" => "Épreuve introuvable"]);
        exit();
    }

    $stmt = $conn->prepare("
        SELECT ca.id AS candidature_id, u.nom AS candidat_nom, u.email AS candidat_email,
            aff.salle_id
        FROM candidatures ca
        JOIN users u ON u.id = ca.user_id
        LEFT JOIN affectations_salle aff ON aff.candidature_id = ca.id AND aff.epreuve_id = ?
        WHERE ca.concours_id = ? AND ca.statut = 'validé'
        ORDER BY u.nom ASC
    ");
    $stmt->execute([$_GET['epreuve_id'], $epreuve['concours_id']]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

// POST — Deux actions possibles : répartition automatique ou affectation manuelle d'un seul candidat
} elseif ($method === 'POST') {
    $action = $data['action'] ?? '';

    // --- Répartition automatique : remplit chaque salle jusqu'à sa capacité, dans l'ordre des salles ---
    if ($action === 'repartir_auto') {
        if (empty($data['epreuve_id'])) {
            http_response_code(400);
            echo json_encode(["message" => "epreuve_id manquant"]);
            exit();
        }

        $epreuve_id = $data['epreuve_id'];

        $stmtEp = $conn->prepare("SELECT concours_id FROM epreuves WHERE id = ?");
        $stmtEp->execute([$epreuve_id]);
        $epreuve = $stmtEp->fetch(PDO::FETCH_ASSOC);

        if (!$epreuve) {
            http_response_code(404);
            echo json_encode(["message" => "Épreuve introuvable"]);
            exit();
        }

        $stmtSalles = $conn->prepare("SELECT id, capacite FROM salles_epreuve WHERE epreuve_id = ? ORDER BY id");
        $stmtSalles->execute([$epreuve_id]);
        $salles = $stmtSalles->fetchAll(PDO::FETCH_ASSOC);

        if (empty($salles)) {
            http_response_code(400);
            echo json_encode(["message" => "Aucune salle configurée pour cette épreuve"]);
            exit();
        }

        $stmtCandidats = $conn->prepare("
            SELECT ca.id AS candidature_id
            FROM candidatures ca
            WHERE ca.concours_id = ? AND ca.statut = 'validé'
            ORDER BY ca.id ASC
        ");
        $stmtCandidats->execute([$epreuve['concours_id']]);
        $candidats = $stmtCandidats->fetchAll(PDO::FETCH_ASSOC);

        // Compteur d'occupation par salle — on repart de zéro à chaque répartition automatique
        // (une répartition manuelle faite juste avant serait donc écrasée : c'est volontaire,
        // "répartir auto" = tout recalculer proprement)
        $occupation = array_fill_keys(array_column($salles, 'id'), 0);

        $stmtUpsert = $conn->prepare("
            INSERT INTO affectations_salle (epreuve_id, candidature_id, salle_id) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE salle_id = VALUES(salle_id)
        ");

        $nonAffectes = 0;
        foreach ($candidats as $candidat) {
            // Cherche la première salle qui a encore de la place (capacité NULL = illimitée)
            $salleChoisie = null;
            foreach ($salles as $salle) {
                $capacite = $salle['capacite'];
                if ($capacite === null || $occupation[$salle['id']] < $capacite) {
                    $salleChoisie = $salle['id'];
                    break;
                }
            }

            if ($salleChoisie === null) {
                $nonAffectes++;
                continue; // Toutes les salles sont pleines
            }

            $stmtUpsert->execute([$epreuve_id, $candidat['candidature_id'], $salleChoisie]);
            $occupation[$salleChoisie]++;
        }

        echo json_encode([
            "message" => "Répartition automatique effectuée ✅",
            "total_candidats" => count($candidats),
            "non_affectes" => $nonAffectes
        ]);

    // --- Affectation manuelle : change/force la salle d'UN SEUL candidat ---
    } elseif ($action === 'affecter_manuel') {
        if (empty($data['epreuve_id']) || empty($data['candidature_id']) || empty($data['salle_id'])) {
            http_response_code(400);
            echo json_encode(["message" => "epreuve_id, candidature_id et salle_id sont obligatoires"]);
            exit();
        }

        $stmt = $conn->prepare("
            INSERT INTO affectations_salle (epreuve_id, candidature_id, salle_id) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE salle_id = VALUES(salle_id)
        ");
        $stmt->execute([$data['epreuve_id'], $data['candidature_id'], $data['salle_id']]);

        echo json_encode(["message" => "Candidat affecté ✅"]);

    } else {
        http_response_code(400);
        echo json_encode(["message" => "Action non reconnue"]);
    }

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}
