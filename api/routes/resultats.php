<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

// ⚠️ Fonction placée ici, au niveau racine du script (jamais imbriquée dans un autre bloc)
function recalculerClassement($conn, $concours_id) {
    // Récupère le nombre de places disponibles pour ce concours
    $nbStmt = $conn->prepare("SELECT nb_places FROM concours WHERE id = ?");
    $nbStmt->execute([$concours_id]);
    $nb_places = $nbStmt->fetchColumn();

    // Récupère tous les résultats du concours, triés du meilleur au moins bon
    $listStmt = $conn->prepare("
        SELECT r.id, r.note_totale
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE c.concours_id = ?
        ORDER BY r.note_totale DESC
    ");
    $listStmt->execute([$concours_id]);
    $liste = $listStmt->fetchAll(PDO::FETCH_ASSOC);

    $rang = 1;
    foreach ($liste as $ligne) {
        // Ordre de priorité fixé par le cahier des charges
        if ($nb_places !== null && $rang <= $nb_places) {
            $mention = 'Admis';
        } elseif ($ligne['note_totale'] >= 10) {
            $mention = 'Ajourné';
        } else {
            $mention = 'Rejeté';
        }

        $upd = $conn->prepare("UPDATE resultats SET rang = ?, mention = ? WHERE id = ?");
        $upd->execute([$rang, $mention, $ligne['id']]);
        $rang++;
    }
}

$method = $_SERVER['REQUEST_METHOD'];
$user = verifierToken();

if ($method === 'GET' && isset($_GET['a_corriger'])) {

    if ($user->role !== 'jury') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé au jury"]);
        exit();
    }

    $epreuve_id = $_GET['epreuve_id'] ?? null;

    if (!$epreuve_id) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id requis"]);
        exit();
    }

    $conn = (new Database())->connect();

    $stmt = $conn->prepare("
        SELECT 
            r.id AS reponse_id,
            r.candidature_id,
            r.texte_reponse,
            q.enonce,
            q.points AS bareme
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        WHERE q.epreuve_id = ?
          AND q.type IN ('ouverte_courte', 'ouverte_longue', 'etude_de_cas')
          AND r.points_obtenus IS NULL
          AND r.texte_reponse IS NOT NULL
    ");
    $stmt->execute([$epreuve_id]);

    $reponses = $stmt->fetchAll(PDO::FETCH_ASSOC);

    http_response_code(200);
    echo json_encode($reponses);

    } else if ($method === 'GET' && isset($_GET['stats_concours'])) {

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé à l'administrateur"]);
        exit();
    }

    $concours_id = $_GET['stats_concours'];

    $conn = (new Database())->connect();

    // Nombre total de candidatures validées pour ce concours
    $totalStmt = $conn->prepare("
        SELECT COUNT(*) FROM candidatures 
        WHERE concours_id = ? AND statut = 'validé'
    ");
    $totalStmt->execute([$concours_id]);
    $total_candidats = (int) $totalStmt->fetchColumn();

    // Répartition par mention (uniquement les candidats déjà notés)
    $mentionStmt = $conn->prepare("
        SELECT r.mention, COUNT(*) AS total
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE c.concours_id = ?
        GROUP BY r.mention
    ");
    $mentionStmt->execute([$concours_id]);
    $mentionsBrutes = $mentionStmt->fetchAll(PDO::FETCH_KEY_PAIR); // ['Admis' => 5, 'Rejeté' => 12, ...]

    $admis   = (int) ($mentionsBrutes['Admis'] ?? 0);
    $ajourne = (int) ($mentionsBrutes['Ajourné'] ?? 0);
    $rejete  = (int) ($mentionsBrutes['Rejeté'] ?? 0);
    $notes   = $admis + $ajourne + $rejete;

    $taux_reussite = $notes > 0 ? round(($admis / $notes) * 100, 1) : 0;

    echo json_encode([
        "total_candidats" => $total_candidats,
        "deja_notes"      => $notes,
        "en_attente"      => $total_candidats - $notes,
        "admis"           => $admis,
        "ajourne"         => $ajourne,
        "rejete"          => $rejete,
        "taux_reussite"   => $taux_reussite
    ]);

} else if ($method === 'POST') {

    if ($user->role !== 'jury') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé au jury"]);
        exit();
    }

    $data = json_decode(file_get_contents("php://input"), true);

    $reponse_id = $data['reponse_id'] ?? null;
    $points_obtenus = $data['points_obtenus'] ?? null;

    if (!$reponse_id || $points_obtenus === null) {
        http_response_code(400);
        echo json_encode(["message" => "Données manquantes (reponse_id ou points_obtenus)"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Récupérer le barème max de la question liée à cette réponse
    $verif = $conn->prepare("
        SELECT q.points AS bareme
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        WHERE r.id = ?
    ");
    $verif->execute([$reponse_id]);
    $ligne = $verif->fetch(PDO::FETCH_ASSOC);

    if (!$ligne) {
        http_response_code(404);
        echo json_encode(["message" => "Réponse introuvable"]);
        exit();
    }

    if ($points_obtenus < 0 || $points_obtenus > $ligne['bareme']) {
        http_response_code(400);
        echo json_encode(["message" => "La note doit être comprise entre 0 et " . $ligne['bareme']]);
        exit();
    }

    $stmt = $conn->prepare("
        UPDATE reponses
        SET points_obtenus = ?, corrige_par = ?, date_correction = NOW()
        WHERE id = ?
    ");
    $stmt->execute([$points_obtenus, $user->id, $reponse_id]);

    // ===== NOUVEAU : déclenchement du calcul automatique =====

    // 1. Identifier la candidature et le concours concernés
    $candInfo = $conn->prepare("
        SELECT r.candidature_id, c.concours_id
        FROM reponses r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE r.id = ?
    ");
    $candInfo->execute([$reponse_id]);
    $candData = $candInfo->fetch(PDO::FETCH_ASSOC);
    $candidature_id = $candData['candidature_id'];
    $concours_id = $candData['concours_id'];

    // 2. Vérifier si TOUTES les réponses de cette candidature sont désormais notées
    $check = $conn->prepare("
        SELECT COUNT(*) 
        FROM reponses 
        WHERE candidature_id = ? 
          AND points_obtenus IS NULL 
          AND est_correcte IS NULL
    ");
    $check->execute([$candidature_id]);
    $nonNotees = $check->fetchColumn();

    if ($nonNotees == 0) {

        // 3. Calculer la note totale pondérée par coefficient
        // Étape A : note obtenue/possible PAR ÉPREUVE
        $parEpreuveStmt = $conn->prepare("
            SELECT  
                e.id AS epreuve_id,
                e.coefficient,
                SUM(CASE 
                        WHEN r.points_obtenus IS NOT NULL THEN r.points_obtenus
                        WHEN r.est_correcte = 1 THEN q.points
                        ELSE 0
                    END) AS obtenu_epreuve,
                SUM(q.points) AS possible_epreuve
            FROM reponses r
            INNER JOIN questions q ON r.question_id = q.id
            INNER JOIN epreuves e ON q.epreuve_id = e.id
            WHERE r.candidature_id = ?
            GROUP BY e.id, e.coefficient
        ");
        $parEpreuveStmt->execute([$candidature_id]);
        $epreuvesData = $parEpreuveStmt->fetchAll(PDO::FETCH_ASSOC);

        // Étape B : moyenne pondérée sur toutes les épreuves du concours
        $somme_ponderee = 0;
        $somme_coefficients = 0;

        foreach ($epreuvesData as $ep) {
            $note_epreuve_sur_20 = $ep['possible_epreuve'] > 0
                ? ($ep['obtenu_epreuve'] / $ep['possible_epreuve']) * 20
                : 0;

            $somme_ponderee += $note_epreuve_sur_20 * $ep['coefficient'];
            $somme_coefficients += $ep['coefficient'];
        }

        $note_totale = $somme_coefficients > 0 ? round($somme_ponderee / $somme_coefficients, 2) : 0;

        // 4. Insérer ou mettre à jour le résultat de ce candidat
        $upsert = $conn->prepare("
            INSERT INTO resultats (candidature_id, note_totale, date_publication)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE note_totale = VALUES(note_totale), date_publication = NOW()
        ");
        $upsert->execute([$candidature_id, $note_totale]);

        // 5. Recalculer le classement de TOUT le concours (impact global)
        recalculerClassement($conn, $concours_id);
    }

    // ===== FIN NOUVEAU =====

    http_response_code(200);
    echo json_encode(["message" => "Note enregistrée avec succès"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}