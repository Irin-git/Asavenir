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
    $reponses = $data['reponses'] ?? null;

    if (!$candidature_id || !is_array($reponses) || count($reponses) === 0) {
        http_response_code(400);
        echo json_encode(["message" => "Données manquantes (candidature_id ou reponses)"]);
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

    // Sécurité : empêcher une double soumission pour la même candidature
    $verifDeja = $conn->prepare("SELECT id FROM reponses WHERE candidature_id = ? LIMIT 1");
    $verifDeja->execute([$candidature_id]);
    if ($verifDeja->fetch()) {
        http_response_code(409);
        echo json_encode(["message" => "Cette épreuve a déjà été soumise"]);
        exit();
    }

    // On récupère l'epreuve_id à partir de la première question, pour vérifier l'exclusion
    // (Correction : ce bloc était dupliqué deux fois de suite dans l'ancienne version -> retiré le doublon)
    $epreuve_id = null;
    if (count($reponses) > 0 && isset($reponses[0]['question_id'])) {
        $stmtEpreuve = $conn->prepare("SELECT epreuve_id FROM questions WHERE id = ?");
        $stmtEpreuve->execute([$reponses[0]['question_id']]);
        $ligneEpreuve = $stmtEpreuve->fetch(PDO::FETCH_ASSOC);
        $epreuve_id = $ligneEpreuve ? $ligneEpreuve['epreuve_id'] : null;
    }

    // Vérifie si cette candidature est exclue de cette épreuve (fraude détectée)
    $candidatExclu = false;
    if ($epreuve_id) {
        $stmtExclu = $conn->prepare("SELECT id FROM exclusions WHERE candidature_id = ? AND epreuve_id = ?");
        $stmtExclu->execute([$candidature_id, $epreuve_id]);
        $candidatExclu = (bool) $stmtExclu->fetch();
    }

    try {
        $conn->beginTransaction();

        $stmtInsert = $conn->prepare("
            INSERT INTO reponses (candidature_id, question_id, choix_id, texte_reponse, est_correcte)
            VALUES (?, ?, ?, ?, ?)
        ");

        $stmtChoix = $conn->prepare("SELECT est_correcte FROM choix_reponses WHERE id = ?");

        foreach ($reponses as $r) {
            $question_id = $r['question_id'] ?? null;
            $choix_id = $r['choix_id'] ?? null;
            $texte_reponse = $r['texte_reponse'] ?? null;
            $est_correcte = null;

            if (!$question_id) continue; // on saute une réponse mal formée

            if ($candidatExclu) {
                // Fraude détectée : la note est forcée à 0, peu importe la réponse donnée
                $est_correcte = 0;
            } elseif ($choix_id) {
                // Cas QCM normal : on vérifie si le choix coché est le bon
                $stmtChoix->execute([$choix_id]);
                $choix = $stmtChoix->fetch(PDO::FETCH_ASSOC);
                $est_correcte = $choix ? (int)$choix['est_correcte'] : 0;
            }
            // Sinon (question ouverte, pas exclu) : $est_correcte reste null, en attente de correction manuelle par le jury

            $stmtInsert->execute([$candidature_id, $question_id, $choix_id, $texte_reponse, $est_correcte]);
        }

        $conn->commit();
        echo json_encode(["message" => "Réponses enregistrées ✅"]);

    } catch (Exception $e) {
        $conn->rollBack();
        http_response_code(500);
        echo json_encode(["message" => "Erreur lors de l'enregistrement", "erreur" => $e->getMessage()]);
    }

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}